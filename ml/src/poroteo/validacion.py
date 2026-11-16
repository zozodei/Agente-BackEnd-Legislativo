"""Particiones de rolling origin dentro de ENTRENAMIENTO (train <= Y-1 → valida Y), con purga
de grupos de proyecto compartidos. Las usan selección, OOF, calibración, umbral e intervalos."""

from __future__ import annotations

import pandas as pd

ANIOS_RO = list(range(2017, 2023))


def particiones_ro(df: pd.DataFrame, anios=ANIOS_RO):
    """Genera (Y, train, valida). Sólo filas de ENTRENAMIENTO. Se omiten folds vacíos
    (el conjunto general no tiene votaciones en 2020 ni 2021)."""
    tr = df[df.split == "ENTRENAMIENTO"]
    for Y in anios:
        a = tr[tr.anio <= Y - 1]
        v = tr[(tr.anio == Y) & ~tr.grupo_proyecto.isin(set(a.grupo_proyecto))]
        if not v.empty:
            yield Y, a, v


def train_presencia_fold(pre: pd.DataFrame, Y: int, grupos_validacion: set) -> pd.DataFrame:
    """Train de presencia para el fold Y del combinado: años <= Y-1 y sin los grupos de
    proyecto de las votaciones que se validan."""
    tr = pre[pre.split == "ENTRENAMIENTO"]
    return tr[(tr.anio <= Y - 1) & ~tr.grupo_proyecto.isin(grupos_validacion)]
