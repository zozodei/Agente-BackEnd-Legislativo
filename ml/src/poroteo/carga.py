"""Carga de tablas y conjuntos experimentales.

Los CSV traen textos multilínea entre comillas: siempre se leen con un parser
CSV real (pandas / módulo csv), nunca línea por línea.
"""

from __future__ import annotations

import csv
import json
import sqlite3
import sys
from pathlib import Path

import pandas as pd

from . import rutas

# Splits estándar del protocolo. CUARENTENA_CRUZA_CORTE y SIN_GRUPO_VERIFICADO
# se conservan en los CSV para auditoría, pero nunca entran a train/val/test.
SPLITS_ESTANDAR = ("ENTRENAMIENTO", "VALIDACION", "PRUEBA")
SPLITS_EXCLUIDOS = ("CUARENTENA_CRUZA_CORTE", "SIN_GRUPO_VERIFICADO")

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def protocolo() -> dict:
    return json.loads(rutas.PROTOCOLO.read_text(encoding="utf-8"))


def contar_csv(ruta: Path) -> tuple[int, list[str]]:
    """Cuenta registros (no líneas) con el módulo csv, que respeta comillas multilínea."""
    with open(ruta, encoding="utf-8", newline="") as f:
        lector = csv.reader(f)
        cabecera = next(lector)
        n = sum(1 for _ in lector)
    return n, cabecera


def leer_dataset(nombre: str, columnas: list[str] | None = None, solo_estandar: bool = True) -> pd.DataFrame:
    """Lee un conjunto ML como texto (sin convertir vacíos en NaN: vacío = no disponible)."""
    df = pd.read_csv(
        rutas.DATASETS_ML[nombre], dtype=str, keep_default_na=False, usecols=columnas, encoding="utf-8"
    )
    if solo_estandar and "split" in df.columns:
        df = df[df["split"].isin(SPLITS_ESTANDAR)].copy()
    return df


def conexion() -> sqlite3.Connection:
    """SQLite de solo lectura (mismas celdas que los CSV, verificado 24/24 por el proveedor)."""
    return sqlite3.connect(f"file:{rutas.SQLITE.as_posix()}?mode=ro", uri=True)


def consulta(sql: str) -> pd.DataFrame:
    with conexion() as c:
        return pd.read_sql(sql, c)
