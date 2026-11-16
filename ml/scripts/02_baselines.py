"""Etapa 2 · Baselines en VALIDACIÓN (2023–2024). PRUEBA no se carga.

1. Selección de hiperparámetros con rolling origin dentro de ENTRENAMIENTO
   (train <= Y-1 → valida Y, Y = 2017..2022; se purgan grupos de proyecto compartidos).
2. Ajuste final con todo ENTRENAMIENTO y evaluación en VALIDACIÓN:
   B) voto | presente, A) presencia, A×B) combinado de 4 clases y métricas por votación.
3. IC95 bootstrap agrupado por SESIÓN (principal) y por VOTACIÓN (secundario).

Uso: .venv\\Scripts\\python -I scripts\\02_baselines.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from poroteo import metricas as M  # noqa: E402
from poroteo import rutas  # noqa: E402
from poroteo.carga import consulta, leer_dataset  # noqa: E402
from poroteo.features import COLUMNAS_BASE, agregar_contexto, conteos  # noqa: E402
from poroteo.modelos import CLASES, Constante, Historial, Logistica  # noqa: E402

DERIV = rutas.RAIZ / "derivados"
B = 1000
ANIOS_RO = list(range(2017, 2023))
GRID_ALPHA = [3, 10, 30, 100, 300, 1000, 3000]
GRID_C = [0.0003, 0.001, 0.003, 0.01, 0.1, 1.0]
CL4 = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION", "AUSENTE"]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- datos


def preparar(nombre: str) -> pd.DataFrame:
    objetivo_col = "objetivo_voto" if nombre == "general" else "objetivo_presencia_registrada"
    df = leer_dataset(nombre, COLUMNAS_BASE + [objetivo_col])
    df = df[df.split.isin(["ENTRENAMIENTO", "VALIDACION"])].copy()  # PRUEBA no se toca en la etapa 2
    df = agregar_contexto(df)
    ses = consulta("select votacion_id, sesion_id from votacion_sesion")
    df = df.merge(ses, how="left", validate="m:1").rename(columns={"sesion_id": "sesion"})
    df["anio"] = df.fecha_inicio_sesion.str[:4].astype(int)
    if nombre == "general":
        df["y"] = df.objetivo_voto.map({c: i for i, c in enumerate(CLASES["voto"])}).astype(int)
    else:
        df["y"] = df.objetivo_presencia_registrada.astype(int)  # 0 = AUSENTE, 1 = PRESENTE
    return df.reset_index(drop=True)


def con_historial(df: pd.DataFrame, variante: str) -> pd.DataFrame:
    out = df.copy()
    c = conteos(df, variante)
    out[["A", "N", "AB", "AU"]] = c.values
    out["sin_hist"] = c.sum(axis=1).values == 0
    return out


# ---------------------------------------------------------------- modelos candidatos


def candidatos(objetivo: str):
    yield "a_constante", {}, lambda: Constante(objetivo)
    for ctx in (False, True):
        for a in GRID_ALPHA:
            yield Historial(objetivo, a, ctx).nombre, {"alpha": a}, (lambda a=a, ctx=ctx: Historial(objetivo, a, ctx))
    for ctx in (False, True):
        for C in GRID_C:
            yield Logistica(objetivo, C, ctx).nombre, {"C": C}, (lambda C=C, ctx=ctx: Logistica(objetivo, C, ctx))


def rolling_origin(df: pd.DataFrame, objetivo: str) -> pd.DataFrame:
    tr = df[df.split == "ENTRENAMIENTO"]
    K = len(CLASES[objetivo])
    filas = []
    for Y in ANIOS_RO:
        a = tr[tr.anio <= Y - 1]
        v = tr[(tr.anio == Y) & ~tr.grupo_proyecto.isin(set(a.grupo_proyecto))]
        log(f"  RO {objetivo} {Y}: train {len(a)} · valida {len(v)} ({v.votacion_id.nunique()} votaciones)")
        if v.empty:  # 2020-2021 no tienen votaciones generales en el conjunto
            continue
        for nombre, params, fab in candidatos(objetivo):
            P = fab().fit(a).predict_proba(v)
            m = M.metricas_filas(v.y.values, P, K, v.sesion.values, B=1)
            filas.append({"objetivo": objetivo, "anio": Y, "modelo": nombre, **params,
                          "log_loss": m["log_loss"][0], "f1_macro": m["f1_macro"][0], "brier": m["brier"][0], "n": m["n"]})
    return pd.DataFrame(filas)


def elegir(ro: pd.DataFrame) -> dict:
    """Para cada familia, el hiperparámetro con menor log loss medio en rolling origin."""
    ro = ro.copy()
    ro["param"] = ro.get("alpha", pd.Series(index=ro.index, dtype=float)).fillna(ro.get("C"))
    res = ro.groupby(["modelo", "param"], dropna=False).log_loss.mean().reset_index()
    return {m: (None if pd.isna(g.sort_values("log_loss").param.iloc[0]) else float(g.sort_values("log_loss").param.iloc[0]))
            for m, g in res.groupby("modelo")}


def fabricar(objetivo: str, modelo: str, param):
    if modelo == "a_constante":
        return Constante(objetivo)
    if modelo.startswith("b_historial"):
        return Historial(objetivo, param, modelo.endswith("_bloque_signo"))
    return Logistica(objetivo, param, modelo.endswith("_bloque_signo"))


# ---------------------------------------------------------------- evaluación


def bloque_filas(y, P, K, df, etiqueta):
    """Métricas por fila: total / con historial / sin historial × IC sesión y votación."""
    out = []
    for sub, mask in (("todos", np.ones(len(df), bool)), ("con_historial", ~df.sin_hist.values), ("sin_historial", df.sin_hist.values)):
        if mask.sum() == 0:
            continue
        for grupo, col in (("sesion", "sesion"), ("votacion", "votacion_id")):
            m = M.metricas_filas(y[mask], P[mask], K, df[col].values[mask], B=B)
            out.append({"evaluacion": etiqueta, "subgrupo": sub, "ic_por": grupo, "n": m["n"],
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
    o["fuente_total"] = np.where(v.a != "", "oficial_*", "conteo_resuelto_*")
    return o


def main():
    DERIV.mkdir(exist_ok=True)
    log("Cargando y construyendo contexto al inicio de la sesión…")
    gen = preparar("general")
    pre = preparar("presencia")
    assert not gen.split.eq("PRUEBA").any() and not pre.split.eq("PRUEBA").any()

    genM, preM = con_historial(gen, "movil"), con_historial(pre, "movil")

    log("Rolling origin (selección de hiperparámetros dentro de train)…")
    ro = pd.concat([rolling_origin(genM, "voto"), rolling_origin(preM, "presencia")])
    ro.to_csv(DERIV / "02_rolling_origin.csv", index=False)
    elegidos = {obj: elegir(ro[ro.objetivo == obj]) for obj in ("voto", "presencia")}
    log("Elegidos:", elegidos)

    modelos_nombres = ["a_constante", "b_historial", "b_historial_bloque_signo", "c_logistica_sin_bloque_signo", "c_logistica_bloque_signo"]
    ajustados = {}
    for obj, df in (("voto", genM), ("presencia", preM)):
        tr = df[df.split == "ENTRENAMIENTO"]
        for mn in modelos_nombres:
            log(f"Ajuste final {obj} · {mn} (param={elegidos[obj][mn]})")
            ajustados[(obj, mn)] = fabricar(obj, mn, elegidos[obj][mn]).fit(tr)

    filas_res, tablas_vot = [], []
    oficial = totales_oficiales()
    for variante in ("movil", "congelado"):
        gv = con_historial(gen[gen.split == "VALIDACION"], variante).reset_index(drop=True)
        pv = con_historial(pre[pre.split == "VALIDACION"], variante).reset_index(drop=True)
        # Filas de presencia de las votaciones generales (combinado de 4 clases)
        ids_gen = set(gv.votacion_id)
        cv = pv[pv.votacion_id.isin(ids_gen)].merge(gv[["votacion_id", "legislador_id", "objetivo_voto"]], how="left")
        cv["real4"] = np.where(cv.y == 0, "AUSENTE", cv.objetivo_voto)
        assert cv.real4.notna().all()
        y4 = cv.real4.map({c: i for i, c in enumerate(CL4)}).values
        for mn in modelos_nombres:
            mv, mp = ajustados[("voto", mn)], ajustados[("presencia", mn)]
            Pv = mv.predict_proba(gv)
            filas_res += [dict(r, modelo=mn, historial=variante) for r in bloque_filas(gv.y.values, Pv, 3, gv, "B_voto_presente")]
            Pp = mp.predict_proba(pv)
            filas_res += [dict(r, modelo=mn, historial=variante) for r in bloque_filas(pv.y.values, Pp, 2, pv, "A_presencia")]
            # combinado
            pp = mp.predict_proba(cv)[:, 1:2]
            P4 = np.c_[pp * mv.predict_proba(cv), 1 - pp]
            filas_res += [dict(r, modelo=mn, historial=variante) for r in bloque_filas(y4, P4, 4, cv, "AxB_combinado_4_clases")]
            c2 = cv[["votacion_id", "sesion", "real4"]].copy()
            for i, c in enumerate(CL4):
                c2[f"p_{c}"] = P4[:, i]
            c2["pred4"] = np.array(CL4)[P4.argmax(axis=1)]
            t = M.errores_votacion(M.tabla_votaciones(c2, CL4, "real4", "pred4"), oficial)
            t["modelo"], t["historial"] = mn, variante
            tablas_vot.append(t)
            if variante == "movil" and mn in ("b_historial_bloque_signo", "c_logistica_bloque_signo"):
                out = cv[["votacion_id", "legislador_id", "sesion", "real4", "sin_hist", "bloque_inicio", "signo_inicio", "distrito_inicio"]].copy()
                for i, c in enumerate(CL4):
                    out[f"p_{c}"] = P4[:, i]
                out.to_csv(DERIV / f"02_predicciones_validacion_{mn}.csv", index=False)
        log(f"Evaluado historial {variante}")

    res = pd.DataFrame(filas_res)
    vot = pd.concat(tablas_vot)
    res.to_pickle(DERIV / "02_metricas_filas.pkl")
    vot.to_csv(DERIV / "02_metricas_votacion.csv", index=False)
    json.dump({k: {m: p for m, p in v.items()} for k, v in elegidos.items()}, open(DERIV / "02_elegidos.json", "w"), indent=2)

    # IC por votación (métricas de producto)
    cols = ["pred_ea_A", "pred_ea_N", "pred_ok_res", "pred_ok_quorum", "esp_ea_A", "esp_ea_N", "real_filas_ea_A", "real_filas_ea_N"]
    filas_v = []
    for (mn, var), t in vot.groupby(["modelo", "historial"]):
        for grupo in ("sesion", "votacion_id"):
            filas_v.append({"modelo": mn, "historial": var, "ic_por": grupo, **M.ic_votaciones(t, cols, grupo, B=B)})
    pd.to_pickle(pd.DataFrame(filas_v), DERIV / "02_metricas_votacion_ic.pkl")
    log("Listo. Derivados en", DERIV)


if __name__ == "__main__":
    main()
