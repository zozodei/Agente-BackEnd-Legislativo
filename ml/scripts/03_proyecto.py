"""Etapa 3 · Features de proyecto. Selección con rolling origin dentro de ENTRENAMIENTO;
VALIDACIÓN sólo para reportar. PRUEBA no se carga.

Requiere derivados/proyectos_features.csv (scripts/03a_proyectos_features.py).

Variantes de voto | presente (todas logísticas, sin class weights):
  c_logistica_bloque_signo   referencia de la etapa 2
  c_familia_signo / c_bloque_interbloque_signo   agrupaciones más estables del bloque
  d_todas                    todos los grupos de proyecto
  d_sin_<g>                  ablación: todos menos el grupo g
  c_mas_<g>                  referencia + sólo el grupo g
Presencia: (b) historial + prior bloque/signo (elección etapa 2) vs logística con proyecto.

Uso: .venv\\Scripts\\python -I scripts\\03_proyecto.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from joblib import Parallel, delayed  # noqa: E402

from poroteo import alineacion as AL  # noqa: E402
from poroteo import metricas as M  # noqa: E402
from poroteo import rutas  # noqa: E402
from poroteo.carga import consulta, leer_dataset  # noqa: E402
from poroteo.features import COLUMNAS_BASE, agregar_contexto, conteos  # noqa: E402
from poroteo.modelos import CLASES, GRUPOS_PROYECTO, Historial, LogisticaProyecto  # noqa: E402
from poroteo.proyectos import features_sesion, historial_tema, tema_por_votacion, votos_elegibles  # noqa: E402

DERIV = rutas.RAIZ / "derivados"
B = 1000
ANIOS_RO = list(range(2017, 2023))
GRID_C = [0.0003, 0.001, 0.003, 0.01, 0.03, 0.1]
GRID_C_PRES = [0.0003, 0.001, 0.003, 0.01]
GRID_ALPHA_PRES = [30, 100, 300]
CL4 = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION", "AUSENTE"]
GR = list(GRUPOS_PROYECTO)
N_JOBS = max(1, (os.cpu_count() or 2) - 1)

VARIANTES_VOTO = {
    "c_logistica_bloque_signo": dict(grupos=()),
    "c_familia_signo": dict(grupos=(), agrupacion="familia"),
    "c_bloque_interbloque_signo": dict(grupos=(), agrupacion="bloque+interbloque"),
    "d_todas": dict(grupos=GR),
    "d_todas_familia": dict(grupos=GR, agrupacion="familia"),
    **{f"d_sin_{g}": dict(grupos=tuple(x for x in GR if x != g)) for g in GR},
    **{f"c_mas_{g}": dict(grupos=(g,)) for g in GR},
}
GRUPOS_PRES = ("origen", "alineacion", "inter_signo", "tema")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- datos


def preparar(nombre: str, tabla: pd.DataFrame, elegibles: pd.DataFrame, tema_vot: pd.Series) -> pd.DataFrame:
    objetivo_col = "objetivo_voto" if nombre == "general" else "objetivo_presencia_registrada"
    df = leer_dataset(nombre, COLUMNAS_BASE + ["expediente", objetivo_col])
    df = df[df.split.isin(["ENTRENAMIENTO", "VALIDACION"])].copy()  # PRUEBA no se toca
    df = agregar_contexto(df)
    ses = consulta("select votacion_id, sesion_id from votacion_sesion")
    df = df.merge(ses, how="left", validate="m:1").rename(columns={"sesion_id": "sesion"})
    df["anio"] = df.fecha_inicio_sesion.str[:4].astype(int)
    if nombre == "general":
        df["y"] = df.objetivo_voto.map({c: i for i, c in enumerate(CLASES["voto"])}).astype(int)
    else:
        df["y"] = df.objetivo_presencia_registrada.astype(int)
    df = df.reset_index(drop=True)
    df["tema"] = df.expediente.map(dict(zip(tabla.expediente, tabla.tema))).fillna("OTROS")
    th = historial_tema(df, elegibles, tema_vot)
    out = features_sesion(df.drop(columns="tema"), tabla, th)
    # Etapa 4b: alineación reciente del bloque con el oficialismo (sólo votos anteriores al límite)
    return AL.agregar_alineacion_reciente(out, AL.acuerdos_bloque_oficialismo())


def con_historial(df: pd.DataFrame, variante: str) -> pd.DataFrame:
    out = df.copy()
    c = conteos(df, variante)
    out[["A", "N", "AB", "AU"]] = c.values
    out["sin_hist"] = c.sum(axis=1).values == 0
    return out


# ---------------------------------------------------------------- modelos


def fab_voto(nombre, C):
    return LogisticaProyecto("voto", C, nombre=nombre, **VARIANTES_VOTO[nombre])


def candidatos_presencia():
    for a in GRID_ALPHA_PRES:
        yield "b_historial_bloque_signo", a, (lambda a=a: Historial("presencia", a, True))
    for C in GRID_C_PRES:
        yield "d_presencia_proyecto", C, (lambda C=C: LogisticaProyecto("presencia", C, grupos=GRUPOS_PRES, nombre="d_presencia_proyecto"))


def _eval_fold(objetivo, Y, nombre, param, fab, a, v):
    P = fab().fit(a).predict_proba(v)
    m = M.metricas_filas(v.y.values, P, len(CLASES[objetivo]), v.sesion.values, B=1)
    return {"objetivo": objetivo, "anio": Y, "modelo": nombre, "param": param,
            "log_loss": m["log_loss"][0], "f1_macro": m["f1_macro"][0], "brier": m["brier"][0], "n": m["n"]}


def rolling_origin(df, objetivo) -> pd.DataFrame:
    tr = df[df.split == "ENTRENAMIENTO"]
    tareas = []
    for Y in ANIOS_RO:
        a = tr[tr.anio <= Y - 1]
        v = tr[(tr.anio == Y) & ~tr.grupo_proyecto.isin(set(a.grupo_proyecto))]
        if v.empty:  # 2020-2021 sin votaciones generales
            continue
        log(f"  RO {objetivo} {Y}: train {len(a)} · valida {len(v)} ({v.votacion_id.nunique()} votaciones)")
        if objetivo == "voto":
            for nombre in VARIANTES_VOTO:
                for C in GRID_C:
                    tareas.append((objetivo, Y, nombre, C, (lambda nombre=nombre, C=C: fab_voto(nombre, C)), a, v))
        else:
            for nombre, p, fab in candidatos_presencia():
                tareas.append((objetivo, Y, nombre, p, fab, a, v))
    log(f"  {len(tareas)} ajustes en {N_JOBS} procesos…")
    return pd.DataFrame(Parallel(n_jobs=N_JOBS, verbose=0)(delayed(_eval_fold)(*t) for t in tareas))


def elegir(ro: pd.DataFrame) -> dict:
    res = ro.groupby(["modelo", "param"]).log_loss.mean().reset_index()
    return {m: float(g.sort_values("log_loss").param.iloc[0]) for m, g in res.groupby("modelo")}


# ---------------------------------------------------------------- evaluación


def bloque_filas(y, P, K, df, etiqueta):
    out = []
    for sub, mask in (("todos", np.ones(len(df), bool)), ("con_historial", ~df.sin_hist.values), ("sin_historial", df.sin_hist.values)):
        if mask.sum() == 0:
            continue
        m = M.metricas_filas(y[mask], P[mask], K, df.sesion.values[mask], B=B)
        out.append({"evaluacion": etiqueta, "subgrupo": sub, "ic_por": "sesion", "n": m["n"],
                    "votaciones": df.votacion_id[mask].nunique(),
                    **{k: m[k] for k in ("f1_macro", "log_loss", "brier", "accuracy")},
                    "confusion": m["confusion"].tolist()})
    return out


def totales_oficiales() -> pd.DataFrame:
    v = consulta("select votacion_id, oficial_votos_afirmativos a, oficial_votos_negativos n, oficial_abstenciones ab, "
                 "conteo_resuelto_afirmativo ra, conteo_resuelto_negativo rn, conteo_resuelto_abstencion rab from votaciones")
    o = pd.DataFrame({"votacion_id": v.votacion_id})
    for dst, src, alt in (("of_A", "a", "ra"), ("of_N", "n", "rn"), ("of_AB", "ab", "rab")):
        o[dst] = pd.to_numeric(v[src].replace("", np.nan)).fillna(pd.to_numeric(v[alt].replace("", np.nan))).astype(int)
    return o


COLS_VOT = ["pred_ea_A", "pred_ea_N", "esp_ea_A", "esp_ea_N", "pred_ok_res", "pred_ok_quorum", "esp_ok_res"]


def resumen_votaciones(t: pd.DataFrame) -> dict:
    """Métricas por votación con IC por sesión + Spearman + estratos consensuada/dividida."""
    r = {f"{k}": v for k, v in M.ic_votaciones(t, COLS_VOT, "sesion", B=B).items()}
    r["spearman_A_esp"] = M.ic_spearman(t, "esp_AFIRMATIVO", "of_A", B=B)
    r["spearman_N_esp"] = M.ic_spearman(t, "esp_NEGATIVO", "of_N", B=B)
    r["spearman_N_pred"] = M.ic_spearman(t, "pred_NEGATIVO", "of_N", B=B)
    r["disp_intra_sesion_esp_A"] = M.dispersion_intra_sesion(t, "esp_AFIRMATIVO")
    r["disp_intra_sesion_esp_N"] = M.dispersion_intra_sesion(t, "esp_NEGATIVO")
    margen = (t.of_A - t.of_N).abs()
    for corte in (30, 100):
        for etiqueta, mask in ((f"dividida_lt{corte}", margen < corte), (f"consensuada_ge{corte}", margen >= corte)):
            s = t[mask]
            r[f"n_{etiqueta}"] = int(len(s))
            if len(s):
                for k, v in M.ic_votaciones(s, ["esp_ea_A", "esp_ea_N", "pred_ea_A", "pred_ea_N"], "sesion", B=B).items():
                    r[f"{etiqueta}__{k}"] = v
    return r


def tabla_vot(cv, P4, oficial):
    c2 = cv[["votacion_id", "sesion", "real4"]].copy()
    for i, c in enumerate(CL4):
        c2[f"p_{c}"] = P4[:, i]
    c2["pred4"] = np.array(CL4)[P4.argmax(axis=1)]
    return M.errores_votacion(M.tabla_votaciones(c2, CL4, "real4", "pred4"), oficial)


def main():
    t0 = time.time()
    tabla = pd.read_csv(DERIV / "proyectos_features.csv", dtype=str, keep_default_na=False)
    log("Votos elegibles e historial por tema…")
    eleg = votos_elegibles()
    filas = pd.concat([leer_dataset(n, ["votacion_id", "expediente", "split"]) for n in ("general", "presencia")])
    filas = filas[filas.split.isin(["ENTRENAMIENTO", "VALIDACION"])]
    tema_vot = tema_por_votacion(tabla, filas)
    log("Preparando general y presencia…")
    gen = preparar("general", tabla, eleg, tema_vot)
    pre = preparar("presencia", tabla, eleg, tema_vot)
    assert not gen.split.eq("PRUEBA").any() and not pre.split.eq("PRUEBA").any()
    genM, preM = con_historial(gen, "movil"), con_historial(pre, "movil")

    log("Rolling origin voto…")
    ro_v = rolling_origin(genM, "voto")
    log("Rolling origin presencia…")
    ro_p = rolling_origin(preM, "presencia")
    ro = pd.concat([ro_v, ro_p])
    ro.to_csv(DERIV / "03_rolling_origin.csv", index=False)
    eleg_v, eleg_p = elegir(ro_v), elegir(ro_p)
    media_v = ro_v.merge(pd.DataFrame(eleg_v.items(), columns=["modelo", "param"])).groupby("modelo").log_loss.mean()
    media_p = ro_p.merge(pd.DataFrame(eleg_p.items(), columns=["modelo", "param"])).groupby("modelo").log_loss.mean()
    mejor_v, mejor_p = media_v.idxmin(), media_p.idxmin()
    log("Mejor voto (RO):", mejor_v, eleg_v[mejor_v], "· mejor presencia (RO):", mejor_p, eleg_p[mejor_p])
    json.dump({"voto": eleg_v, "presencia": eleg_p, "mejor_voto": mejor_v, "mejor_presencia": mejor_p},
              open(DERIV / "03_elegidos.json", "w"), indent=2)

    log("Ajuste final con todo ENTRENAMIENTO…")
    trv, trp = genM[genM.split == "ENTRENAMIENTO"], preM[preM.split == "ENTRENAMIENTO"]
    mods_v = dict(zip(VARIANTES_VOTO, Parallel(n_jobs=N_JOBS)(delayed(lambda n: fab_voto(n, eleg_v[n]).fit(trv))(n) for n in VARIANTES_VOTO)))
    pres_base = Historial("presencia", eleg_p["b_historial_bloque_signo"], True).fit(trp)
    pres_proy = LogisticaProyecto("presencia", eleg_p["d_presencia_proyecto"], grupos=GRUPOS_PRES, nombre="d_presencia_proyecto").fit(trp)
    pres_mejor = pres_base if mejor_p == "b_historial_bloque_signo" else pres_proy

    filas_res, tablas, resumen = [], [], []
    oficial = totales_oficiales()
    for variante in ("movil", "congelado"):
        gv = con_historial(gen[gen.split == "VALIDACION"], variante).reset_index(drop=True)
        pv = con_historial(pre[pre.split == "VALIDACION"], variante).reset_index(drop=True)
        cv = pv[pv.votacion_id.isin(set(gv.votacion_id))].copy()
        # Para el combinado, las features de voto se calculan sobre las filas de presencia
        cv = cv.merge(gv[["votacion_id", "legislador_id", "objetivo_voto"]], how="left")
        cv["real4"] = np.where(cv.y == 0, "AUSENTE", cv.objetivo_voto)
        y4 = cv.real4.map({c: i for i, c in enumerate(CL4)}).values
        for pres_nombre, mp in (("b_historial_bloque_signo", pres_base), ("d_presencia_proyecto", pres_proy)):
            Pp = mp.predict_proba(pv)
            filas_res += [dict(r, modelo=pres_nombre, historial=variante) for r in bloque_filas(pv.y.values, Pp, 2, pv, "A_presencia")]
        for nombre, mv in mods_v.items():
            Pv = mv.predict_proba(gv)
            filas_res += [dict(r, modelo=nombre, historial=variante) for r in bloque_filas(gv.y.values, Pv, 3, gv, "B_voto_presente")]
            # combinado: referencia con la presencia de la etapa 2; resto con la mejor presencia en RO
            for pres_nombre, mp in (("b_historial_bloque_signo", pres_base), (mejor_p, pres_mejor)):
                if nombre == "c_logistica_bloque_signo" or pres_nombre == mejor_p:
                    pp = mp.predict_proba(cv)[:, 1:2]
                    P4 = np.c_[pp * mv.predict_proba(cv), 1 - pp]
                    etiqueta = f"{nombre}__pres_{pres_nombre}"
                    if variante == "movil" or nombre in ("c_logistica_bloque_signo", "d_todas", mejor_v):
                        filas_res += [dict(r, modelo=etiqueta, historial=variante) for r in bloque_filas(y4, P4, 4, cv, "AxB_combinado_4_clases")]
                    t = tabla_vot(cv, P4, oficial)
                    t["modelo"], t["historial"] = etiqueta, variante
                    tablas.append(t)
                    resumen.append({"modelo": etiqueta, "historial": variante, **resumen_votaciones(t)})
                    if variante == "movil" and nombre in ("c_logistica_bloque_signo", mejor_v, "d_todas"):
                        out = cv[["votacion_id", "legislador_id", "sesion", "real4", "sin_hist", "bloque_inicio", "signo_inicio",
                                  "alineacion_gobierno_sesion", "tema", "es_autor"]].copy()
                        for i, c in enumerate(CL4):
                            out[f"p_{c}"] = P4[:, i]
                        out.to_csv(DERIV / f"03_predicciones_validacion_{etiqueta}.csv", index=False)
        log(f"Evaluado historial {variante}")

    pd.DataFrame(filas_res).to_pickle(DERIV / "03_metricas_filas.pkl")
    pd.concat(tablas).to_csv(DERIV / "03_metricas_votacion.csv", index=False)
    pd.to_pickle(pd.DataFrame(resumen), DERIV / "03_resumen_votacion.pkl")
    log(f"Listo en {(time.time() - t0) / 60:.1f} min. Derivados en", DERIV)


if __name__ == "__main__":
    main()
