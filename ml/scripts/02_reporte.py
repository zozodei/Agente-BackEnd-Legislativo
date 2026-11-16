"""Arma reports/02_baselines.md desde los derivados de 02_baselines.py y 02b_autor_cruzable.py."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from poroteo import rutas  # noqa: E402
from poroteo.metricas import fmt  # noqa: E402

D = rutas.RAIZ / "derivados"
NOMBRES = {
    "a_constante": "(a) constante",
    "b_historial": "(b) historial",
    "b_historial_bloque_signo": "(b) historial + prior bloque/signo",
    "c_logistica_sin_bloque_signo": "(c) logística sin bloque/signo",
    "c_logistica_bloque_signo": "(c) logística con bloque/signo",
}
ORDEN = list(NOMBRES)


def md(df: pd.DataFrame) -> str:
    cols = [str(c) for c in df.columns]
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    out += ["| " + " | ".join(str(x) for x in r) + " |" for r in df.itertuples(index=False)]
    return "\n".join(out)


def filas(res, evaluacion, historial, ic_por, subgrupo="todos"):
    r = res[(res.evaluacion == evaluacion) & (res.historial == historial) & (res.ic_por == ic_por) & (res.subgrupo == subgrupo)]
    return r.set_index("modelo")


def tabla_principal(res, vic, historial, ic_por):
    ic_fila = "votacion" if ic_por == "votacion_id" else ic_por  # nombre usado en métricas por fila
    B = filas(res, "B_voto_presente", historial, ic_fila)
    A = filas(res, "A_presencia", historial, ic_fila)
    C = filas(res, "AxB_combinado_4_clases", historial, ic_fila)
    V = vic[(vic.historial == historial) & (vic.ic_por == ic_por)].set_index("modelo")
    out = []
    for m in ORDEN:
        out.append({
            "modelo": NOMBRES[m],
            "B · F1 macro": fmt(B.loc[m, "f1_macro"]),
            "B · log loss": fmt(B.loc[m, "log_loss"]),
            "B · Brier": fmt(B.loc[m, "brier"]),
            "A · F1 macro": fmt(A.loc[m, "f1_macro"]),
            "A · log loss": fmt(A.loc[m, "log_loss"]),
            "A×B · F1 macro (4 cl.)": fmt(C.loc[m, "f1_macro"]),
            "A×B · log loss": fmt(C.loc[m, "log_loss"]),
            "Vot · EA afirm.": fmt(V.loc[m, "pred_ea_A"], 1),
            "Vot · EA neg.": fmt(V.loc[m, "pred_ea_N"], 1),
            "Vot · acierto resultado": fmt(V.loc[m, "pred_ok_res"], 2),
            "Vot · acierto quórum": fmt(V.loc[m, "pred_ok_quorum"], 2),
        })
    return md(pd.DataFrame(out))


def tabla_subgrupos(res, historial):
    out = []
    for ev, etiqueta in (("B_voto_presente", "B"), ("A_presencia", "A"), ("AxB_combinado_4_clases", "A×B")):
        for sub in ("con_historial", "sin_historial"):
            r = filas(res, ev, historial, "sesion", sub)
            for m in ORDEN:
                if m not in r.index:
                    continue
                x = r.loc[m]
                out.append({"objetivo": etiqueta, "subgrupo": sub, "n filas": x.n, "votaciones": x.votaciones,
                            "modelo": NOMBRES[m], "F1 macro": fmt(x.f1_macro), "log loss": fmt(x.log_loss),
                            "Brier": fmt(x.brier), "accuracy (ref.)": fmt(x.accuracy)})
    return md(pd.DataFrame(out))


def tabla_esperado(vic):
    V = vic[(vic.historial == "movil") & (vic.ic_por == "sesion")].set_index("modelo")
    out = [{"modelo": NOMBRES[m], "EA afirm. (argmax)": fmt(V.loc[m, "pred_ea_A"], 1), "EA neg. (argmax)": fmt(V.loc[m, "pred_ea_N"], 1),
            "EA afirm. (esperado Σp)": fmt(V.loc[m, "esp_ea_A"], 1), "EA neg. (esperado Σp)": fmt(V.loc[m, "esp_ea_N"], 1)} for m in ORDEN]
    piso = V.iloc[0]
    out.append({"modelo": "**oráculo: etiquetas reales de las filas existentes**", "EA afirm. (argmax)": fmt(piso.real_filas_ea_A, 1),
                "EA neg. (argmax)": fmt(piso.real_filas_ea_N, 1), "EA afirm. (esperado Σp)": "—", "EA neg. (esperado Σp)": "—"})
    return md(pd.DataFrame(out))


def confusiones(res):
    out = []
    for ev, clases in (("B_voto_presente", ["AFIRM", "NEG", "ABST"]), ("AxB_combinado_4_clases", ["AFIRM", "NEG", "ABST", "AUS"])):
        for m in ("a_constante", "b_historial_bloque_signo", "c_logistica_bloque_signo"):
            cm = filas(res, ev, "movil", "sesion").loc[m, "confusion"]
            t = pd.DataFrame(cm, columns=[f"pred {c}" for c in clases])
            t.insert(0, "real", clases)
            out.append(f"**{ev} · {NOMBRES[m]}**\n\n" + md(t))
    return "\n\n".join(out)


def rolling(ro, elegidos):
    ro = ro.copy()
    ro["param"] = ro.alpha.fillna(ro.C)
    out = []
    for obj in ("voto", "presencia"):
        r = ro[ro.objetivo == obj]
        for m in ORDEN:
            p = elegidos[obj][m]
            x = r[(r.modelo == m) & ((r.param == p) if p is not None else r.param.isna())]
            out.append({"objetivo": obj, "modelo": NOMBRES[m], "hiperparámetro elegido": "—" if p is None else (f"α={p:g}" if m.startswith("b") else f"C={p:g}"),
                        "folds": ", ".join(str(a) for a in x.anio), "log loss medio": f"{x.log_loss.mean():.3f} (±{x.log_loss.std():.3f})",
                        "F1 macro medio": f"{x.f1_macro.mean():.3f} (±{x.f1_macro.std():.3f})"})
    return md(pd.DataFrame(out))


def main():
    res = pd.read_pickle(D / "02_metricas_filas.pkl")
    vic = pd.read_pickle(D / "02_metricas_votacion_ic.pkl")
    vot = pd.read_csv(D / "02_metricas_votacion.csv")
    ro = pd.read_csv(D / "02_rolling_origin.csv")
    elegidos = json.load(open(D / "02_elegidos.json"))
    aut = pd.read_csv(D / "02_autor_cruces_todos.csv")

    v0 = vot[(vot.modelo == "a_constante") & (vot.historial == "movil")]
    faltan = (257 - v0.filas)
    plantilla = Path(__file__).with_name("02_reporte_plantilla.md").read_text(encoding="utf-8")
    texto = plantilla.format(
        principal=tabla_principal(res, vic, "movil", "sesion"),
        principal_votacion=tabla_principal(res, vic, "movil", "votacion_id"),
        congelado=tabla_principal(res, vic, "congelado", "sesion"),
        subgrupos=tabla_subgrupos(res, "movil"),
        subgrupos_congelado=tabla_subgrupos(res, "congelado"),
        esperado=tabla_esperado(vic),
        confusiones=confusiones(res),
        rolling=rolling(ro, elegidos),
        bancas_min=int(faltan.min()), bancas_max=int(faltan.max()), bancas_media=f"{faltan.mean():.1f}",
        res_oficial=", ".join(f"{k}: {v}" for k, v in v0.res_oficial_reglas.value_counts().items()),
        autor=md(aut.estado.value_counts().rename_axis("estado").reset_index(name="votaciones de train")),
    )
    (rutas.REPORTES / "02_baselines.md").write_text(texto, encoding="utf-8")
    print("Escrito", rutas.REPORTES / "02_baselines.md")


if __name__ == "__main__":
    main()
