"""Etapa 4 · Logística vs LightGBM, calibración, umbral e intervalos de conteo.

Todo lo que se ajusta (hiperparámetros, familia, calibrador, pesos de decisión, σ del efecto
por bloque, residuos empíricos) sale del ROLLING ORIGIN dentro de ENTRENAMIENTO (predicciones
out-of-fold). VALIDACIÓN sólo se transforma y se reporta. PRUEBA no se carga.

Variantes finales:
  solo_tema  · voto: tema + hist_tema · presencia: tema (lo que la app puede usar hoy)
  con_autor  · voto: origen, signo_autor, alineacion, inter_signo, inter_bloque, tema, hist_tema
               presencia: origen, alineacion, inter_signo, tema
  (es_autor se saca: no aporta en la etapa 3)

Uso: .venv\\Scripts\\python -I scripts\\04_modelos.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from joblib import Parallel, delayed  # noqa: E402

from poroteo import calibracion as CAL  # noqa: E402
from poroteo import intervalos as IV  # noqa: E402
from poroteo import metricas as M  # noqa: E402
from poroteo import rutas  # noqa: E402
from poroteo.carga import leer_dataset  # noqa: E402
from poroteo.modelos import Historial, LGBMProyecto, Logistica, LogisticaProyecto  # noqa: E402
from poroteo.proyectos import tema_por_votacion, votos_elegibles  # noqa: E402
from poroteo.validacion import particiones_ro, train_presencia_fold  # noqa: E402

_spec = importlib.util.spec_from_file_location("p3", Path(__file__).with_name("03_proyecto.py"))
P3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P3)

DERIV = rutas.RAIZ / "derivados"
N_JOBS = max(1, (os.cpu_count() or 2) - 1)
CL4 = IV.CL4
VARIANTES = {
    "solo_tema": {"voto": ("tema", "hist_tema"), "presencia": ("tema",)},
    "con_autor": {"voto": ("origen", "signo_autor", "alineacion", "inter_signo", "inter_bloque", "tema", "hist_tema"),
                  "presencia": ("origen", "alineacion", "inter_signo", "tema")},
    # Etapa 4b: las mismas variantes con la alineación reciente bloque ↔ oficialismo (voto y presencia)
    "solo_tema_alin": {"voto": ("tema", "hist_tema", "alin_reciente"), "presencia": ("tema", "alin_reciente")},
    "con_autor_alin": {"voto": ("origen", "signo_autor", "alineacion", "inter_signo", "inter_bloque", "tema", "hist_tema", "alin_reciente"),
                       "presencia": ("origen", "alineacion", "inter_signo", "tema", "alin_reciente")},
}
GRID = {
    ("voto", "logistica"): [0.0003, 0.001, 0.003, 0.01, 0.03],
    ("presencia", "logistica"): [0.0003, 0.001, 0.003],
    ("voto", "lgbm"): ["h4_n60", "h7_n60", "h7_n150", "h15_n100", "h15_n300"],
    ("presencia", "lgbm"): ["h4_n60", "h7_n60", "h7_n150", "h15_n100", "h15_n300"],
}
LGBM_PARAMS = {"h4_n60": dict(num_leaves=4, n_estimators=60), "h7_n60": dict(num_leaves=7, n_estimators=60),
               "h7_n150": dict(num_leaves=7, n_estimators=150), "h15_n100": dict(num_leaves=15, n_estimators=100),
               "h15_n300": dict(num_leaves=15, n_estimators=300)}
GRILLA_SIGMA = [(s, t) for s in (0.0, 0.5, 1.0, 1.5, 2.0) for t in (0.0, 1.0, 2.0, 3.0, 4.0)]


sys.stdout.reconfigure(encoding="utf-8")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def fabricar(variante, objetivo, familia, param):
    g = VARIANTES[variante][objetivo]
    nombre = f"{variante}__{familia}"
    if familia == "logistica":
        return LogisticaProyecto(objetivo, param, grupos=g, nombre=nombre)
    return LGBMProyecto(objetivo, LGBM_PARAMS[param], grupos=g, nombre=nombre)


def candidatos(objetivo):
    for v in VARIANTES:
        for fam in ("logistica", "lgbm"):
            for p in GRID[(objetivo, fam)]:
                yield v, fam, p


# ---------------------------------------------------------------- pasada 1: selección


def _ajuste(objetivo, Y, v, fam, p, a, val):
    P = fabricar(v, objetivo, fam, p).fit(a).predict_proba(val)
    return {"objetivo": objetivo, "anio": Y, "variante": v, "familia": fam, "param": str(p),
            "log_loss": CAL.log_loss(val.y.values, P), "f1_macro": CAL.f1_macro(val.y.values, P.argmax(1), P.shape[1]),
            "anio_max_train": int(a.anio.max()), "n": len(val)}


def rolling(df, objetivo):
    tareas = [(objetivo, Y, v, fam, p, a, val) for Y, a, val in particiones_ro(df) for v, fam, p in candidatos(objetivo)]
    log(f"  {objetivo}: {len(tareas)} ajustes")
    return pd.DataFrame(Parallel(n_jobs=N_JOBS)(delayed(_ajuste)(*t) for t in tareas))


def elegir(ro):
    m = ro.groupby(["objetivo", "variante", "familia", "param"]).log_loss.mean().reset_index()
    mejor_familia = m.loc[m.groupby(["objetivo", "variante", "familia"]).log_loss.idxmin()]
    mejor = m.loc[m.groupby(["objetivo", "variante"]).log_loss.idxmin()]
    return mejor_familia, mejor


def _param(p):
    try:
        return float(p)
    except ValueError:
        return p


# ---------------------------------------------------------------- pasada 2: OOF del elegido


def _oof_fold(variante, sel, Y, a, val, preM):
    fv, pv_ = sel[("voto", variante)]
    fp, pp_ = sel[("presencia", variante)]
    mv = fabricar(variante, "voto", fv, pv_).fit(a)
    Pb = mv.predict_proba(val)
    grupos = set(val.grupo_proyecto)
    mp = fabricar(variante, "presencia", fp, pp_).fit(train_presencia_fold(preM, Y, grupos))
    cv = preM[(preM.split == "ENTRENAMIENTO") & preM.votacion_id.isin(set(val.votacion_id))].copy()
    cv = cv.merge(val[["votacion_id", "legislador_id", "objetivo_voto"]], how="left")
    cv["real4"] = np.where(cv.y == 0, "AUSENTE", cv.objetivo_voto)
    return {"anio": Y, "anio_max_train": int(a.anio.max()), "B_P": Pb, "B_y": val.y.values,
            "B_meta": val[["votacion_id", "legislador_id", "sesion"]].reset_index(drop=True),
            "A_pv": mv.predict_proba(cv), "A_pp": mp.predict_proba(cv)[:, 1], "A_y": cv.y.values,
            "cv": cv[["votacion_id", "legislador_id", "sesion", "real4", "bloque_inicio"]].reset_index(drop=True)}


def _oof_presencia(variante, sel, Y, a, val):
    fp, pp_ = sel[("presencia", variante)]
    P = fabricar(variante, "presencia", fp, pp_).fit(a).predict_proba(val)
    return (Y, P, val.y.values)


# ---------------------------------------------------------------- utilidades


def tabla_conteos(cv, P4, oficial):
    t = P3.tabla_vot(cv, P4, oficial)
    t["margen_oficial"] = (t.of_A - t.of_N).abs()
    return t


def coberturas(t, cv, P4, sigma, residuos, etiqueta):
    filas = []
    d = cv[["votacion_id", "bloque_inicio"]].copy()
    for i, c in enumerate(CL4):
        d[f"p_{c}"] = P4[:, i]
    for metodo, iv in (("independiente (σ=0)", IV.intervalos_simulados(d, 0.0)),
                       (f"efecto bloque + votación (σ={sigma[0]:g}, τ={sigma[1]:g})", IV.intervalos_simulados(d, sigma[0], tau=sigma[1])),
                       ("empírico (residuos OOF)", IV.intervalos_empiricos(t, residuos))):
        for ref, ra, rn in (("filas existentes", "real_filas_AFIRMATIVO", "real_filas_NEGATIVO"), ("totales oficiales", "of_A", "of_N")):
            for estrato, mask in (("todas", np.ones(len(t), bool)), ("divididas (<100)", t.margen_oficial.values < 100)):
                if mask.sum():
                    filas.append({"conjunto": etiqueta, "metodo": metodo, "referencia": ref, "estrato": estrato,
                                  "votaciones": int(mask.sum()), **IV.cobertura(t[mask], iv, ra, rn)})
    return filas


def main():
    t0 = time.time()
    tabla = pd.read_csv(DERIV / "proyectos_features.csv", dtype=str, keep_default_na=False)
    eleg = votos_elegibles()
    filas = pd.concat([leer_dataset(n, ["votacion_id", "expediente", "split"]) for n in ("general", "presencia")])
    filas = filas[filas.split.isin(["ENTRENAMIENTO", "VALIDACION"])]
    tema_vot = tema_por_votacion(tabla, filas)
    log("Preparando datos (mismas features que la etapa 3)…")
    gen = P3.preparar("general", tabla, eleg, tema_vot)
    pre = P3.preparar("presencia", tabla, eleg, tema_vot)
    assert not gen.split.eq("PRUEBA").any() and not pre.split.eq("PRUEBA").any()
    genM, preM = P3.con_historial(gen, "movil"), P3.con_historial(pre, "movil")
    oficial = P3.totales_oficiales()

    # 5 · filas de train con Ejecutivo de un gobierno anterior
    trg = genM[genM.split == "ENTRENAMIENTO"]
    ea = trg[trg.alineacion_gobierno_sesion == "EJECUTIVO_ANTERIOR"]
    info = {"ejecutivo_anterior_train": {"filas": int(len(ea)), "votaciones": int(ea.votacion_id.nunique()),
                                         "por_gobierno": ea.groupby(["gobierno_publicacion", "gobierno_inicio"]).votacion_id.nunique().reset_index()
                                         .rename(columns={"votacion_id": "votaciones"}).to_dict("records"),
                                         "distribucion_voto": ea.objetivo_voto.value_counts(normalize=True).round(3).to_dict()}}
    log("Ejecutivo anterior en train:", info["ejecutivo_anterior_train"]["filas"], "filas")

    log("Pasada 1 · rolling origin, logística vs LightGBM…")
    ro = pd.concat([rolling(genM, "voto"), rolling(preM, "presencia")])
    assert (ro.anio_max_train < ro.anio).all()
    ro.to_csv(DERIV / "04_rolling_origin.csv", index=False)
    mejor_familia, mejor = elegir(ro)
    sel = {(r.objetivo, r.variante): (r.familia, _param(r.param)) for r in mejor.itertuples()}
    log("Elegidos:", sel)

    log("Pasada 2 · predicciones out-of-fold del modelo elegido…")
    calibradores = {}
    oof, cal, pesos, sigma, residuos, cobs, curvas, filas_res, resumen, tablas_val = {}, {}, {}, {}, {}, [], [], [], [], []
    for var in VARIANTES:
        folds = list(particiones_ro(genM))
        oof[var] = Parallel(n_jobs=N_JOBS)(delayed(_oof_fold)(var, sel, Y, a, v, preM) for Y, a, v in folds)
        oofp = Parallel(n_jobs=N_JOBS)(delayed(_oof_presencia)(var, sel, Y, a, v) for Y, a, v in particiones_ro(preM))
        assert all(o["anio_max_train"] < o["anio"] for o in oof[var])

        # Calibración: elegida con rolling sobre los folds OOF
        nb, detB = CAL.elegir_calibrador([(o["anio"], o["B_P"], o["B_y"]) for o in oof[var]])
        na, detA = CAL.elegir_calibrador(oofp)
        PB = np.vstack([o["B_P"] for o in oof[var]])
        yB = np.concatenate([o["B_y"] for o in oof[var]])
        PA = np.vstack([o[1] for o in oofp])
        yA = np.concatenate([o[2] for o in oofp])
        cB, cA = CAL.CALIBRADORES[nb]().fit(PB, yB), CAL.CALIBRADORES[na]().fit(PA, yA)
        calibradores[var] = (cB, cA)
        cal[var] = {"voto": nb, "presencia": na, "detalle_voto": detB["medias"], "detalle_presencia": detA["medias"],
                    "T_voto": getattr(cB, "T", None), "T_presencia": getattr(cA, "T", None)}

        # Umbral (pesos por clase) sobre OOF calibrado
        PBc = cB.transform(PB)
        w, f1w = CAL.elegir_pesos(PBc, yB)
        pesos[var] = {"pesos": w, "f1_oof": f1w, "f1_oof_argmax": CAL.f1_macro(yB, PBc.argmax(1), 3)}

        # Combinado OOF calibrado → tabla por votación, σ y residuos
        cvO = pd.concat([o["cv"] for o in oof[var]], ignore_index=True)
        ppO = np.concatenate([o["A_pp"] for o in oof[var]])
        ppO = cA.transform(np.c_[1 - ppO, ppO])[:, 1:2]
        pvO = cB.transform(np.vstack([o["A_pv"] for o in oof[var]]))
        P4O = np.c_[ppO * pvO, 1 - ppO]
        tO = tabla_conteos(cvO, P4O, oficial)
        dO = cvO[["votacion_id", "bloque_inicio"]].copy()
        for i, c in enumerate(CL4):
            dO[f"p_{c}"] = P4O[:, i]
        s, tabla_sigma = IV.elegir_sigma(dO, tO, GRILLA_SIGMA, "real_filas_AFIRMATIVO", "real_filas_NEGATIVO")
        sigma[var] = {"sigma": list(s), "grilla": tabla_sigma.to_dict("records")}
        residuos[var] = {"A": (tO.real_filas_AFIRMATIVO - tO.esp_AFIRMATIVO).values, "N": (tO.real_filas_NEGATIVO - tO.esp_NEGATIVO).values}
        cobs += coberturas(tO, cvO, P4O, s, residuos[var], f"OOF ({var})")
        tO["variante"] = var
        tO.to_csv(DERIV / f"04_oof_votaciones_{var}.csv", index=False)
        r = P3.resumen_votaciones(tO.rename(columns={}))
        resumen.append({"modelo": var, "conjunto": "OOF", "calibrado": True, **r})
        for k in range(3):
            curvas.append({"variante": var, "conjunto": "OOF", "objetivo": "voto", "clase": k, "calibrado": False, "puntos": CAL.curva_calibracion(yB, PB, k)})
            curvas.append({"variante": var, "conjunto": "OOF", "objetivo": "voto", "clase": k, "calibrado": True, "puntos": CAL.curva_calibracion(yB, PBc, k)})
        filas_res.append({"modelo": var, "conjunto": "OOF", "evaluacion": "B_voto_presente", "calibrado": True,
                          "log_loss": CAL.log_loss(yB, PBc), "ece": CAL.ece_por_clase(yB, PBc),
                          "ece_sin_calibrar": CAL.ece_por_clase(yB, PB), "log_loss_sin_calibrar": CAL.log_loss(yB, PB)})
        log(f"  {var}: calibrador voto={nb}, presencia={na}, pesos={w}, σ={s}")

    log("Ajuste final con todo ENTRENAMIENTO y evaluación en VALIDACIÓN…")
    trv, trp = genM[genM.split == "ENTRENAMIENTO"], preM[preM.split == "ENTRENAMIENTO"]
    finales = {}
    for var in VARIANTES:
        finales[var] = (fabricar(var, "voto", *sel[("voto", var)]).fit(trv), fabricar(var, "presencia", *sel[("presencia", var)]).fit(trp))
    el3 = json.load(open(DERIV / "03_elegidos.json"))
    el2 = json.load(open(DERIV / "02_elegidos.json"))
    ref2 = (Logistica("voto", el2["voto"]["c_logistica_bloque_signo"], True).fit(trv),
            Historial("presencia", el2["presencia"]["b_historial_bloque_signo"], True).fit(trp))
    ref3 = (LogisticaProyecto("voto", el3["voto"]["d_todas"], grupos=P3.VARIANTES_VOTO["d_todas"]["grupos"]).fit(trv),
            LogisticaProyecto("presencia", el3["presencia"]["d_presencia_proyecto"], grupos=P3.GRUPOS_PRES).fit(trp))

    for hist in ("movil", "congelado"):
        gv = P3.con_historial(gen[gen.split == "VALIDACION"], hist).reset_index(drop=True)
        pv = P3.con_historial(pre[pre.split == "VALIDACION"], hist).reset_index(drop=True)
        cv = pv[pv.votacion_id.isin(set(gv.votacion_id))].merge(gv[["votacion_id", "legislador_id", "objetivo_voto"]], how="left")
        cv["real4"] = np.where(cv.y == 0, "AUSENTE", cv.objetivo_voto)
        y4 = cv.real4.map({c: i for i, c in enumerate(CL4)}).values
        modelos = {"ref_etapa2": (*ref2, CAL.SinCalibrar(), CAL.SinCalibrar(), [1, 1, 1]),
                   "etapa3_d_todas": (*ref3, CAL.SinCalibrar(), CAL.SinCalibrar(), [1, 1, 1])}
        for var in VARIANTES:
            mv, mp = finales[var]
            cB, cA = calibradores[var]
            modelos[f"{var}__sin_calibrar"] = (mv, mp, CAL.SinCalibrar(), CAL.SinCalibrar(), [1, 1, 1])
            modelos[var] = (mv, mp, cB, cA, pesos[var]["pesos"])
        for nombre, (mv, mp, cB, cA, w) in modelos.items():
            Pb = cB.transform(mv.predict_proba(gv))
            for r in P3.bloque_filas(gv.y.values, Pb, 3, gv, "B_voto_presente"):
                filas_res.append(dict(r, modelo=nombre, conjunto="VALIDACION", historial=hist))
            if hist == "movil":
                pw = CAL.predecir_con_pesos(Pb, w)
                cm = np.zeros((3, 3), int); np.add.at(cm, (gv.y.values, pw), 1)
                filas_res.append({"modelo": nombre, "conjunto": "VALIDACION", "historial": hist, "evaluacion": "B_umbral",
                                  "f1_macro_umbral": CAL.f1_macro(gv.y.values, pw, 3), "confusion_umbral": cm.tolist(),
                                  "ece": CAL.ece_por_clase(gv.y.values, Pb), "pesos": w})
                for k in range(3):
                    curvas.append({"variante": nombre, "conjunto": "VALIDACION", "objetivo": "voto", "clase": k, "calibrado": True,
                                   "puntos": CAL.curva_calibracion(gv.y.values, Pb, k)})
            Pa = cA.transform(mp.predict_proba(pv))
            for r in P3.bloque_filas(pv.y.values, Pa, 2, pv, "A_presencia"):
                filas_res.append(dict(r, modelo=nombre, conjunto="VALIDACION", historial=hist))
            pp = cA.transform(mp.predict_proba(cv))[:, 1:2]
            P4 = np.c_[pp * cB.transform(mv.predict_proba(cv)), 1 - pp]
            for r in P3.bloque_filas(y4, P4, 4, cv, "AxB_combinado_4_clases"):
                filas_res.append(dict(r, modelo=nombre, conjunto="VALIDACION", historial=hist))
            t = tabla_conteos(cv, P4, oficial)
            resumen.append({"modelo": nombre, "conjunto": "VALIDACION", "historial": hist, **P3.resumen_votaciones(t)})
            if hist == "movil":
                t["modelo"] = nombre
                tablas_val.append(t)
                if nombre in VARIANTES:
                    cobs += coberturas(t, cv, P4, tuple(sigma[nombre]["sigma"]), residuos[nombre], f"VALIDACION ({nombre})")
                    out = cv[["votacion_id", "legislador_id", "sesion", "real4", "bloque_inicio", "signo_inicio", "tema"]].copy()
                    for i, c in enumerate(CL4):
                        out[f"p_{c}"] = P4[:, i]
                    out.to_csv(DERIV / f"04_predicciones_validacion_{nombre}.csv", index=False)
        log(f"  evaluado historial {hist}")

    pd.DataFrame(filas_res).to_pickle(DERIV / "04_metricas_filas.pkl")
    pd.to_pickle(pd.DataFrame(resumen), DERIV / "04_resumen_votacion.pkl")
    pd.DataFrame(cobs).to_csv(DERIV / "04_coberturas.csv", index=False)
    pd.to_pickle(curvas, DERIV / "04_curvas.pkl")
    pd.concat(tablas_val).to_csv(DERIV / "04_votaciones_validacion.csv", index=False)
    json.dump({"seleccion": {f"{k[0]}|{k[1]}": [v[0], v[1]] for k, v in sel.items()},
               "mejor_por_familia": mejor_familia.to_dict("records"), "calibracion": cal, "pesos": pesos,
               "sigma": sigma, **info}, open(DERIV / "04_elegidos.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)
    log(f"Listo en {(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
