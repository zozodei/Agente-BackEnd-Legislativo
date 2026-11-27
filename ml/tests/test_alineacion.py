"""Alineación reciente bloque ↔ oficialismo (etapas 4b y 4c). Pruebas con datos sintéticos: no
necesitan el dataset. Verifican la ventana [límite − 180 días, límite), el corte estricto, el
corte por cambio de gobierno y las interacciones con la dirección del proyecto."""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from poroteo import alineacion as AL  # noqa: E402

LIMITE = pd.Timestamp("2024-06-01")
# Gobiernos sintéticos con la forma de gobiernos_historicos (desde, hasta)
GOBIERNOS = pd.DataFrame({
    "gobierno_id": ["FERNANDEZ", "MILEI"],
    "desde": ["2019-12-10", "2023-12-10"],
    "hasta": ["2023-12-09", None],
})


def _acuerdos(filas):
    return pd.DataFrame(filas, columns=["b", "f", "agree"]).assign(f=lambda d: pd.to_datetime(d.f))


def _fila(bloque, limite=LIMITE, alineacion="OTRO"):
    return pd.DataFrame({
        "bloque_inicio": [bloque],
        "limite_predictivo_sesion": [limite.strftime("%Y-%m-%d")],
        "alineacion_gobierno_sesion": [alineacion],
    })


def test_ventana_incluye_180_dias_previos_y_excluye_el_limite():
    ac = _acuerdos([
        ("PRO", "2024-06-01", 0),                                              # el mismo día del límite: fuera
        ("PRO", (LIMITE - pd.Timedelta(days=1)).strftime("%Y-%m-%d"), 1),      # dentro
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


# ---------------------------------------------------------------- etapa 4c · corte por gobierno


def test_gobierno_vigente_en_el_limite():
    limites = pd.Series(["2024-02-15", "2023-06-01", "2009-01-01"])
    inicio = AL.inicio_gobierno_vigente(limites, GOBIERNOS)
    assert inicio.iloc[0] == pd.Timestamp("2023-12-10")  # Milei
    assert inicio.iloc[1] == pd.Timestamp("2019-12-10")  # gobierno anterior
    assert pd.isna(inicio.iloc[2])                       # antes de cualquier gobierno documentado


def test_corte_por_gobierno_no_cuenta_acuerdos_del_oficialismo_anterior():
    limite = pd.Timestamp("2024-02-15")  # ventana de 180 días: desde 2023-08-19
    ac = _acuerdos([
        ("PRO", "2023-09-01", 1),   # dentro de la ventana, pero del gobierno anterior: fuera con el corte
        ("PRO", "2023-11-20", 1),   # idem
        ("PRO", "2024-01-15", 0),   # gobierno vigente
        ("PRO", "2024-02-01", 0),   # gobierno vigente
    ])
    sin_corte = AL.agregar_alineacion_reciente(_fila("PRO", limite), ac)
    con_corte = AL.agregar_alineacion_reciente(_fila("PRO", limite), ac, gobiernos=GOBIERNOS)
    assert np.isclose(sin_corte.alin_rec.iloc[0], (2 + AL.ALPHA * AL.PRIOR) / (4 + AL.ALPHA))
    assert con_corte.alin_rec_log_n.iloc[0] == np.log1p(2)
    assert np.isclose(con_corte.alin_rec.iloc[0], (0 + AL.ALPHA * AL.PRIOR) / (2 + AL.ALPHA))


def test_sin_votos_del_gobierno_vigente_vale_el_prior():
    limite = pd.Timestamp("2024-02-15")
    ac = _acuerdos([("PRO", "2023-09-01", 1), ("PRO", "2023-10-01", 1), ("PRO", "2023-11-01", 1)])
    out = AL.agregar_alineacion_reciente(_fila("PRO", limite), ac, gobiernos=GOBIERNOS)
    assert np.isclose(out.alin_rec.iloc[0], AL.PRIOR)
    assert out.alin_rec_log_n.iloc[0] == 0.0


# ---------------------------------------------------------------- etapa 4c · dirección del proyecto


def test_interaccion_separa_proyectos_del_oficialismo_de_la_oposicion():
    ac = _acuerdos([("PRO", "2024-05-01", 1), ("PRO", "2024-05-02", 1)])  # alin_rec > PRIOR
    filas = pd.concat([
        _fila("PRO", alineacion="EJECUTIVO_VIGENTE"),
        _fila("PRO", alineacion="DIPUTADO_NO_OFICIALISTA"),
        _fila("PRO", alineacion="DIPUTADO_OFICIALISMO"),
        _fila("PRO", alineacion="EJECUTIVO_ANTERIOR"),
        _fila("PRO", alineacion="COMISION"),
    ], ignore_index=True)
    out = AL.agregar_alineacion_reciente(filas, ac, gobiernos=GOBIERNOS)
    centrada = out.alin_rec.iloc[0] - AL.PRIOR
    assert centrada > 0
    assert np.isclose(out.alin_x_ofic.iloc[0], centrada)   # EJECUTIVO_VIGENTE
    assert out.alin_x_opos.iloc[0] == 0.0
    assert np.isclose(out.alin_x_ofic.iloc[2], centrada)   # DIPUTADO_OFICIALISMO
    assert np.isclose(out.alin_x_opos.iloc[1], centrada)   # DIPUTADO_NO_OFICIALISTA
    assert np.isclose(out.alin_x_ejec_ant.iloc[3], centrada)  # EJECUTIVO_ANTERIOR
    assert out.loc[4, ["alin_x_ofic", "alin_x_opos", "alin_x_ejec_ant"]].tolist() == [0.0, 0.0, 0.0]  # sin dirección


def test_exige_la_alineacion_del_proyecto():
    ac = _acuerdos([("PRO", "2024-05-01", 1)])
    sin_col = _fila("PRO").drop(columns="alineacion_gobierno_sesion")
    with pytest.raises(AssertionError):
        AL.agregar_alineacion_reciente(sin_col, ac)
