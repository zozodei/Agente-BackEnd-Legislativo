"""Controles de fuga: ninguna feature usa datos con fecha >= inicio de sesión y ninguna
votación (ni grupo de proyecto) queda repartida entre splits.

Requiere el dataset descomprimido en datos/. No usa red.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from poroteo import rutas  # noqa: E402
from poroteo.carga import SPLITS_ESTANDAR, consulta, leer_dataset  # noqa: E402
from poroteo.features import COLUMNAS_BASE, contexto_inicio_sesion  # noqa: E402
from poroteo.metricas import resultado  # noqa: E402

pytestmark = pytest.mark.skipif(not rutas.SQLITE.exists(), reason="dataset no descomprimido")

IDENTIDAD_OK = (
    "NOMBRE_COMPLETO_PROVINCIA_MANDATO_UNICOS",
    "ALIAS_DETALLE_OFICIAL_MANDATO_UNICOS",
    "ALIAS_TEMPORAL_NOMBRE_DISTRITO_MANDATO_UNICOS_FASE4",
)
CONTRASTE_OK = ("coincide", "solo_fuente_oficial", "COINCIDE_DETALLE_ALIAS", "VERIFICADO_ACTA_DIARIO", "VERIFICADO_DIARIO_LISTA_NOMINAL")
N_MUESTRA = 60  # filas por split y conjunto


@pytest.fixture(scope="module")
def muestra() -> pd.DataFrame:
    partes = []
    for nombre in ("general", "presencia"):
        d = leer_dataset(nombre, COLUMNAS_BASE)
        for _, g in d.groupby("split"):
            partes.append(g.sample(min(N_MUESTRA, len(g)), random_state=413).assign(conjunto=nombre))
    return pd.concat(partes, ignore_index=True)


@pytest.fixture(scope="module")
def votos_muestra(muestra) -> pd.DataFrame:
    ids = ",".join(f"'{x}'" for x in muestra.legislador_id.unique())
    v = consulta(
        "select v.votacion_id, v.legislador_id, v.voto_resuelto, v.fecha_local, v.identidad_estado, v.mandato_estado, "
        "v.duplicado_conflictivo, v.estado_contraste, v.ausencia_estado from votos v "
        f"where v.legislador_id in ({ids})"
    )
    a = consulta("select * from votaciones")
    ctl = [c for c in a.columns if c.startswith("control_total_") and not c.endswith("_fase2")]
    conflictivas = set(a.loc[a[ctl].eq("FAIL").any(axis=1), "votacion_id"])
    elegible = (
        ((v.voto_resuelto.isin(["AFIRMATIVO", "NEGATIVO", "ABSTENCION"]) & v.estado_contraste.isin(CONTRASTE_OK))
         | v.ausencia_estado.str.startswith("CONFIRMADA_"))
        & v.identidad_estado.isin(IDENTIDAD_OK)
        & (v.mandato_estado == "PASS")
        & ~v.duplicado_conflictivo.str.lower().eq("true")
        & ~v.votacion_id.isin(conflictivas)
    )
    return v[elegible]


@pytest.mark.parametrize(
    "prefijo,corte_fijo",
    [("prev_", None), ("hist_train_", "2023-01-01T00:00:00")],
)
def test_historial_solo_usa_votos_anteriores_a_la_sesion(muestra, votos_muestra, prefijo, corte_fijo):
    """Recalcula el historial de forma independiente con fecha_local < límite de sesión y
    exige igualdad exacta con las columnas del dataset."""
    por_leg = dict(tuple(votos_muestra.groupby("legislador_id")))
    errores = []
    for r in muestra.itertuples():
        corte = r.limite_predictivo_sesion if corte_fijo is None else min(r.limite_predictivo_sesion, corte_fijo)
        x = por_leg.get(r.legislador_id, votos_muestra.iloc[:0])
        previos = x[x.fecha_local < corte]
        assert (previos.fecha_local < r.limite_predictivo_sesion).all()
        c = previos.voto_resuelto.value_counts()
        for etiqueta in ("AFIRMATIVO", "NEGATIVO", "ABSTENCION", "AUSENTE"):
            if int(getattr(r, prefijo + etiqueta.lower())) != int(c.get(etiqueta, 0)):
                errores.append((r.votacion_id, r.legislador_id, etiqueta))
    assert not errores, errores[:5]


def test_limite_anterior_a_todas_las_votaciones_de_la_sesion():
    """Ninguna votación de una sesión ocurre antes del límite predictivo de esa sesión."""
    s = consulta(
        "select s.sesion_id, s.limite_predictivo_sesion lim, v.fecha_local f from votacion_sesion s "
        "join votaciones v using(votacion_id) where s.limite_predictivo_sesion <> ''"
    )
    assert (s.lim <= s.f).all()
    assert s.groupby("sesion_id").lim.nunique().max() == 1


def test_contexto_inicio_usa_solo_hechos_previos(muestra):
    """bloque/distrito/signo al inicio: intervalo iniciado <= D-1 y regla de signo con fecha < sesión."""
    ctx = contexto_inicio_sesion(muestra)
    fecha = pd.to_datetime(ctx.fecha_inicio_sesion.str[:10])
    con_bloque = ctx.bloque_inicio_desde.notna()
    assert con_bloque.mean() > 0.95
    assert (ctx.bloque_inicio_desde[con_bloque] < fecha[con_bloque]).all()
    con_regla = ctx.signo_regla_fecha.notna()
    assert (ctx.signo_regla_fecha[con_regla] < fecha[con_regla]).all()


def test_no_hay_votaciones_ni_grupos_repartidos_entre_splits():
    partes = []
    for nombre in rutas.DATASETS_ML:
        partes.append(leer_dataset(nombre, ["votacion_id", "grupo_proyecto", "split"], solo_estandar=False))
    t = pd.concat(partes).drop_duplicates()
    assert (t.groupby("votacion_id").split.nunique() <= 1).all()
    std = t[t.split.isin(SPLITS_ESTANDAR)]
    assert (std.groupby("grupo_proyecto").split.nunique() <= 1).all()


def test_lector_excluye_cuarentena_y_sin_grupo():
    for nombre in rutas.DATASETS_ML:
        d = leer_dataset(nombre, ["split"])
        assert set(d.split) <= set(SPLITS_ESTANDAR)


@pytest.mark.parametrize(
    "a,n,ab,may,esperado",
    [
        (100, 20, 5, "simple", "SIN_QUORUM"),
        (70, 60, 0, "simple", "APROBADO"),
        (65, 65, 0, "simple", "RECHAZADO"),
        (128, 0, 10, "absoluta", "RECHAZADO"),
        (129, 100, 0, "absoluta", "APROBADO"),
        (100, 50, 0, "dos_tercios", "APROBADO"),
        (99, 51, 0, "dos_tercios", "RECHAZADO"),
    ],
)
def test_reglas_resultado_iguales_a_la_app(a, n, ab, may, esperado):
    assert resultado(a, n, ab, may) == esperado
