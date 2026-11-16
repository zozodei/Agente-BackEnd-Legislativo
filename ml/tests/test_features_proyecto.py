"""Fuga temporal en features de PROYECTO: ninguna usa datos posteriores a D-1 de la sesión
(o, para reglas documentales y votos previos, posteriores al inicio de la sesión), y la tabla
por expediente sólo contiene campos fijos desde la presentación.

Requiere el dataset descomprimido en datos/. No usa red. No carga PRUEBA.
"""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from poroteo import rutas  # noqa: E402
from poroteo.carga import consulta, leer_dataset  # noqa: E402
from poroteo.features import COLUMNAS_BASE, contexto_inicio_sesion  # noqa: E402
from poroteo.proyectos import (  # noqa: E402
    features_sesion,
    historial_tema,
    tabla_expedientes,
    tema_por_votacion,
    votos_elegibles,
)
from poroteo.temas import TEMAS, asignar_tema  # noqa: E402

pytestmark = pytest.mark.skipif(not rutas.SQLITE.exists(), reason="dataset no descomprimido")
N_MUESTRA = 80

COLUMNAS_PERMITIDAS = {
    "expediente", "proyecto_id", "fuente_proyecto", "publicacion_fecha", "tipo_norma", "camara_origen",
    "origen_expediente", "origen_autor", "autor", "autor_cruce_estado", "autor_cruce_motivo", "autor_persona_id",
    "autor_bloque_publicacion", "autor_bloque_desde", "gobierno_publicacion", "tema", "titulo",
}


@pytest.fixture(scope="module")
def filas() -> pd.DataFrame:
    partes = []
    for nombre in ("general", "presencia"):
        d = leer_dataset(nombre, COLUMNAS_BASE + ["expediente", "proyecto_id"])
        d = d[d.split.isin(["ENTRENAMIENTO", "VALIDACION"])]
        partes.append(d.assign(conjunto=nombre))
    return pd.concat(partes, ignore_index=True)


@pytest.fixture(scope="module")
def tabla(filas) -> pd.DataFrame:
    return tabla_expedientes(filas.drop_duplicates("votacion_id"))


@pytest.fixture(scope="module")
def tema_vot(tabla, filas) -> pd.Series:
    return tema_por_votacion(tabla, filas)


@pytest.fixture(scope="module")
def elegibles() -> pd.DataFrame:
    return votos_elegibles()


@pytest.fixture(scope="module")
def muestra(filas, tabla, tema_vot, elegibles) -> pd.DataFrame:
    partes = [g.sample(min(N_MUESTRA, len(g)), random_state=7) for _, g in filas.groupby(["conjunto", "split"])]
    # Asegurar casos de interés: autores diputados y Ejecutivo de un gobierno anterior
    dip = filas[filas.expediente.isin(tabla[tabla.autor_cruce_estado == "SEGURO"].expediente)]
    partes.append(dip.sample(min(N_MUESTRA, len(dip)), random_state=8))
    m = pd.concat(partes, ignore_index=True)
    ctx = contexto_inicio_sesion(m)
    m = m.merge(ctx, how="left", on=["legislador_id", "fecha_inicio_sesion"])
    m["tema"] = m.expediente.map(dict(zip(tabla.expediente, tabla.tema))).fillna("OTROS")
    th = historial_tema(m, elegibles, tema_vot)
    return features_sesion(m.drop(columns="tema"), tabla, th)


def test_tabla_solo_campos_fijos_desde_la_presentacion(tabla):
    assert set(tabla.columns) <= COLUMNAS_PERMITIDAS, set(tabla.columns) - COLUMNAS_PERMITIDAS
    prohibidas = ("tramite", "dictamen", "firma", "resultado", "sancion", "orden_dia", "estado_proyecto")
    assert not [c for c in tabla.columns if any(p in c.lower() for p in prohibidas)]
    assert tabla.expediente.is_unique


def test_tabla_no_incluye_votaciones_de_prueba(tabla):
    ve = consulta("select v.expediente, a.fecha_local from votacion_expediente v join votaciones a using(votacion_id)")
    solo_prueba = set(ve.expediente) - set(ve[ve.fecha_local < "2025-01-01"].expediente)
    p = leer_dataset("general", ["expediente", "split"])
    solo_prueba |= set(p[p.split == "PRUEBA"].expediente) - set(p[p.split != "PRUEBA"].expediente)
    pres = leer_dataset("presencia", ["expediente", "split"])
    solo_prueba -= set(pres[pres.split != "PRUEBA"].expediente)
    assert not (set(tabla.expediente) & solo_prueba)


def test_publicacion_anterior_o_igual_a_d_1(muestra):
    d_1 = pd.to_datetime(muestra.fecha_inicio_sesion.str[:10]) - pd.Timedelta(days=1)
    pub = pd.to_datetime(muestra.publicacion_fecha, errors="coerce")
    con = pub.notna() & muestra.proyecto_disponible
    assert con.mean() > 0.9
    assert (pub[con] <= d_1[con]).all()
    # Publicado después de D-1 → ninguna feature de proyecto
    nd = muestra[~muestra.proyecto_disponible]
    assert (nd.origen_autor == "DESCONOCIDO").all() and (nd.tema == "DESCONOCIDO").all()
    assert (nd.tA + nd.tN + nd.tAB == 0).all() and (nd.es_autor != "SI").all()


def test_mascara_proyecto_posterior_a_d_1(filas, tabla, tema_vot, elegibles):
    """Las votaciones con proyecto publicado el mismo día de la sesión quedan sin features."""
    pub = filas.expediente.map(dict(zip(tabla.expediente, tabla.publicacion_fecha)))
    tarde = filas[pd.to_datetime(pub, errors="coerce") > pd.to_datetime(filas.fecha_inicio_sesion.str[:10]) - pd.Timedelta(days=1)]
    assert len(tarde) > 0  # existen (2 votaciones de presencia en train)
    m = tarde.merge(contexto_inicio_sesion(tarde), how="left", on=["legislador_id", "fecha_inicio_sesion"])
    m["tema"] = "OTROS"
    f = features_sesion(m.drop(columns="tema"), tabla, historial_tema(m, elegibles, tema_vot))
    assert not f.proyecto_disponible.any()
    assert (f.alineacion_gobierno_sesion == "DESCONOCIDO").all()


def test_bloque_del_autor_vigente_en_la_publicacion(tabla):
    s = tabla[(tabla.autor_cruce_estado == "SEGURO") & (tabla.autor_bloque_desde.fillna("") != "")]
    assert len(s) > 100
    assert (pd.to_datetime(s.autor_bloque_desde) <= pd.to_datetime(s.publicacion_fecha)).all()


def test_gobierno_de_publicacion_coincide_con_la_fecha(tabla):
    g = consulta("select gobierno_id, desde, hasta from gobiernos_historicos")
    t = tabla.merge(g, how="left", left_on="gobierno_publicacion", right_on="gobierno_id")
    t = t[t.gobierno_id.notna()]
    assert ((t.desde <= t.publicacion_fecha) & (t.publicacion_fecha <= t.hasta)).all()


def test_reglas_documentales_anteriores_a_la_sesion(muestra):
    fecha = pd.to_datetime(muestra.fecha_inicio_sesion.str[:10])
    d_1 = fecha - pd.Timedelta(days=1)
    for col in ("signo_autor_fecha_regla", "alineacion_fecha_regla"):
        f = pd.to_datetime(muestra[col])
        assert (f[f.notna()] < fecha[f.notna()]).all(), col
    ib = pd.to_datetime(muestra.interbloque_desde)
    assert (ib[ib.notna()] <= d_1[ib.notna()]).all()


def test_historial_tema_solo_con_votos_previos_a_la_sesion(muestra, elegibles, tema_vot):
    """Recalcula por fuerza bruta: votos elegibles del mismo legislador y tema con
    fecha_local < límite predictivo de la sesión."""
    e = elegibles[elegibles.voto_resuelto.isin(["AFIRMATIVO", "NEGATIVO", "ABSTENCION"])].copy()
    e["tema"] = e.votacion_id.map(tema_vot)
    por_leg = dict(tuple(e.groupby("legislador_id")))
    errores = []
    for r in muestra.itertuples():
        x = por_leg.get(r.legislador_id, e.iloc[:0])
        previos = x[(x.tema == r.tema) & (x.fecha_local < r.limite_predictivo_sesion)]
        assert (previos.fecha_local < r.limite_predictivo_sesion).all()
        c = previos.voto_resuelto.value_counts()
        if (r.tA, r.tN, r.tAB) != (c.get("AFIRMATIVO", 0), c.get("NEGATIVO", 0), c.get("ABSTENCION", 0)):
            errores.append((r.votacion_id, r.legislador_id))
    assert not errores, errores[:5]
    assert (muestra.tA + muestra.tN + muestra.tAB).gt(0).mean() > 0.5


def test_ejecutivo_de_un_gobierno_anterior(muestra):
    ej = muestra[muestra.origen_autor == "EJECUTIVO"]
    doc = ~ej.gobierno_publicacion.isin(["PREVIO_2011_NO_DOCUMENTADO", "DESCONOCIDO"])
    vig = ej.gobierno_publicacion == ej.gobierno_inicio
    assert (ej[doc & vig].alineacion_gobierno_sesion == "EJECUTIVO_VIGENTE").all()
    assert (ej[doc & ~vig].alineacion_gobierno_sesion == "EJECUTIVO_ANTERIOR").all()


def test_es_autor_solo_con_cruce_seguro(muestra):
    assert (muestra[muestra.es_autor == "SI"].autor_cruce_estado == "SEGURO").all()
    dudoso = muestra.autor_cruce_estado.isin(["DUDOSO", "SIN_CRUCE"]) & muestra.origen_autor.eq("DIPUTADO")
    assert (muestra[dudoso].es_autor == "DESCONOCIDO").all()


def test_tema_depende_solo_del_titulo():
    assert list(inspect.signature(asignar_tema).parameters) == ["titulo"]
    assert asignar_tema("Presupuesto General de la Administración Nacional 2016") == "PRESUPUESTO_CUENTAS"
    assert asignar_tema("Contrato de trabajo: modificación del artículo 150") == "TRABAJO_PREVISION"
    assert asignar_tema("") == "OTROS"
    assert 11 <= len(TEMAS) - 1 <= 15
