"""Arma reports/04_modelos.md y reports/04_calibracion.png desde los derivados de la etapa 4."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.stdout.reconfigure(encoding="utf-8")

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from poroteo import rutas  # noqa: E402
from poroteo.metricas import fmt, pesos_bootstrap  # noqa: E402

D = rutas.RAIZ / "derivados"
CL3 = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION"]
CL4 = CL3 + ["AUSENTE"]
NOM = {"ref_etapa2": "Ref. etapa 2 (logística bloque/signo + historial)",
       "etapa3_d_todas": "Etapa 3 · todas las features (logística)",
       "solo_tema__sin_calibrar": "solo_tema · sin calibrar", "solo_tema": "**solo_tema** · calibrado + umbral",
       "con_autor__sin_calibrar": "con_autor · sin calibrar", "con_autor": "**con_autor** · calibrado + umbral"}
ORDEN = list(NOM)
# Paleta categórica de referencia (slots 1-3, validados) y tinta secundaria
AZUL, NARANJA, AQUA, TINTA, SUPERFICIE = "#2a78d6", "#eb6834", "#1baf7a", "#52514e", "#fcfcfb"


def md(df):
    cols = [str(c) for c in df.columns]
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    out += ["| " + " | ".join(str(x) for x in r) + " |" for r in df.itertuples(index=False)]
    return "\n".join(out)


def p(x, d=3):
    if isinstance(x, tuple):
        return fmt(x, d)
    if isinstance(x, (float, np.floating)):
        return "—" if np.isnan(x) else f"{x:.{d}f}"
    return str(x)


def pt(x):
    return x[0] if isinstance(x, tuple) else x


# ---------------------------------------------------------------- tablas


def tabla_ro(ro):
    m = ro.groupby(["objetivo", "variante", "familia", "param"]).log_loss.mean().reset_index()
    best = m.loc[m.groupby(["objetivo", "variante", "familia"]).log_loss.idxmin()]
    filas = []
    for r in best.itertuples():
        x = ro[(ro.objetivo == r.objetivo) & (ro.variante == r.variante) & (ro.familia == r.familia) & (ro.param == r.param)].sort_values("anio")
        otra = best[(best.objetivo == r.objetivo) & (best.variante == r.variante) & (best.familia != r.familia)].iloc[0]
        y = ro[(ro.objetivo == r.objetivo) & (ro.variante == r.variante) & (ro.familia == otra.familia) & (ro.param == otra.param)].sort_values("anio")
        filas.append({"objetivo": r.objetivo, "variante": r.variante, "familia": r.familia, "hiperparámetro": r.param,
                      "log loss medio": f"{x.log_loss.mean():.4f}", "F1 macro medio": f"{x.f1_macro.mean():.3f}",
                      "por fold": " · ".join(f"{a}: {v:.3f}" for a, v in zip(x.anio, x.log_loss)),
                      "folds mejor que la otra familia": f"{int((x.log_loss.values < y.log_loss.values).sum())}/{len(x)}"})
    return md(pd.DataFrame(filas))


def fila(res, ev, modelo, sub="todos", hist="movil"):
    r = res[(res.conjunto == "VALIDACION") & (res.evaluacion == ev) & (res.modelo == modelo) & (res.historial == hist)]
    if "subgrupo" in r:
        r = r[r.subgrupo == sub] if ev != "B_umbral" else r
    return r.iloc[0] if len(r) else None


def tabla_principal(res, resv, cobs, el, hist="movil"):
    out = []
    V = resv[(resv.conjunto == "VALIDACION") & (resv.historial == hist)].set_index("modelo")
    for m in ORDEN:
        b, a, c, u = fila(res, "B_voto_presente", m, hist=hist), fila(res, "A_presencia", m, hist=hist), fila(res, "AxB_combinado_4_clases", m, hist=hist), fila(res, "B_umbral", m)
        v = V.loc[m]
        cov = cobs[(cobs.conjunto == f"VALIDACION ({m})") & (cobs.metodo.str.startswith("efecto")) & (cobs.referencia == "totales oficiales") & (cobs.estrato == "todas")]
        out.append({
            "modelo": NOM[m], "B · log loss": p(b.log_loss), "B · Brier": p(b.brier), "B · F1 argmax": p(b.f1_macro),
            "B · F1 con umbral": p(u.f1_macro_umbral) if (u is not None and hist == "movil") else "—",
            "B · ECE A/N/Abs": " / ".join(f"{e:.3f}" for e in u.ece) if (u is not None and hist == "movil") else "—",
            "A · log loss": p(a.log_loss), "A×B · log loss": p(c.log_loss), "A×B · F1": p(c.f1_macro),
            "Vot · EA afirm. Σp": p(v.esp_ea_A, 1), "Vot · EA neg. Σp": p(v.esp_ea_N, 1),
            "Spearman neg. Σp": p(v.spearman_N_esp, 2), "acierto resultado (Σp)": p(v.esp_ok_res, 2),
            "cobertura IC80 / IC90 (afirm · neg)": (f"{cov.A_IC80.iloc[0]:.2f}/{cov.A_IC90.iloc[0]:.2f} · {cov.N_IC80.iloc[0]:.2f}/{cov.N_IC90.iloc[0]:.2f}"
                                                    if len(cov) else "—"),
        })
    return md(pd.DataFrame(out))


def diferencia(res, resv, ro, el):
    """con_autor − solo_tema: rolling origin por fold, validación y bootstrap pareado por sesión."""
    s = el["seleccion"]
    filas = []
    for obj in ("voto", "presencia"):
        fa, pa = s[f"{obj}|con_autor"]
        fs, ps = s[f"{obj}|solo_tema"]
        a = ro[(ro.objetivo == obj) & (ro.variante == "con_autor") & (ro.familia == fa) & (ro.param == str(pa))].set_index("anio").log_loss
        b = ro[(ro.objetivo == obj) & (ro.variante == "solo_tema") & (ro.familia == fs) & (ro.param == str(ps))].set_index("anio").log_loss
        d = a - b
        filas.append({"métrica": f"RO · log loss {obj} (con_autor − solo_tema)", "diferencia": f"{d.mean():+.4f}",
                      "detalle": " · ".join(f"{k}: {v:+.3f}" for k, v in d.items()) + f" · con_autor gana {int((d < 0).sum())}/{len(d)}"})
    pa_ = pd.read_csv(D / "04_predicciones_validacion_con_autor.csv")
    ps_ = pd.read_csv(D / "04_predicciones_validacion_solo_tema.csv")
    m = pa_.merge(ps_, on=["votacion_id", "legislador_id", "sesion", "real4"], suffixes=("_a", "_s"))
    idx = m.real4.map({c: i for i, c in enumerate(CL4)}).values
    la = -np.log(np.clip(m[[f"p_{c}_a" for c in CL4]].values[np.arange(len(m)), idx], 1e-12, 1))
    ls = -np.log(np.clip(m[[f"p_{c}_s" for c in CL4]].values[np.arange(len(m)), idx], 1e-12, 1))
    cod, inv = np.unique(m.sesion.values, return_inverse=True)
    sd, n = np.bincount(inv, la - ls), np.bincount(inv).astype(float)
    W = pesos_bootstrap(len(cod), 2000, np.random.default_rng(0))
    boot = (W @ sd) / (W @ n)
    lo, hi = np.percentile(boot, [2.5, 97.5])
    filas.append({"métrica": "Val · log loss A×B 4 clases (con_autor − solo_tema)", "diferencia": f"{(la - ls).mean():+.4f}",
                  "detalle": f"IC95 bootstrap pareado por sesión [{lo:+.4f}; {hi:+.4f}]"})
    V = resv[(resv.conjunto == "VALIDACION") & (resv.historial == "movil")].set_index("modelo")
    for k, nombre, d in (("esp_ea_N", "Val · EA neg. Σp", 1), ("esp_ea_A", "Val · EA afirm. Σp", 1), ("spearman_N_esp", "Val · Spearman neg.", 2),
                         ("esp_ok_res", "Val · acierto resultado", 2)):
        filas.append({"métrica": nombre, "diferencia": f"{pt(V.loc['con_autor', k]) - pt(V.loc['solo_tema', k]):+.{d}f}",
                      "detalle": f"con_autor {pt(V.loc['con_autor', k]):.{d}f} · solo_tema {pt(V.loc['solo_tema', k]):.{d}f}"})
    for nombre, ev, k in (("Val · F1 B con umbral", "B_umbral", "f1_macro_umbral"), ("Val · log loss B", "B_voto_presente", "log_loss")):
        a, b = pt(fila(res, ev, "con_autor")[k]), pt(fila(res, ev, "solo_tema")[k])
        filas.append({"métrica": nombre, "diferencia": f"{a - b:+.3f}", "detalle": f"con_autor {a:.3f} · solo_tema {b:.3f}"})
    return md(pd.DataFrame(filas))


def tabla_calibracion(el, res):
    filas = []
    oof = res[res.conjunto == "OOF"].set_index("modelo")
    for v, c in el["calibracion"].items():
        for obj in ("voto", "presencia"):
            det = c[f"detalle_{obj}"]
            filas.append({"variante": v, "objetivo": obj, "elegido (RO)": c[obj],
                          "log loss RO · sin calibrar / temperatura / isotónica": " / ".join(f"{det[k]:.4f}" for k in ("sin_calibrar", "temperatura", "isotonica")),
                          "T": "—" if c[f"T_{obj}"] is None else f"{c[f'T_{obj}']:.3f}",
                          "ECE OOF A/N/Abs antes → después": (" / ".join(f"{e:.3f}" for e in oof.loc[v, "ece_sin_calibrar"]) + " → " +
                                                             " / ".join(f"{e:.3f}" for e in oof.loc[v, "ece"])) if obj == "voto" else "—"})
    return md(pd.DataFrame(filas))


def tabla_umbral(el, res):
    filas = []
    for v in ("solo_tema", "con_autor"):
        w = el["pesos"][v]
        u, u0 = fila(res, "B_umbral", v), fila(res, "B_umbral", f"{v}__sin_calibrar")
        filas.append({"variante": v, "pesos (AFIRM, NEG, ABST)": ", ".join(f"{x:g}" for x in w["pesos"]),
                      "F1 OOF argmax → con umbral": f"{w['f1_oof_argmax']:.3f} → {w['f1_oof']:.3f}",
                      "F1 validación argmax → con umbral": f"{u0.f1_macro_umbral:.3f} → {u.f1_macro_umbral:.3f}"})
    t = md(pd.DataFrame(filas))
    conf = []
    for v in ("solo_tema", "con_autor"):
        cm = pd.DataFrame(fila(res, "B_umbral", v).confusion_umbral, columns=["pred AFIRM", "pred NEG", "pred ABST"])
        cm.insert(0, "real", ["AFIRM", "NEG", "ABST"])
        conf.append(f"**{v} · con umbral (validación)**\n\n" + md(cm))
    return t + "\n\n" + "\n\n".join(conf)


def tabla_sigma(el):
    filas = []
    for v, s in el["sigma"].items():
        g = pd.DataFrame(s["grilla"]).sort_values("desvio_nominal")
        for r in g.head(4).itertuples():
            filas.append({"variante": v, "σ bloque": f"{r.sigma:g}", "τ votación": f"{r.tau:g}", "elegido": "✔" if [r.sigma, r.tau] == s["sigma"] else "",
                          "cob. IC80 afirm/neg": f"{r.A_IC80:.2f} / {r.N_IC80:.2f}", "cob. IC90 afirm/neg": f"{r.A_IC90:.2f} / {r.N_IC90:.2f}",
                          "ancho IC80 afirm/neg": f"{r.A_IC80_ancho:.0f} / {r.N_IC80_ancho:.0f}"})
        r0 = g[(g.sigma == 0) & (g.tau == 0)].iloc[0]
        filas.append({"variante": v, "σ bloque": "0", "τ votación": "0", "elegido": "(independencia)",
                      "cob. IC80 afirm/neg": f"{r0.A_IC80:.2f} / {r0.N_IC80:.2f}", "cob. IC90 afirm/neg": f"{r0.A_IC90:.2f} / {r0.N_IC90:.2f}",
                      "ancho IC80 afirm/neg": f"{r0.A_IC80_ancho:.0f} / {r0.N_IC80_ancho:.0f}"})
    return md(pd.DataFrame(filas))


def tabla_coberturas(cobs, estrato):
    c = cobs[cobs.estrato == estrato].copy()
    c["IC80 afirm / neg"] = c.A_IC80.map("{:.2f}".format) + " / " + c.N_IC80.map("{:.2f}".format)
    c["IC90 afirm / neg"] = c.A_IC90.map("{:.2f}".format) + " / " + c.N_IC90.map("{:.2f}".format)
    c["ancho IC80 afirm / neg"] = c.A_IC80_ancho.map("{:.0f}".format) + " / " + c.N_IC80_ancho.map("{:.0f}".format)
    return md(c[["conjunto", "metodo", "referencia", "votaciones", "IC80 afirm / neg", "IC90 afirm / neg", "ancho IC80 afirm / neg"]])


def tabla_divididas(resv):
    filas = []
    for r in resv[(resv.historial.fillna("movil") == "movil")].itertuples():
        if r.modelo not in NOM:
            continue
        g = lambda k: p(getattr(r, k), 1) if isinstance(getattr(r, k, None), tuple) else "—"  # noqa: E731
        filas.append({"conjunto": r.conjunto, "modelo": NOM[r.modelo], "votaciones divididas (<100)": r.n_dividida_lt100,
                      "EA afirm. Σp": g("dividida_lt100__esp_ea_A"), "EA neg. Σp": g("dividida_lt100__esp_ea_N"),
                      "EA neg. argmax": g("dividida_lt100__pred_ea_N"), "consensuadas · EA neg. Σp": g("consensuada_ge100__esp_ea_N")})
    return md(pd.DataFrame(filas))


def tabla_subgrupos(res):
    filas = []
    for hist in ("movil", "congelado"):
        for m in ("ref_etapa2", "solo_tema", "con_autor"):
            for sub in ("con_historial", "sin_historial"):
                x = fila(res, "B_voto_presente", m, sub, hist)
                if x is not None:
                    filas.append({"historial": hist, "modelo": NOM[m], "subgrupo": sub, "n": x.n, "log loss": p(x.log_loss), "F1 macro": p(x.f1_macro)})
    return md(pd.DataFrame(filas))


def diagnostico():
    CL = CL4
    out = []
    t3 = pd.read_csv(D / "03_metricas_votacion.csv")
    t3 = t3[(t3.historial == "movil") & (t3.modelo == "d_todas__pres_d_presencia_proyecto")]
    w = t3[t3.pred_res != t3.res_oficial_reglas]
    t4 = pd.read_csv(D / "04_votaciones_validacion.csv")
    w4 = t4[(t4.esp_res != t4.res_oficial_reglas) | (t4.pred_res != t4.res_oficial_reglas)]
    tabla = pd.concat([w.assign(modelo="etapa3_d_todas"), w4])[["modelo", "votacion_id", "pred_res", "esp_res", "pred_AFIRMATIVO", "pred_NEGATIVO",
                                                                 "esp_AFIRMATIVO", "esp_NEGATIVO", "of_A", "of_N"]].drop_duplicates(["modelo", "votacion_id"]).round(1)
    out.append(md(tabla))
    p_ = pd.read_csv(D / "03_predicciones_validacion_d_todas__pres_d_presencia_proyecto.csv")
    vid = w.votacion_id.iloc[0]
    g = p_[p_.votacion_id == vid].copy()
    g["pred"] = np.array(CL)[g[[f"p_{c}" for c in CL]].values.argmax(1)]
    b = g.groupby(["bloque_inicio", "signo_inicio"]).agg(
        diputados=("pred", "size"), pred_afirm=("pred", lambda s: (s == "AFIRMATIVO").sum()), pred_neg=("pred", lambda s: (s == "NEGATIVO").sum()),
        esp_neg=("p_NEGATIVO", "sum"), real_afirm=("real4", lambda s: (s == "AFIRMATIVO").sum()), real_neg=("real4", lambda s: (s == "NEGATIVO").sum())
    ).reset_index().sort_values("diputados", ascending=False).head(8).round(1)
    out.append(f"Desglose por bloque de **{vid}** (etapa 3, todas las features):\n\n" + md(b))
    return "\n\n".join(out), vid


def tabla_tema():
    r = pd.read_csv(D / "04_tema_robustez.csv")
    r["valor"] = r["% OTROS"] + " · " + r["% igual al tema original"]
    t = r.pivot_table(index=["entrada", "regla"], columns="split", values="valor", aggfunc="first").reset_index()
    t.columns = ["entrada", "regla", "train: % OTROS · % igual", "validación: % OTROS · % igual"]
    orden = list(dict.fromkeys(r.entrada))
    t["o"] = t.entrada.map(orden.index)
    return md(t.sort_values(["o", "regla"]).drop(columns="o"))


# ---------------------------------------------------------------- figura


def figura(curvas, el):
    plt.rcParams.update({"font.size": 10, "axes.edgecolor": TINTA, "axes.labelcolor": TINTA, "xtick.color": TINTA, "ytick.color": TINTA})
    fig, ax = plt.subplots(2, 3, figsize=(12, 7.6), sharex=True, sharey=True, facecolor=SUPERFICIE)
    series = [("OOF", False, "OOF · sin calibrar", NARANJA, "o"), ("OOF", True, "OOF · calibrado", AZUL, "s"), ("VALIDACION", True, "Validación · calibrado", AQUA, "D")]
    for i, var in enumerate(("solo_tema", "con_autor")):
        for k in range(3):
            a = ax[i, k]
            a.set_facecolor(SUPERFICIE)
            a.plot([0, 1], [0, 1], ls="--", lw=1, color=TINTA, alpha=0.6)
            for conj, calib, etiqueta, color, mk in series:
                c = [x for x in curvas if x["variante"] == var and x["conjunto"] == conj and x["clase"] == k and x["calibrado"] == calib]
                if not c or not c[0]["puntos"]:
                    continue
                xs, ys, ns = zip(*c[0]["puntos"])
                a.plot(xs, ys, lw=2, color=color, marker=mk, ms=6, mec=SUPERFICIE, mew=1.5, label=etiqueta)
            a.set_title(f"{var} · {CL3[k]}", color=TINTA, fontsize=10, loc="left")
            a.grid(alpha=0.15)
            for s in ("top", "right"):
                a.spines[s].set_visible(False)
            if i == 1:
                a.set_xlabel("probabilidad predicha")
            if k == 0:
                a.set_ylabel("frecuencia observada")
    ax[0, 0].legend(frameon=False, loc="upper left", fontsize=9)
    cal = el["calibracion"]
    fig.suptitle(f"Curvas de calibración de voto | presente · calibrador elegido por RO: solo_tema={cal['solo_tema']['voto']}, "
                 f"con_autor={cal['con_autor']['voto']} (bins de 0,1 con ≥ 20 filas)", color=TINTA, fontsize=11, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(rutas.REPORTES / "04_calibracion.png", dpi=130, facecolor=SUPERFICIE)


def main():
    res = pd.read_pickle(D / "04_metricas_filas.pkl")
    resv = pd.read_pickle(D / "04_resumen_votacion.pkl")
    cobs = pd.read_csv(D / "04_coberturas.csv")
    ro = pd.read_csv(D / "04_rolling_origin.csv")
    el = json.load(open(D / "04_elegidos.json", encoding="utf-8"))
    curvas = pd.read_pickle(D / "04_curvas.pkl")
    figura(curvas, el)
    diag, vid = diagnostico()
    ea = el["ejecutivo_anterior_train"]
    plantilla = Path(__file__).with_name("04_reporte_plantilla.md").read_text(encoding="utf-8")
    texto = plantilla.format(
        ro=tabla_ro(ro), principal=tabla_principal(res, resv, cobs, el), congelado=tabla_principal(res, resv, cobs, el, "congelado"),
        diferencia=diferencia(res, resv, ro, el), calibracion=tabla_calibracion(el, res), umbral=tabla_umbral(el, res),
        sigma=tabla_sigma(el), cob_todas=tabla_coberturas(cobs, "todas"), cob_div=tabla_coberturas(cobs, "divididas (<100)"),
        divididas=tabla_divididas(resv), diagnostico=diag, subgrupos=tabla_subgrupos(res), tema=tabla_tema(),
        ea_filas=f"{ea['filas']:,}".replace(",", "."), ea_vot=ea["votaciones"],
        ea_detalle="; ".join(f"{x['votaciones']} votación(es) de un proyecto de {x['gobierno_publicacion']} votado con {x['gobierno_inicio']}" for x in ea["por_gobierno"]),
        ea_afirm=f"{ea['distribucion_voto'].get('AFIRMATIVO', 0):.1%}",
    )
    (rutas.REPORTES / "04_modelos.md").write_text(texto, encoding="utf-8")
    print("Escrito", rutas.REPORTES / "04_modelos.md")


if __name__ == "__main__":
    main()
