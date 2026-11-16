"""Etapa 1 · Exploración (sin modelar). Genera reports/01_exploracion.md.

Uso:  .venv\\Scripts\\python -I scripts\\01_exploracion.py
No evalúa ningún modelo. Sobre PRUEBA sólo se informan conteos descriptivos
(filas, clases, cobertura de historial), como pide la etapa.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from poroteo import rutas  # noqa: E402
from poroteo.carga import (  # noqa: E402
    SPLITS_ESTANDAR,
    consulta,
    contar_csv,
    leer_dataset,
    protocolo,
)

ORDEN = list(SPLITS_ESTANDAR)
HIST = ["hist_train_afirmativo", "hist_train_negativo", "hist_train_abstencion", "hist_train_ausente"]
PREV = ["prev_afirmativo", "prev_negativo", "prev_abstencion", "prev_ausente"]
FIRMAS = [
    "firmas_mayoria_previas_detectadas",
    "firmas_minoria_previas_detectadas",
    "firmas_sin_calificar_previas_detectadas",
    "firmas_con_disidencia_previas_detectadas",
    "dictamenes_publicados_antes_detectados",
]


def _md_simple(df: pd.DataFrame, index: bool) -> str:
    d = df.reset_index() if index else df
    cols = [str(c) for c in d.columns]
    filas = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in d.itertuples(index=False):
        filas.append("| " + " | ".join("" if pd.isna(x) else str(x) for x in r) + " |")
    return "\n".join(filas)


def seccion_tablas() -> str:
    filas = []
    sqlite_n = {}
    for (t,) in consulta("select name from sqlite_master where type='table'").itertuples(index=False):
        sqlite_n[t] = int(consulta(f'select count(*) n from "{t}"').n[0])
    for ruta in sorted(rutas.TABLAS.glob("*.csv")):
        n, cab = contar_csv(ruta)
        filas.append(
            {
                "tabla": ruta.name,
                "filas_csv": n,
                "filas_sqlite": sqlite_n.get(ruta.stem, "—"),
                "columnas": len(cab),
                "primeras columnas": ", ".join(cab[:6]) + (" …" if len(cab) > 6 else ""),
            }
        )
    ml = []
    for nombre, ruta in rutas.DATASETS_ML.items():
        n, cab = contar_csv(ruta)
        ml.append({"conjunto": nombre, "archivo": ruta.name, "filas": n, "columnas": len(cab)})
    return (
        "### 01_datos (CSV contados con parser csv; contraste con SQLite)\n\n"
        + _md_simple(pd.DataFrame(filas), False)
        + "\n\n### 04_machine_learning (conjuntos experimentales)\n\n"
        + _md_simple(pd.DataFrame(ml), False)
    )


def seccion_clases() -> tuple[str, dict]:
    g = leer_dataset("general", None, solo_estandar=False)
    p = leer_dataset("presencia", None, solo_estandar=False)
    out = []

    def tabla(df, col):
        t = pd.crosstab(df["split"], df[col])
        t["total"] = t.sum(axis=1)
        pct = (t.drop(columns="total").div(t["total"], axis=0) * 100).round(1).add_suffix(" %")
        t = t.join(pct)
        t["votaciones"] = df.groupby("split").votacion_id.nunique()
        t["sesiones"] = df.groupby("split").fecha_inicio_sesion.nunique()
        t["legisladores"] = df.groupby("split").legislador_id.nunique()
        return t

    out.append("### Intención general · objetivo_voto (sólo presentes)\n\n" + _md_simple(tabla(g, "objetivo_voto"), True))
    out.append(
        "### Presencia nominal · objetivo_presencia_registrada (1 = registrado en la votación)\n\n"
        + _md_simple(tabla(p, "objetivo_presencia_registrada"), True)
    )
    for nombre in ("texto_digital", "ocr_spa_pendiente"):
        d = leer_dataset(nombre, ["votacion_id", "split", "objetivo_voto", "fecha_inicio_sesion", "legislador_id"], False)
        out.append(f"### {nombre} · objetivo_voto\n\n" + _md_simple(tabla(d, "objetivo_voto"), True))

    # Historial: dos definiciones (benchmark congelado vs. móvil)
    filas = []
    for nombre, df in (("general", g), ("presencia", p)):
        for s in ORDEN:
            x = df[df.split == s]
            sin_ht = x.diputado_sin_historial_entrenamiento == "True"
            sin_prev = x[PREV].astype(int).sum(axis=1) == 0
            filas.append(
                {
                    "conjunto": nombre,
                    "split": s,
                    "legisladores": x.legislador_id.nunique(),
                    "sin hist_train (leg)": x[sin_ht].legislador_id.nunique(),
                    "sin hist_train (filas)": int(sin_ht.sum()),
                    "sin historial móvil prev_* (leg)": x[sin_prev].legislador_id.nunique(),
                    "sin historial móvil prev_* (filas)": int(sin_prev.sum()),
                }
            )
    hist = _md_simple(pd.DataFrame(filas), False)

    # Firmas por split
    fr = []
    for s in ORDEN:
        x = g[g.split == s]
        fila = {"split": s, "filas": len(x)}
        for c in FIRMAS:
            fila[c.replace("_previas_detectadas", "").replace("_detectados", "")] = int((x[c].astype(int) > 0).sum())
        fr.append(fila)
    firmas = _md_simple(pd.DataFrame(fr), False)

    # Mayoría y resultado de las votaciones generales
    v = consulta("select votacion_id, oficial_tipo_mayoria, oficial_base_mayoria, oficial_resultado from votaciones")
    ev = g[g.split.isin(ORDEN)][["votacion_id", "split"]].drop_duplicates().merge(v, how="left")
    ev["mayoria (tipo / base)"] = (ev.oficial_tipo_mayoria + " / " + ev.oficial_base_mayoria).replace(" / ", "(vacío)")
    may = _md_simple(pd.crosstab(ev["mayoria (tipo / base)"], ev.split)[ORDEN], True)
    res = _md_simple(pd.crosstab(ev.oficial_resultado.replace("", "(vacío)"), ev.split)[ORDEN], True)

    extra = {"hist": hist, "firmas": firmas, "mayoria": may, "resultado": res}
    return "\n\n".join(out), extra


def seccion_firmantes() -> str:
    """Cobertura de 'firmó el proyecto' (autor/firmantes) para expedientes votados en general."""
    g = leer_dataset("general", ["expediente", "split"])
    ex = g.drop_duplicates().copy()
    pl = consulta("select EXP_DIPUTADOS expediente, AUTOR from proyectos_de_ley where EXP_DIPUTADOS<>''")
    dp = consulta("select expediente, firmantes_ficha from documentos_proyectos where firmantes_ficha<>''")
    ex["con AUTOR (proyectos_de_ley)"] = ex.expediente.isin(pl.expediente)
    ex["con firmantes_ficha (documentos_proyectos)"] = ex.expediente.isin(dp.expediente)
    t = ex.groupby("split")[["con AUTOR (proyectos_de_ley)", "con firmantes_ficha (documentos_proyectos)"]].sum()
    t.insert(0, "expedientes", ex.groupby("split").size())
    return _md_simple(t.loc[ORDEN].astype(int), True)


def main() -> None:
    prot = protocolo()
    tablas = seccion_tablas()
    clases, extra = seccion_clases()
    firmantes = seccion_firmantes()
    baseline = pd.read_csv(rutas.CALIDAD / "baseline_constante_diagnostico.csv")
    cobertura = pd.read_csv(rutas.ML / "cobertura_conjuntos_fase4.csv")

    plantilla = (Path(__file__).with_name("01_exploracion_plantilla.md")).read_text(encoding="utf-8")
    texto = plantilla.format(
        tablas=tablas,
        clases=clases,
        hist=extra["hist"],
        firmas=extra["firmas"],
        mayoria=extra["mayoria"],
        resultado=extra["resultado"],
        firmantes=firmantes,
        baseline=_md_simple(baseline, False),
        cobertura=_md_simple(cobertura, False),
        predictores=", ".join(f"`{p}`" for p in prot["predictores_benchmark"]),
        rolling=", ".join(f"`{p}`" for p in prot["historial_rolling"]),
        metadatos=", ".join(f"`{p}`" for p in prot["metadatos_no_predictores"]),
    )
    rutas.REPORTES.mkdir(exist_ok=True)
    destino = rutas.REPORTES / "01_exploracion.md"
    destino.write_text(texto, encoding="utf-8")
    print(f"Escrito {destino}")


if __name__ == "__main__":
    main()
