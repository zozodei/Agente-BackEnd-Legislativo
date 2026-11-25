"""Etapa 4b · Diagnóstico de la feature de alineación reciente bloque ↔ oficialismo.

Antes de entrenar, verifica que la regla hace lo que dice: para cada año y bloque, qué
proporción de sus votaciones coincidió con la mayoría oficialista. Si PRO y UCR votaron con el
gobierno en 2024 (Ley Bases, armas de fuego), la tasa de acuerdo tiene que ser alta ese año,
aunque la etiqueta documental diga NO_OFICIALISTA.

Solo usa votaciones con fecha < 2025 (PRUEBA no se toca). Salidas en derivados/:
  04b_acuerdos_bloque_oficialismo.csv  · una fila por (votación, bloque) con mayoría definida
  04b_diagnostico_acuerdos.csv         · tasa de acuerdo por año y bloque

Uso: .venv\\Scripts\\python -I scripts\\04b_alineacion.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.stdout.reconfigure(encoding="utf-8")

import pandas as pd  # noqa: E402

from poroteo import alineacion as AL  # noqa: E402
from poroteo import rutas  # noqa: E402
from poroteo.texto import normalizar  # noqa: E402

DERIV = rutas.RAIZ / "derivados"
BLOQUES_DIAG = ["LA LIBERTAD AVANZA", "PRO", "UCR - UNION CIVICA RADICAL", "UCR", "COALICION CIVICA",
                "UNION POR LA PATRIA", "FRENTE DE TODOS"]


def main():
    DERIV.mkdir(exist_ok=True)
    ac = AL.acuerdos_bloque_oficialismo()
    assert (ac.f < pd.Timestamp("2025-01-01")).all(), "PRUEBA no debe entrar en el diagnóstico"
    ac.assign(f=ac.f.dt.strftime("%Y-%m-%d")).to_csv(DERIV / "04b_acuerdos_bloque_oficialismo.csv", index=False)

    d = ac.assign(anio=ac.f.dt.year)
    d = d[d.b.isin([normalizar(x) for x in BLOQUES_DIAG])]
    diag = d.groupby(["anio", "b"]).agree.agg(votaciones="size", tasa_acuerdo="mean").reset_index()
    diag["tasa_acuerdo"] = diag.tasa_acuerdo.round(3)
    diag.to_csv(DERIV / "04b_diagnostico_acuerdos.csv", index=False)
    pivot = diag.pivot(index="anio", columns="b", values="tasa_acuerdo")
    print("Tasa de acuerdo con el oficialismo, por año y bloque:")
    print(pivot.to_string())


if __name__ == "__main__":
    main()
