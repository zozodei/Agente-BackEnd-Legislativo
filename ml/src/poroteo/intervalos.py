"""Intervalos para el conteo esperado por votación SIN asumir independencia entre diputados.

1. Simulación con efectos aleatorios en el logit de NEGATIVO, ABSTENCION y AUSENTE (relativo
   a AFIRMATIVO): uno común a toda la votación, v ~ N(0, τ²), y uno por (votación, bloque),
   z ~ N(0, σ²), compartido por los diputados del bloque. Luego se sortea el voto de cada
   diputado. σ = τ = 0 es el caso independiente. (σ, τ) se eligen con OOF.
2. Empírico: Σp + cuantiles de los residuos (real − Σp) observados en OOF.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

CL4 = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION", "AUSENTE"]
NIVELES = {"IC80": (0.10, 0.90), "IC90": (0.05, 0.95)}


def simular_votacion(P4: np.ndarray, bloque: np.ndarray, sigma: float, S: int, rng, tau: float = 0.0) -> np.ndarray:
    """Conteos simulados (S, 4) para una votación."""
    L = np.log(np.clip(P4, 1e-9, 1))[None, :, :].repeat(S, axis=0)
    if sigma > 0:
        cod, inv = np.unique(bloque, return_inverse=True)
        Z = rng.normal(0, sigma, size=(S, len(cod), 3))
        L[:, :, 1:] += Z[:, inv, :]
    if tau > 0:
        L[:, :, 1:] += rng.normal(0, tau, size=(S, 1, 3))
    L -= L.max(axis=2, keepdims=True)
    Pm = np.exp(L)
    Pm /= Pm.sum(axis=2, keepdims=True)
    u = rng.random((S, P4.shape[0], 1))
    clase = (Pm.cumsum(axis=2) < u).sum(axis=2)
    clase = np.minimum(clase, 3)
    return np.stack([(clase == k).sum(axis=1) for k in range(4)], axis=1)


def intervalos_simulados(df: pd.DataFrame, sigma: float, S: int = 2000, seed: int = 0, tau: float = 0.0) -> pd.DataFrame:
    """df: filas de presencia de votaciones generales con p_<clase>, votacion_id, bloque_inicio."""
    rng = np.random.default_rng(seed)
    filas = []
    for vid, g in df.groupby("votacion_id", sort=True):
        C = simular_votacion(g[[f"p_{c}" for c in CL4]].values, g.bloque_inicio.values, sigma, S, rng, tau)
        f = {"votacion_id": vid}
        for k, c in ((0, "A"), (1, "N")):
            for niv, (a, b) in NIVELES.items():
                f[f"{c}_{niv}_lo"], f[f"{c}_{niv}_hi"] = np.quantile(C[:, k], [a, b])
        filas.append(f)
    return pd.DataFrame(filas)


def cobertura(t: pd.DataFrame, iv: pd.DataFrame, real_A: str, real_N: str) -> dict:
    m = t.merge(iv, on="votacion_id")
    out = {}
    for c, col in (("A", real_A), ("N", real_N)):
        for niv in NIVELES:
            out[f"{c}_{niv}"] = float(((m[col] >= m[f"{c}_{niv}_lo"]) & (m[col] <= m[f"{c}_{niv}_hi"])).mean())
            out[f"{c}_{niv}_ancho"] = float((m[f"{c}_{niv}_hi"] - m[f"{c}_{niv}_lo"]).mean())
    return out


def elegir_sigma(oof_filas: pd.DataFrame, oof_tabla: pd.DataFrame, grilla, real_A, real_N, S=1000) -> tuple[float, pd.DataFrame]:
    """(σ, τ) cuya cobertura OOF de IC80 e IC90 (A y N) queda más cerca de la nominal.
    `grilla`: lista de pares (σ, τ)."""
    res = []
    for s, t in grilla:
        cov = cobertura(oof_tabla, intervalos_simulados(oof_filas, s, S, tau=t), real_A, real_N)
        dist = np.mean([abs(cov[f"{c}_IC80"] - 0.8) + abs(cov[f"{c}_IC90"] - 0.9) for c in "AN"])
        res.append({"sigma": s, "tau": t, "desvio_nominal": dist, **cov})
    r = pd.DataFrame(res)
    b = r.sort_values("desvio_nominal").iloc[0]
    return (float(b.sigma), float(b.tau)), r


def intervalos_empiricos(t: pd.DataFrame, residuos: dict) -> pd.DataFrame:
    """Σp + cuantiles de residuos OOF (residuos = {'A': array, 'N': array})."""
    iv = pd.DataFrame({"votacion_id": t.votacion_id})
    for c, col in (("A", "esp_AFIRMATIVO"), ("N", "esp_NEGATIVO")):
        for niv, (a, b) in NIVELES.items():
            qa, qb = np.quantile(residuos[c], [a, b])
            iv[f"{c}_{niv}_lo"] = np.maximum(t[col].values + qa, 0)
            iv[f"{c}_{niv}_hi"] = t[col].values + qb
    return iv
