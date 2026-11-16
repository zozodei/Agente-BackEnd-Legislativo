"""Arma reports/03_proyecto.md desde los derivados de 03a_proyectos_features.py y 03_proyecto.py."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from poroteo import rutas  # noqa: E402
from poroteo.metricas import fmt  # noqa: E402

D = rutas.RAIZ / "derivados"
REF = "c_logistica_bloque_signo"
NOMBRES = {
    REF: "(c) logística con bloque/signo [ref. etapa 2]",
    "c_familia_signo": "(c) con familia en lugar de bloque",
    "c_bloque_interbloque_signo": "(c) con bloque + interbloque",
    "d_todas": "(d) todas las features de proyecto",
    "d_todas_familia": "(d) todas, con familia en lugar de bloque",
}
GR = ["origen", "signo_autor", "alineacion", "inter_signo", "inter_bloque", "es_autor", "tema", "hist_tema"]
for g in GR:
    NOMBRES[f"d_sin_{g}"] = f"(d) todas menos {g}"
    NOMBRES[f"c_mas_{g}"] = f"(c) ref + sólo {g}"


def md(df: pd.DataFrame) -> str:
    cols = [str(c) for c in df.columns]
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    out += ["| " + " | ".join(str(x) for x in r) + " |" for r in df.itertuples(index=False)]
    return "\n".join(out)


def f1(x, dec=3):
    return "—" if x is None or (isinstance(x, float) and pd.isna(x)) else f"{x:.{dec}f}"


def fila(res, ev, modelo, historial="movil", sub="todos"):
    r = res[(res.evaluacion == ev) & (res.modelo == modelo) & (res.historial == historial) & (res.subgrupo == sub)]
    return r.iloc[0] if len(r) else None


def vres(resv, etiqueta, historial="movil"):
    r = resv[(resv.modelo == etiqueta) & (resv.historial == historial)]
    return r.iloc[0] if len(r) else None


def etiqueta_vot(modelo, el):
    pres = "b_historial_bloque_signo" if modelo == REF else el["mejor_presencia"]
    return f"{modelo}__pres_{pres}", pres


def ro_media(ro, el, modelo, objetivo="voto"):
    p = el[objetivo][modelo]
    x = ro[(ro.objetivo == objetivo) & (ro.modelo == modelo) & (ro.param == p)]
    return x


def tabla_principal(res, resv, el, modelos, historial="movil"):
    out = []
    for m in modelos:
        et, pres = etiqueta_vot(m, el)
        b, a = fila(res, "B_voto_presente", m, historial), fila(res, "A_presencia", pres, historial)
        c, v = fila(res, "AxB_combinado_4_clases", et, historial), vres(resv, et, historial)
        out.append({
            "modelo": NOMBRES.get(m, m),
            "presencia": "(b) historial+prior" if pres.startswith("b_") else "logística + proyecto",
            "B · log loss": fmt(b.log_loss), "B · F1 macro": fmt(b.f1_macro), "B · Brier": fmt(b.brier),
            "A · log loss": fmt(a.log_loss),
            "A×B · log loss": fmt(c.log_loss) if c is not None else "—", "A×B · F1 (4 cl.)": fmt(c.f1_macro) if c is not None else "—",
            "Vot · EA afirm. Σp": fmt(v.esp_ea_A, 1), "Vot · EA neg. Σp": fmt(v.esp_ea_N, 1), "Vot · EA neg. argmax": fmt(v.pred_ea_N, 1),
            "Spearman afirm. Σp": fmt(v.spearman_A_esp, 2), "Spearman neg. Σp": fmt(v.spearman_N_esp, 2),
            "desvío intra-sesión Σneg": f1(v.disp_intra_sesion_esp_N, 1),
            "acierto resultado": fmt(v.pred_ok_res, 2),
        })
    return md(pd.DataFrame(out))


def tabla_ablacion(res, resv, ro, el):
    out = []
    for m in NOMBRES:
        b = fila(res, "B_voto_presente", m)
        if b is None:
            continue
        et, _ = etiqueta_vot(m, el)
        v = vres(resv, et)
        x = ro_media(ro, el, m)
        out.append({"variante": NOMBRES[m], "C (RO)": f"{el['voto'][m]:g}",
                    "RO · log loss medio": f"{x.log_loss.mean():.4f}",
                    "RO · folds mejor que ref": "",
                    "Val · B log loss": fmt(b.log_loss), "Val · B F1 macro": fmt(b.f1_macro),
                    "Val · EA neg. Σp": f1(v.esp_ea_N[0], 1), "Val · Spearman neg. Σp": f1(v.spearman_N_esp[0], 2)})
    t = pd.DataFrame(out)
    ref = ro_media(ro, el, REF).set_index("anio").log_loss
    for i, m in enumerate([m for m in NOMBRES if fila(res, "B_voto_presente", m) is not None]):
        x = ro_media(ro, el, m).set_index("anio").log_loss
        t.loc[i, "RO · folds mejor que ref"] = f"{int((x < ref - 1e-9).sum())}/{len(x)}"
    return md(t)


def tabla_estratos(resv, el, modelos):
    out = []
    for m in modelos:
        et, _ = etiqueta_vot(m, el)
        v = vres(resv, et)
        for corte in (30, 100):
            for est in (f"dividida_lt{corte}", f"consensuada_ge{corte}"):
                n = v[f"n_{est}"]
                g = lambda k: fmt(v[f"{est}__{k}"], 1) if n else "—"  # noqa: E731
                out.append({"modelo": NOMBRES[m], "estrato (margen oficial |A−N|)": est.replace("_lt", " < ").replace("_ge", " ≥ "),
                            "votaciones": n, "EA afirm. Σp": g("esp_ea_A"), "EA neg. Σp": g("esp_ea_N"),
                            "EA afirm. argmax": g("pred_ea_A"), "EA neg. argmax": g("pred_ea_N")})
    return md(pd.DataFrame(out))


def tabla_subgrupos(res, modelos, historial):
    out = []
    for m in modelos:
        for sub in ("con_historial", "sin_historial"):
            x = fila(res, "B_voto_presente", m, historial, sub)
            if x is None:
                continue
            out.append({"modelo": NOMBRES[m], "subgrupo": sub, "n filas": x.n, "log loss": fmt(x.log_loss),
                        "F1 macro": fmt(x.f1_macro), "Brier": fmt(x.brier)})
    return md(pd.DataFrame(out))


def tabla_presencia(res, ro, el):
    out = []
    for m, nombre in (("b_historial_bloque_signo", "(b) historial + prior bloque/signo [etapa 2]"),
                      ("d_presencia_proyecto", "logística bloque/signo + origen, alineación, inter_signo, tema")):
        x = ro_media(ro, el, m, "presencia")
        a = fila(res, "A_presencia", m)
        out.append({"modelo": nombre, "hiperparámetro": f"{el['presencia'][m]:g}", "RO · log loss medio": f"{x.log_loss.mean():.4f}",
                    "Val · log loss": fmt(a.log_loss), "Val · Brier": fmt(a.brier), "Val · F1 macro": fmt(a.f1_macro)})
    return md(pd.DataFrame(out))


def tabla_rolling(ro, el):
    r = ro[ro.objetivo == "voto"]
    piv = r[r.apply(lambda x: x.param == el["voto"][x.modelo], axis=1)].pivot(index="modelo", columns="anio", values="log_loss")
    piv = piv.loc[[m for m in NOMBRES if m in piv.index]]
    piv.insert(0, "variante", [NOMBRES[m] for m in piv.index])
    piv["media"] = piv.drop(columns="variante").mean(axis=1)
    return md(piv.round(4).reset_index(drop=True))


def confusiones(res, modelos):
    out = []
    for m in modelos:
        cm = fila(res, "B_voto_presente", m).confusion
        t = pd.DataFrame(cm, columns=["pred AFIRM", "pred NEG", "pred ABST"])
        t.insert(0, "real", ["AFIRM", "NEG", "ABST"])
        out.append(f"**{NOMBRES[m]}**\n\n" + md(t))
    return "\n\n".join(out)


def main():
    res = pd.read_pickle(D / "03_metricas_filas.pkl")
    resv = pd.read_pickle(D / "03_resumen_votacion.pkl")
    ro = pd.read_csv(D / "03_rolling_origin.csv")
    el = json.load(open(D / "03_elegidos.json"))
    cob = pd.read_csv(D / "03_cobertura_campos.csv")
    cobf = json.load(open(D / "03_cobertura_features.json", encoding="utf-8"))
    mejor = el["mejor_voto"]
    principales = list(dict.fromkeys([REF, "d_todas", mejor, "c_familia_signo", "c_bloque_interbloque_signo"]))
    claves = list(dict.fromkeys([REF, "d_todas", mejor]))

    def dist(c):
        rows = []
        for s in ("ENTRENAMIENTO", "VALIDACION"):
            for k, n in cobf[c][s].items():
                rows.append({"split": s, c: k, "votaciones generales": n})
        return md(pd.DataFrame(rows))

    plantilla = Path(__file__).with_name("03_reporte_plantilla.md").read_text(encoding="utf-8")
    texto = plantilla.format(
        cobertura=md(cob),
        origen=dist("origen_autor"),
        tema=dist("tema"),
        principal=tabla_principal(res, resv, el, principales),
        congelado=tabla_principal(res, resv, el, claves, "congelado"),
        ablacion=tabla_ablacion(res, resv, ro, el),
        estratos=tabla_estratos(resv, el, claves),
        subgrupos=tabla_subgrupos(res, claves, "movil"),
        subgrupos_congelado=tabla_subgrupos(res, claves, "congelado"),
        presencia=tabla_presencia(res, ro, el),
        rolling=tabla_rolling(ro, el),
        confusiones=confusiones(res, claves),
        mejor=NOMBRES.get(mejor, mejor),
        mejor_C=f"{el['voto'][mejor]:g}",
    )
    (rutas.REPORTES / "03_proyecto.md").write_text(texto, encoding="utf-8")
    print("Escrito", rutas.REPORTES / "03_proyecto.md")


if __name__ == "__main__":
    main()
