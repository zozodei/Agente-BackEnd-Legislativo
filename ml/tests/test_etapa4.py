"""Etapa 4: particiones del rolling origin (sin mirar el futuro), calibradores, umbral,
intervalos con efecto por bloque y tema para la app. Los de calibración e intervalos usan
datos sintéticos; no requieren el dataset."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from poroteo import calibracion as CAL  # noqa: E402
from poroteo import intervalos as IV  # noqa: E402
from poroteo.temas import asignar_tema, asignar_tema_app, limpiar_titulo  # noqa: E402
from poroteo.validacion import particiones_ro, train_presencia_fold  # noqa: E402


def _df_sintetico():
    rng = np.random.default_rng(0)
    n = 600
    return pd.DataFrame({
        "split": rng.choice(["ENTRENAMIENTO", "VALIDACION"], n, p=[0.8, 0.2]),
        "anio": rng.integers(2014, 2023, n),
        "grupo_proyecto": rng.integers(0, 120, n).astype(str),
        "votacion_id": rng.integers(0, 300, n).astype(str),
    })


def test_particiones_ro_no_miran_el_futuro_ni_comparten_grupos():
    df = _df_sintetico()
    n = 0
    for Y, a, v in particiones_ro(df):
        n += 1
        assert a.anio.max() <= Y - 1 and (v.anio == Y).all()
        assert not (set(a.grupo_proyecto) & set(v.grupo_proyecto))
        assert set(a.split) == set(v.split) == {"ENTRENAMIENTO"}
        p = train_presencia_fold(df, Y, set(v.grupo_proyecto))
        assert p.anio.max() <= Y - 1 and not (set(p.grupo_proyecto) & set(v.grupo_proyecto))
    assert n > 0


def _probs_descalibradas(n=4000, seed=1):
    rng = np.random.default_rng(seed)
    L = rng.normal(size=(n, 3)) * 1.0
    P_real = np.exp(L) / np.exp(L).sum(1, keepdims=True)
    y = np.array([rng.choice(3, p=p) for p in P_real])
    P_conf = np.exp(3 * L) / np.exp(3 * L).sum(1, keepdims=True)  # sobreconfiada
    return P_conf, y


def test_temperatura_e_isotonica_mejoran_una_prediccion_sobreconfiada():
    P, y = _probs_descalibradas()
    base = CAL.log_loss(y, P)
    t = CAL.Temperatura().fit(P, y)
    assert t.T > 1.5  # debe "enfriar"
    assert CAL.log_loss(y, t.transform(P)) < base
    iso = CAL.Isotonica().fit(P, y).transform(P)
    assert np.allclose(iso.sum(1), 1) and CAL.log_loss(y, iso) < base
    assert sum(CAL.ece_por_clase(y, t.transform(P))) < sum(CAL.ece_por_clase(y, P))


def test_eleccion_de_calibrador_usa_solo_folds_anteriores():
    P, y = _probs_descalibradas()
    folds = [(2017 + i, P[i * 1000:(i + 1) * 1000], y[i * 1000:(i + 1) * 1000]) for i in range(4)]
    nombre, det = CAL.elegir_calibrador(folds)
    assert nombre in ("temperatura", "isotonica")
    assert all(len(v) == 3 for v in det["por_fold"].values())  # el primer fold nunca se evalúa


def test_pesos_de_decision_no_empeoran_f1_y_primera_clase_fija():
    P, y = _probs_descalibradas()
    w, f = CAL.elegir_pesos(P, y)
    assert w[0] == 1.0 and f >= CAL.f1_macro(y, P.argmax(1), 3) - 1e-12


def test_intervalo_con_efecto_por_bloque_es_mas_ancho_y_contiene_la_media():
    rng = np.random.default_rng(3)
    n = 250
    p = np.tile([0.6, 0.25, 0.05, 0.10], (n, 1))
    df = pd.DataFrame({"votacion_id": "v1", "bloque_inicio": rng.choice(list("ABCDE"), n)})
    for i, c in enumerate(IV.CL4):
        df[f"p_{c}"] = p[:, i]
    i0 = IV.intervalos_simulados(df, 0.0, S=3000)
    i1 = IV.intervalos_simulados(df, 1.0, S=3000)
    ancho0 = i0.A_IC80_hi - i0.A_IC80_lo
    ancho1 = i1.A_IC80_hi - i1.A_IC80_lo
    assert (ancho1 > ancho0 * 1.5).all()
    assert i0.A_IC80_lo.iloc[0] < 150 < i0.A_IC80_hi.iloc[0]
    # independencia: ancho ≈ 2·1,2816·sqrt(n·p·(1-p))
    assert abs(ancho0.iloc[0] - 2 * 1.2816 * np.sqrt(n * 0.6 * 0.4)) < 4


def test_tema_app_limpia_prefijos_y_usa_texto_como_respaldo():
    t = "Aprobación del Convenio con la República de Chile"
    assert asignar_tema("Proyecto de ley: " + t) != asignar_tema(t)  # el problema
    assert asignar_tema_app("Proyecto de ley: " + t)[0] == asignar_tema(t)  # la solución
    assert limpiar_titulo("H. Cámara de Diputados de la Nación - Proyecto de Ley - Régimen X") == "REGIMEN X"
    tema, fuente = asignar_tema_app("Régimen X", "Proyecto de ley. Modificación del Código Penal ...")
    assert (tema, fuente) == ("JUSTICIA_SEGURIDAD", "texto_500")


@pytest.mark.parametrize("titulo", ["PRESUPUESTO GENERAL DE LA ADMINISTRACION NACIONAL 2016", "CONTRATO DE TRABAJO: MODIFICACION"])
def test_limpieza_no_cambia_titulos_del_dataset(titulo):
    assert limpiar_titulo(titulo) == titulo
