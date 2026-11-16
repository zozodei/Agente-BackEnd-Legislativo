"""Métricas por diputado y por votación, reglas de resultado (iguales a la app) y
bootstrap agrupado (por sesión o por votación) con estadísticos suficientes por grupo."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

QUORUM = 129
EPS = 1e-12


# ---------------------------------------------------------------- reglas de la app


def resultado(afirm: int, neg: int, abst: int, mayoria: str = "simple") -> str:
    presentes = afirm + neg + abst
    if presentes < QUORUM:
        return "SIN_QUORUM"
    if mayoria == "simple":
        ok = afirm > neg
    elif mayoria == "absoluta":
        ok = afirm >= QUORUM
    elif mayoria == "dos_tercios":
        ok = afirm >= math.ceil(2 * presentes / 3)
    else:
        raise ValueError(mayoria)
    return "APROBADO" if ok else "RECHAZADO"


# ---------------------------------------------------------------- por fila


def estadisticos_grupo(y: np.ndarray, P: np.ndarray, grupos: np.ndarray, K: int):
    """Por grupo: matriz de confusión (argmax), suma de log loss, suma de Brier y n."""
    codigos, inv = np.unique(grupos, return_inverse=True)
    G = len(codigos)
    pred = P.argmax(axis=1)
    conf = np.zeros((G, K, K))
    np.add.at(conf, (inv, y, pred), 1)
    ll = -np.log(np.clip(P[np.arange(len(y)), y], EPS, 1))
    onehot = np.eye(K)[y]
    br = ((P - onehot) ** 2).sum(axis=1)
    return codigos, conf, np.bincount(inv, ll, G), np.bincount(inv, br, G), np.bincount(inv, minlength=G).astype(float)


def _f1_macro(conf: np.ndarray) -> np.ndarray:
    """conf (..., K, K) → F1 macro. Clases sin soporte ni predicción se omiten."""
    tp = np.diagonal(conf, axis1=-2, axis2=-1)
    real = conf.sum(axis=-1)
    pred = conf.sum(axis=-2)
    denom = real + pred
    f1 = np.where(denom > 0, 2 * tp / np.where(denom > 0, denom, 1), np.nan)
    return np.nanmean(f1, axis=-1)


def metricas_desde_estadisticos(conf, ll, br, n):
    total = n.sum(axis=-1)
    return {
        "f1_macro": _f1_macro(conf.sum(axis=-3)),
        "log_loss": ll.sum(axis=-1) / total,
        "brier": br.sum(axis=-1) / total,
        "accuracy": np.trace(conf.sum(axis=-3), axis1=-2, axis2=-1) / total,
    }


def pesos_bootstrap(G: int, B: int, rng: np.random.Generator) -> np.ndarray:
    idx = rng.integers(0, G, size=(B, G))
    return np.stack([np.bincount(r, minlength=G) for r in idx]).astype(float)


def metricas_filas(y, P, K, grupos, B=1000, seed=0) -> dict:
    """Punto + IC95 bootstrap agrupado por `grupos`."""
    _, conf, ll, br, n = estadisticos_grupo(y, P, grupos, K)
    punto = metricas_desde_estadisticos(conf, ll, br, n)
    W = pesos_bootstrap(len(n), B, np.random.default_rng(seed))
    boot = metricas_desde_estadisticos(
        np.einsum("bg,gij->bgij", W, conf), W * ll, W * br, W * n
    )
    out = {}
    for k, v in punto.items():
        lo, hi = np.nanpercentile(boot[k], [2.5, 97.5])
        out[k] = (float(v), float(lo), float(hi))
    out["confusion"] = conf.sum(axis=0).astype(int)
    out["n"] = int(n.sum())
    return out


# ---------------------------------------------------------------- por votación


def tabla_votaciones(df: pd.DataFrame, clases: list[str], col_real: str, col_pred: str) -> pd.DataFrame:
    """Conteos predichos (argmax) y esperados (suma de probabilidades) por votación."""
    filas = []
    for vid, g in df.groupby("votacion_id"):
        fila = {"votacion_id": vid, "sesion": g.sesion.iloc[0], "filas": len(g)}
        for c in clases:
            fila[f"pred_{c}"] = int((g[col_pred] == c).sum())
            fila[f"esp_{c}"] = float(g[f"p_{c}"].sum())
            fila[f"real_filas_{c}"] = int((g[col_real] == c).sum())
        filas.append(fila)
    return pd.DataFrame(filas)


def errores_votacion(t: pd.DataFrame, oficial: pd.DataFrame) -> pd.DataFrame:
    """Compara contra los totales OFICIALES. Bancas sin fila: no aportan a la predicción
    (equivalen a 'sin asignar' de la app, no cuentan como presentes)."""
    t = t.merge(oficial, on="votacion_id", how="left", validate="1:1")
    t["res_oficial_reglas"] = [resultado(a, n, b) for a, n, b in zip(t.of_A, t.of_N, t.of_AB)]
    for pref in ("pred", "esp", "real_filas"):
        a, n, b = t[f"{pref}_AFIRMATIVO"], t[f"{pref}_NEGATIVO"], t[f"{pref}_ABSTENCION"]
        t[f"{pref}_res"] = [resultado(round(x), round(y), round(z)) for x, y, z in zip(a, n, b)]
        t[f"{pref}_ea_A"] = (a - t.of_A).abs()
        t[f"{pref}_ea_N"] = (n - t.of_N).abs()
        t[f"{pref}_ok_res"] = (t[f"{pref}_res"] == t.res_oficial_reglas).astype(float)
        t[f"{pref}_ok_quorum"] = (((a + n + b) >= QUORUM) == ((t.of_A + t.of_N + t.of_AB) >= QUORUM)).astype(float)
    return t


def ic_votaciones(t: pd.DataFrame, cols: list[str], grupo: str, B=1000, seed=0) -> dict:
    """Media por votación con IC95, remuestreando `grupo` (sesión o votación)."""
    codigos, inv = np.unique(t[grupo].values, return_inverse=True)
    G = len(codigos)
    n = np.bincount(inv, minlength=G).astype(float)
    W = pesos_bootstrap(G, B, np.random.default_rng(seed))
    out = {}
    for c in cols:
        s = np.bincount(inv, t[c].values.astype(float), G)
        boot = (W @ s) / (W @ n)
        lo, hi = np.percentile(boot, [2.5, 97.5])
        out[c] = (float(s.sum() / n.sum()), float(lo), float(hi))
    return out


def fmt(t: tuple, dec: int = 3) -> str:
    v, lo, hi = t
    return f"{v:.{dec}f} [{lo:.{dec}f}, {hi:.{dec}f}]"


# ---------------------------------------------------------------- etapa 3: ¿distingue proyectos?


def _spearman(x: np.ndarray, y: np.ndarray, w: np.ndarray | None = None) -> float:
    """Spearman ponderado (pesos enteros = repeticiones del bootstrap). NaN si x o y son constantes."""
    if w is not None:
        x, y = np.repeat(x, w.astype(int)), np.repeat(y, w.astype(int))
    if len(x) < 3 or np.ptp(x) == 0 or np.ptp(y) == 0:
        return float("nan")
    rx, ry = pd.Series(x).rank().values, pd.Series(y).rank().values
    return float(np.corrcoef(rx, ry)[0, 1])


def ic_spearman(t: pd.DataFrame, x: str, y: str, grupo: str = "sesion", B: int = 1000, seed: int = 0) -> tuple:
    """Spearman entre columnas x e y de la tabla por votación, IC95 remuestreando `grupo`."""
    codigos, inv = np.unique(t[grupo].values, return_inverse=True)
    G = len(codigos)
    W = pesos_bootstrap(G, B, np.random.default_rng(seed))
    xv, yv = t[x].values.astype(float), t[y].values.astype(float)
    boot = np.array([_spearman(xv, yv, w[inv]) for w in W])
    lo, hi = np.nanpercentile(boot, [2.5, 97.5]) if np.isfinite(boot).any() else (np.nan, np.nan)
    return (_spearman(xv, yv), float(lo), float(hi))


def dispersion_intra_sesion(t: pd.DataFrame, col: str) -> float:
    """Desvío estándar medio de `col` entre votaciones de una misma sesión (0 = el modelo da la
    misma predicción a todos los proyectos de la sesión)."""
    s = t.groupby("sesion")[col].std(ddof=0)
    n = t.groupby("sesion").size()
    s = s[n > 1]
    return float(s.mean()) if len(s) else float("nan")
