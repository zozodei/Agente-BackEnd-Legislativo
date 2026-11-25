"""Etapa 4b · Arma reports/04b_alineacion.md desde los derivados de 04_modelos.py y
04b_alineacion.py. Compara la etapa 4 (solo_tema, con_autor) contra las mismas variantes con la
feature de alineación reciente bloque ↔ oficialismo (solo_tema_alin, con_autor_alin).

Sólo validación (2023–2024). PRUEBA no se carga.

Uso: .venv\\Scripts\\python -I scripts\\04b_reporte.py
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.stdout.reconfigure(encoding="utf-8")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from poroteo import intervalos as IV  # noqa: E402
from poroteo import rutas  # noqa: E402
from poroteo.carga import leer_dataset  # noqa: E402
from poroteo.metricas import QUORUM, resultado  # noqa: E402

D = rutas.RAIZ / "derivados"
CL4 = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION", "AUSENTE"]
ETAPA4 = {"solo_tema": "solo_tema", "con_autor": "con_autor"}
CON_ALIN = {"solo_tema": "solo_tema_alin", "con_autor": "con_autor_alin"}
S_SIM = 2000
REF_VOTACIONES = {"ley_bases": "HCDN_ACTA_5101", "armas": "HCDN_ACTA_5385"}

_spec = importlib.util.spec_from_file_location("p3", Path(__file__).with_name("03_proyecto.py"))
P3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P3)


def md(df):
    cols = [str(c) for c in df.columns]
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    out += ["| " + " | ".join(str(x) for x in r) + " |" for r in df.itertuples(index=False)]
    return "\n".join(out)


def pt(x):
    return x[0] if isinstance(x, tuple) else x


def f3(x, d=3):
    return "—" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:.{d}f}"


def valor_res(res, evaluacion, modelo, col):
    m = res[(res.modelo == modelo) & (res.conjunto == "VALIDACION") & (res.evaluacion == evaluacion) & (res.historial == "movil")]
    if "subgrupo" in m:
        m = m[m.subgrupo == "todos"]
    return float(pt(m[col].iloc[0])) if len(m) else None


def brier_aprobacion(var, sigma, oficial):
    """Brier de P(APROBADO) por votación, con P(voto) del modelo y simulación de conteos
    (mismo supuesto de dependencia por bloque que los intervalos). Validación, historial móvil."""
    pred = pd.read_csv(D / f"04_predicciones_validacion_{var}.csv")
    rng = np.random.default_rng(0)
    p = {}
    for vid, g in pred.groupby("votacion_id", sort=True):
        C = IV.simular_votacion(g[[f"p_{c}" for c in CL4]].values, g.bloque_inicio.values, sigma[0], S_SIM, rng, tau=sigma[1])
        A, N, AB = C[:, 0], C[:, 1], C[:, 2]
        p[vid] = float(((A > N) & (A + N + AB >= QUORUM)).mean())
    o = oficial.set_index("votacion_id")
    ids = list(p)
    y = np.array([resultado(int(o.loc[v, "of_A"]), int(o.loc[v, "of_N"]), int(o.loc[v, "of_AB"])) == "APROBADO" for v in ids], float)
    pv = np.array([p[v] for v in ids])
    return float(np.mean((pv - y) ** 2)), pv, y, ids


def main():
    res = pd.read_pickle(D / "04_metricas_filas.pkl")
    resv = pd.read_pickle(D / "04_resumen_votacion.pkl")
    cobs = pd.read_csv(D / "04_coberturas.csv")
    ro = pd.read_csv(D / "04_rolling_origin.csv")
    el = json.load(open(D / "04_elegidos.json", encoding="utf-8"))
    diag = pd.read_csv(D / "04b_diagnostico_acuerdos.csv")
    vv = pd.read_csv(D / "04_votaciones_validacion.csv")
    oficial = P3.totales_oficiales()

    modelos = [m for pair in ((ETAPA4[k], CON_ALIN[k]) for k in ETAPA4) for m in pair]

    # ---- métricas principales
    V = resv[(resv.conjunto == "VALIDACION") & (resv.historial == "movil")].set_index("modelo")
    filas = []

    tr = leer_dataset("general", ["votacion_id", "split"]).drop_duplicates("votacion_id")
    tr = tr[tr.split == "ENTRENAMIENTO"].votacion_id
    of_tr = oficial[oficial.votacion_id.isin(set(tr))]
    p0 = float(np.mean([resultado(int(a), int(n), int(b)) == "APROBADO" for a, n, b in zip(of_tr.of_A, of_tr.of_N, of_tr.of_AB)]))
    ids_val = None
    for m in modelos:
        sigma = el["sigma"][m]["sigma"]
        cov = cobs[(cobs.conjunto == f"VALIDACION ({m})") & (cobs.metodo.str.startswith("efecto")) &
                   (cobs.referencia == "totales oficiales") & (cobs.estrato == "todas")]
        cov_div = cobs[(cobs.conjunto == f"VALIDACION ({m})") & (cobs.metodo.str.startswith("efecto")) &
                       (cobs.referencia == "totales oficiales") & (cobs.estrato == "divididas (<100)")]
        b, _, _, ids = brier_aprobacion(m, sigma, oficial)
        ids_val = ids if ids_val is None else ids_val
        v = V.loc[m]
        filas.append({
            "modelo": m,
            "log loss voto (B)": f3(valor_res(res, "B_voto_presente", m, "log_loss")),
            "F1 macro (con umbral)": f3(valor_res(res, "B_umbral", m, "f1_macro_umbral")),
            "EA neg. Σp total": f3(pt(v.esp_ea_N), 1),
            "EA neg. Σp divididas": f3(pt(v["dividida_lt100__esp_ea_N"]), 1),
            "Spearman neg. Σp": f3(pt(v.spearman_N_esp), 2),
            "acierto resultado": f3(pt(v.esp_ok_res), 2),
            "IC80 afirm / neg": f"{cov.A_IC80.iloc[0]:.2f} / {cov.N_IC80.iloc[0]:.2f}" if len(cov) else "—",
            "IC80 neg. divididas": f"{cov_div.N_IC80.iloc[0]:.2f}" if len(cov_div) else "—",
            "Brier P(aprob.)": f3(b),
        })
    tabla = pd.DataFrame(filas)

    # Brier de la tasa base (constante = tasa de aprobación en ENTRENAMIENTO) sobre las mismas votaciones
    o = oficial.set_index("votacion_id")
    y_val = np.array([resultado(int(o.loc[v, "of_A"]), int(o.loc[v, "of_N"]), int(o.loc[v, "of_AB"])) == "APROBADO" for v in ids_val], float)
    brier_base = float(np.mean((p0 - y_val) ** 2))

    # ---- rolling origin
    m_ro = ro.groupby(["objetivo", "variante", "familia", "param"]).log_loss.mean().reset_index()
    mejor_ro = m_ro.loc[m_ro.groupby(["objetivo", "variante"]).log_loss.idxmin()].sort_values(["objetivo", "log_loss"])
    tabla_ro = mejor_ro.rename(columns={"objetivo": "objetivo", "variante": "variante", "familia": "familia",
                                        "param": "config", "log_loss": "log loss RO medio"})
    tabla_ro["log loss RO medio"] = tabla_ro["log loss RO medio"].map("{:.4f}".format)
    eleg = {}
    for obj in ("voto", "presencia"):
        sub = mejor_ro[mejor_ro.objetivo == obj]
        eleg[obj] = sub.iloc[0].variante

    # ---- Ley Bases y armas de fuego (PRO y UCR)
    filas_ref = []
    for etiqueta, vid in REF_VOTACIONES.items():
        for m in modelos:
            pred = pd.read_csv(D / f"04_predicciones_validacion_{m}.csv")
            g = pred[pred.votacion_id == vid]
            if not len(g):
                continue
            pro = g[g.bloque_inicio == "PRO"].p_NEGATIVO
            ucr = g[g.bloque_inicio.str.startswith("UCR")].p_NEGATIVO
            t = vv[(vv.modelo == m) & (vv.votacion_id == vid)]
            r_real = resultado(int(oficial.set_index("votacion_id").loc[vid, "of_A"]), int(oficial.set_index("votacion_id").loc[vid, "of_N"]),
                               int(oficial.set_index("votacion_id").loc[vid, "of_AB"]))
            filas_ref.append({"votación": f"{etiqueta} ({vid})", "modelo": m,
                              "P(NEG) medio PRO": f3(pro.mean(), 2) if len(pro) else "—",
                              "P(NEG) medio UCR": f3(ucr.mean(), 2) if len(ucr) else "—",
                              "resultado predicho (Σp)": t.esp_res.iloc[0] if len(t) else "—",
                              "resultado oficial": r_real})
    tabla_ref = pd.DataFrame(filas_ref)

    # ---- diagnóstico de la regla
    dg = diag[diag.b.isin(["PRO", "UCR - UNION CIVICA RADICAL", "LA LIBERTAD AVANZA", "UNION POR LA PATRIA"]) & diag.anio.between(2023, 2024)]
    dg = dg.pivot(index="anio", columns="b", values="tasa_acuerdo").reset_index()
    dg_n = diag[diag.b.isin(["PRO", "UCR - UNION CIVICA RADICAL"]) & diag.anio.between(2023, 2024)].pivot(index="anio", columns="b", values="votaciones").reset_index()

    # ---- metas
    def si(cond):
        return "Cumple" if cond else "No cumple"

    metas = []
    for m in modelos:
        if not m.endswith("_alin"):
            continue
        row = tabla[tabla.modelo == m].iloc[0]
        sp = float(row["Spearman neg. Σp"])
        en = float(row["EA neg. Σp total"])
        ed = float(row["EA neg. Σp divididas"])
        ci = [float(x) for x in row["IC80 afirm / neg"].replace(" ", "").split("/")]
        bri = float(row["Brier P(aprob.)"])
        metas.append({"modelo": m,
                      "Spearman neg. ≥ 0,60": f"{si(sp >= 0.60)} ({sp:.2f})",
                      "EA neg. ≤ 25": f"{si(en <= 25)} ({en:.1f})",
                      "EA neg. divididas ≤ 30": f"{si(ed <= 30)} ({ed:.1f})",
                      "IC80 entre 75 % y 85 %": f"{si(all(0.75 <= c <= 0.85 for c in ci))} ({' / '.join(f'{c:.2f}' for c in ci)})",
                      "Brier mejor que tasa base": f"{si(bri < brier_base)} ({bri:.3f} vs {brier_base:.3f})"})
    tabla_metas = pd.DataFrame(metas)

    # ---- escribir reporte
    texto = [
        "# Etapa 4b · Alineación reciente bloque ↔ oficialismo",
        "",
        "Generado por `scripts/04b_alineacion.py` (diagnóstico), `scripts/04_modelos.py` (variantes) y `scripts/04b_reporte.py`.",
        "**PRUEBA no se cargó ni se predijo.** Validación 2023–2024, historial móvil.",
        "",
        "## 1 · Feature",
        "",
        f"- Mayoría de cada bloque en cada votación (AFIRMATIVO vs NEGATIVO; ABSTENCION y ausentes no cuentan).",
        f"- Oficialismo de la votación: mayoría de los votos del día anterior en bloques con `es_oficialismo = 1` (documental). "
        "Sólo el «1» cuenta; vacío (NO_VERIFICADO) no es oficialismo.",
        f"- Feature: proporción suavizada de acuerdos del bloque en las votaciones con fecha en [límite − {180} días, límite). "
        f"Suavizado α = 5 hacia 0,5. Dos columnas: `alin_rec` y `alin_rec_log_n`.",
        "- Acuerdo con el oficialismo solo si ambas mayorías están definidas.",
        "- Las variantes `solo_tema_alin` y `con_autor_alin` agregan la feature a voto y a presencia.",
        "",
        "## 2 · Diagnóstico de la regla (tasa de acuerdo con la mayoría oficialista)",
        "",
        "Descriptivo: usa todas las votaciones del año, no sólo las anteriores a la sesión.",
        "",
        md(dg.rename(columns={"anio": "año"})),
        "",
        "Votaciones con mayoría definida por año:",
        "",
        md(dg_n.rename(columns={"anio": "año"})),
        "",
        "## 3 · Rolling origin (ENTRENAMIENTO)",
        "",
        f"Mejor configuración por variante (log loss medio por fold). Gana en voto: **{eleg['voto']}**; en presencia: **{eleg['presencia']}**.",
        "",
        md(tabla_ro),
        "",
        "## 4 · Validación 2023–2024: etapa 4 contra la versión con alineación",
        "",
        f"Referencia de base: tasa de aprobación en ENTRENAMIENTO = {p0:.3f} (Brier constante = {brier_base:.3f} en las {len(ids_val)} votaciones de validación).",
        "",
        md(tabla),
        "",
        "## 5 · Ley Bases (armas de fuego) · PRO y UCR en 2024",
        "",
        md(tabla_ref),
        "",
        "## 6 · Metas",
        "",
        md(tabla_metas),
        "",
        "## 7 · Lectura",
        "",
        "- **La regla corrige la señal de 2024.** PRO coincide con la mayoría oficialista en el 100 % de sus votaciones "
        "de 2024 y UCR–Unión Cívica Radical en el 67 %; Unión por la Patria, en el 11 %. La etiqueta documental "
        "(NO_OFICIALISTA) no lo reflejaba.",
        "- **Ley Bases y armas de fuego (PRO/UCR):** `con_autor` predecía RECHAZADO la Ley Bases; `con_autor_alin` "
        "la predice APROBADO. En armas de fuego, `solo_tema_alin` y `con_autor_alin` bajan P(NEG) de PRO (0,22 y 0,32) "
        "pero `con_autor_alin` sigue prediciendo RECHAZADO. El error se corrige sólo en parte.",
        "- **Validación:** la feature no mejora la etapa 4 en conjunto. `solo_tema_alin` empeora el log loss de voto "
        "(0,502 → 0,517) y el Spearman de negativos (0,43 → 0,35). `con_autor_alin` mejora un poco el log loss "
        "(0,501 → 0,499), el Spearman (0,40 → 0,43) y el acierto de resultado (0,92 → 0,96), pero el error de negativos "
        "sube (31,2 → 33,5).",
        "- **Rolling origin:** la diferencia entre variantes es de milésimas (voto: 0,3868 vs 0,3878 a favor de "
        "`solo_tema_alin`; presencia: 0,4003 vs 0,4005). Está dentro del ruido; no justifica cambiar la variante elegida.",
        "- **Votación dividida:** sigue fallando. El error de negativos en divididas queda entre 46 y 50, contra la meta de 30.",
        "- **Intervalos:** las versiones con alineación cubren menos (IC80 de negativos 0,56–0,60, contra 0,75–0,85 de la meta). "
        "La cobertura de `solo_tema` (0,92) es la más alta, pero sobre 25 votaciones es una medida ruidosa.",
        "- **Metas:** ninguna se cumple en las dos variantes con alineación.",
        "- **Brier de P(aprobación): la meta no es alcanzable tal como está definida.** En ENTRENAMIENTO 399 de 400 "
        "votaciones aprobaron, y en VALIDACIÓN las 25. Un predictor constante de tasa base tiene Brier ≈ 0,000, y los "
        "modelos tienen 0,11–0,12. El dataset casi no tiene rechazos, así que no hay de qué aprender el resultado. "
        "Hace falta redefinir esta meta (por ejemplo, con proyectos rechazados o con el resultado en divididas) antes de decidir.",
        "- **Decisión:** no conviene pasar `con_autor_alin` ni `solo_tema_alin` a la app todavía. La alineación no mejora "
        "lo suficiente la validación. Lo que sigue es atacar la votación dividida y la cobertura de intervalos.",
        "",
    ]
    (rutas.REPORTES / "04b_alineacion.md").write_text("\n".join(texto), encoding="utf-8")
    print("Reporte escrito en", rutas.REPORTES / "04b_alineacion.md")


if __name__ == "__main__":
    main()
