"""Etapa 5b · Elección de modo de texto y de K por rolling origin dentro de ENTRENAMIENTO.

Modelo de prueba rápido: logística multinomial sobre bloque + features de texto, comparado con la
misma logística sin texto. Sólo votaciones con vecinos y diputados presentes. Folds: para cada año
Y de 2014 a 2020, entrena con años < Y y evalúa en Y. VALIDACION no entra.

Fase 1: compara los modos (K = 20). Fase 2: elige K sólo dentro del modo ganador.
Escribe derivados/05_modo_elegido.json.

Uso: .venv\\Scripts\\python -I scripts\\05_seleccion.py --modos limpio limpio3000 limpio_fund emb --ks 5 10 20
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import OneHotEncoder, StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.stdout.reconfigure(encoding="utf-8")

from poroteo import rutas  # noqa: E402
from poroteo.carga import leer_dataset  # noqa: E402
from poroteo.features import agregar_contexto  # noqa: E402

DERIV = rutas.RAIZ / "derivados"
CL3 = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION"]
TXT = ["txt_own_A", "txt_own_N", "txt_own_AB", "txt_own_neff", "txt_bmaj_A", "txt_bmaj_N", "txt_bmaj_AB",
       "txt_rebeld", "txt_gob_A", "txt_gob_N", "txt_gob_AB", "txt_sim_max", "txt_sim_mean"]
ANIOS_RO = range(2014, 2021)


def base_rows():
    g = leer_dataset("general", ["votacion_id", "legislador_id", "fecha_inicio_sesion", "objetivo_voto", "split"])
    g = g[g.split == "ENTRENAMIENTO"]
    g = agregar_contexto(g)
    g = g[g.objetivo_voto.isin(CL3)].copy()
    g["anio"] = g.fecha_inicio_sesion.str[:4].astype(int)
    g["bloque_inicio"] = g.bloque_inicio.fillna("NA")
    return g


def ll_fold(tr, te, cols_txt):
    enc = OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=50).fit(tr[["bloque_inicio"]])
    sc = StandardScaler().fit(tr[cols_txt].fillna(0)) if cols_txt else None

    def X(d):
        parts = [enc.transform(d[["bloque_inicio"]]).toarray()]
        if cols_txt:
            parts.append(sc.transform(d[cols_txt].fillna(0)))
        return np.hstack(parts)

    clf = LogisticRegression(C=0.1, max_iter=2000).fit(X(tr), tr.objetivo_voto)
    P = clf.predict_proba(X(te))[:, [list(clf.classes_).index(c) for c in CL3]]
    y = te.objetivo_voto.map({c: i for i, c in enumerate(CL3)}).values
    return float(-np.mean(np.log(np.clip(P[np.arange(len(y)), y], 1e-15, 1))))


def evaluar(g, modo, K):
    F = pd.read_csv(DERIV / f"05_feat_{modo}_K{K}.csv")
    m = g.merge(F, on=["votacion_id", "legislador_id"], how="inner")
    m = m[m.txt_sin_texto == 0]
    base = g[g.votacion_id.isin(m.votacion_id)]
    filas = []
    for Y in ANIOS_RO:
        tr, te = m[m.anio < Y], m[m.anio == Y]
        if len(tr) < 1000 or len(te) < 100:
            continue
        ll_t = ll_fold(tr, te, TXT)
        ll_b = ll_fold(base[base.anio < Y], base[base.anio == Y], [])
        filas.append({"modo": modo, "K": K, "anio": Y, "ll_texto": ll_t, "ll_solo_bloque": ll_b, "n_test": len(te)})
    return filas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modos", nargs="+", default=["limpio", "limpio3000", "limpio_fund", "emb"])
    ap.add_argument("--ks", type=int, nargs="+", default=[5, 10, 20])
    args = ap.parse_args()
    g = base_rows()

    filas = []
    for modo in args.modos:
        if (DERIV / f"05_feat_{modo}_K20.csv").exists():
            filas += evaluar(g, modo, 20)
    R1 = pd.DataFrame(filas)
    res1 = R1.groupby("modo")[["ll_texto", "ll_solo_bloque"]].mean().round(4)
    res1["folds"] = R1.groupby("modo").size()
    print("Fase 1 · modos (K=20), rolling origin 2014–2020:")
    print(res1.to_string())
    modo = str(res1.ll_texto.idxmin())

    filas2 = []
    for K in args.ks:
        if (DERIV / f"05_feat_{modo}_K{K}.csv").exists():
            filas2 += evaluar(g, modo, K)
    R2 = pd.DataFrame(filas2)
    res2 = R2.groupby("K")[["ll_texto", "ll_solo_bloque"]].mean().round(4)
    print(f"\nFase 2 · K dentro de '{modo}':")
    print(res2.to_string())
    K_elegido = int(res2.ll_texto.idxmin())
    print(f"\nModo elegido: {modo} · K elegido: {K_elegido}")
    R = pd.concat([R1, R2], ignore_index=True)
    R.to_csv(DERIV / "05_seleccion_rolling.csv", index=False)
    json.dump({"modo": modo, "K": K_elegido}, open(DERIV / "05_modo_elegido.json", "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
