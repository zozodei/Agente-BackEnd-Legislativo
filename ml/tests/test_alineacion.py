"""Alineación reciente bloque ↔ oficialismo (etapa 4b). Pruebas con datos sintéticos: no
necesitan el dataset. Verifican la ventana [límite − 180 días, límite) y el corte estricto."""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from poroteo import alineacion as AL  # noqa: E402

LIMITE = pd.Timestamp("2024-06-01")


def _acuerdos(filas):
    return pd.DataFrame(filas, columns=["b", "f", "agree"]).assign(f=lambda d: pd.to_datetime(d.f))


def _fila(bloque, limite=LIMITE):
    return pd.DataFrame({"bloque_inicio": [bloque], "limite_predictivo_sesion": [limite.strftime("%Y-%m-%d")]})


def test_ventana_incluye_180_dias_previos_y_excluye_el_limite():
    ac = _acuerdos([
        ("PRO", "2024-06-01" , 0),                              # el mismo día del límite: fuera
        ("PRO", (LIMITE - pd.Timedelta(days=1)).strftime("%Y-%m-%d"), 1),       # dentro
        ("PRO", (LIMITE - pd.Timedelta(days=180)).strftime("%Y-%m-%d"), 1),    # dentro (borde)
        ("PRO", (LIMITE - pd.Timedelta(days=181)).strftime("%Y-%m-%d"), 1),    # fuera (antes de la ventana)
    ])
    out = AL.agregar_alineacion_reciente(_fila("PRO"), ac)
    # 2 votaciones en la ventana, ambas de acuerdo: (2 + α·prior) / (2 + α)
    esperado = (2 + AL.ALPHA * AL.PRIOR) / (2 + AL.ALPHA)
    assert np.isclose(out.alin_rec.iloc[0], esperado)
    assert np.isclose(out.alin_rec_log_n.iloc[0], np.log1p(2))


def test_sin_votos_del_bloque_vale_el_prior():
    ac = _acuerdos([("UCR", "2024-05-01", 1)])
    out = AL.agregar_alineacion_reciente(_fila("PRO"), ac)
    assert np.isclose(out.alin_rec.iloc[0], AL.PRIOR)
    assert out.alin_rec_log_n.iloc[0] == 0.0


def test_no_mezcla_bloques_y_cuenta_desacuerdos():
    ac = _acuerdos([
        ("PRO", "2024-05-01", 1),
        ("PRO", "2024-05-02", 0),
        ("UCR", "2024-05-03", 1),
    ])
    out = AL.agregar_alineacion_reciente(pd.concat([_fila("PRO"), _fila("UCR")], ignore_index=True), ac)
    assert np.isclose(out.alin_rec.iloc[0], (1 + AL.ALPHA * AL.PRIOR) / (2 + AL.ALPHA))
    assert np.isclose(out.alin_rec.iloc[1], (1 + AL.ALPHA * AL.PRIOR) / (1 + AL.ALPHA))


def test_nunca_usa_votaciones_posteriores_al_limite():
    ac = _acuerdos([("PRO", "2024-07-01", 1), ("PRO", "2025-03-01", 1)])
    out = AL.agregar_alineacion_reciente(_fila("PRO"), ac)
    assert out.alin_rec_log_n.iloc[0] == 0.0
