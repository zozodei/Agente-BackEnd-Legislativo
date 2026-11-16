"""Construcción de predictores. Cada feature documenta por qué está disponible ANTES
del inicio de la sesión (`limite_predictivo_sesion`).

Nunca se usan las columnas observadas en la fila del evento (`bloque`, `interbloque`,
`signo_politico`, `tipo_verificado`, resultados): el protocolo las declara metadatos.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .carga import consulta
from .texto import normalizar

CLASES_VOTO = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION"]
DESCONOCIDO = "DESCONOCIDO"

# Historial móvil (principal) y congelado al 2023-01-01 (secundario, benchmark).
HIST_MOVIL = {"A": "prev_afirmativo", "N": "prev_negativo", "AB": "prev_abstencion", "AU": "prev_ausente"}
HIST_CONGELADO = {
    "A": "hist_train_afirmativo",
    "N": "hist_train_negativo",
    "AB": "hist_train_abstencion",
    "AU": "hist_train_ausente",
}

COLUMNAS_BASE = [
    "votacion_id",
    "legislador_id",
    "split",
    "grupo_proyecto",
    "fecha_inicio_sesion",
    "limite_predictivo_sesion",
    *HIST_MOVIL.values(),
    *HIST_CONGELADO.values(),
]


# ---------------------------------------------------------------- contexto al inicio


def _intervalos() -> pd.DataFrame:
    """Intervalos literales de mandato y bloque (registro oficial HCDN corregido en Fase 4)."""
    h = consulta("select ID, DISTRITO, INICIO, FIN, CESE, BLOQUE, BLOQUE_INICIO, BLOQUE_FIN from historial_bloques_intervalos")
    for c in ("INICIO", "FIN", "CESE", "BLOQUE_INICIO", "BLOQUE_FIN"):
        h[c] = pd.to_datetime(h[c].str[:10], errors="coerce")
    h["MANDATO_FIN"] = h[["FIN", "CESE"]].min(axis=1)
    h["BLOQUE_N"] = h.BLOQUE.map(normalizar)
    h["DISTRITO_N"] = h.DISTRITO.map(normalizar)
    return h


def _mapa_signo() -> pd.DataFrame:
    """Regla documental bloque × gobierno → signo, con la fecha en que consta por primera vez."""
    c = consulta("select bloque, fecha_dia, gobierno_id, signo_politico from contexto_bloque_fecha")
    c["BLOQUE_N"] = c.bloque.map(normalizar)
    c["fecha_dia"] = pd.to_datetime(c.fecha_dia)
    return c


def _gobiernos() -> pd.DataFrame:
    g = consulta("select gobierno_id, desde, hasta from gobiernos_historicos")
    g["desde"] = pd.to_datetime(g.desde)
    g["hasta"] = pd.to_datetime(g.hasta)
    return g


def contexto_inicio_sesion(pares: pd.DataFrame) -> pd.DataFrame:
    """Para cada (legislador_id, fecha_inicio_sesion) devuelve bloque, distrito y signo vigentes
    el DÍA ANTERIOR a la sesión.

    Disponibilidad previa: la pertenencia a bloque y el distrito del mandato se comunican
    formalmente a la Cámara antes de sesionar; usamos sólo intervalos con BLOQUE_INICIO <= D-1.
    El signo es la regla documental bloque × gobierno vigente en D-1 y sólo se toma si esa
    regla ya consta en una fecha ESTRICTAMENTE anterior a la sesión.
    """
    leg = consulta("select legislador_id, persona_id from legisladores")
    p = pares[["legislador_id", "fecha_inicio_sesion"]].drop_duplicates().merge(leg, how="left")
    p["d_1"] = pd.to_datetime(p.fecha_inicio_sesion.str[:10]) - pd.Timedelta(days=1)

    h = _intervalos()
    m = p.merge(h, left_on="persona_id", right_on="ID", how="left")
    vig_mandato = (m.INICIO <= m.d_1) & (m.d_1 <= m.MANDATO_FIN)
    vig_bloque = vig_mandato & (m.BLOQUE_INICIO <= m.d_1) & (m.d_1 <= m.BLOQUE_FIN)
    clave = ["legislador_id", "fecha_inicio_sesion"]

    dist = m[vig_mandato].groupby(clave).DISTRITO_N.agg(lambda s: s.iloc[0] if s.nunique() == 1 else DESCONOCIDO)
    bloq = m[vig_bloque].groupby(clave).agg(
        bloque_inicio=("BLOQUE_N", lambda s: s.iloc[0] if s.nunique() == 1 else DESCONOCIDO),
        bloque_inicio_desde=("BLOQUE_INICIO", "max"),
        motivo=("BLOQUE_N", lambda s: "UNICO" if s.nunique() == 1 else "AMBIGUO"),
    )
    out = p.set_index(clave).join(dist.rename("distrito_inicio")).join(bloq).reset_index()
    out["distrito_inicio"] = out.distrito_inicio.fillna(DESCONOCIDO)
    out["motivo"] = out.motivo.fillna("SIN_INTERVALO")
    out["bloque_inicio"] = out.bloque_inicio.fillna(DESCONOCIDO)

    # Gobierno vigente en D-1 (hecho público previo).
    g = _gobiernos()
    out["gobierno_inicio"] = DESCONOCIDO
    for r in g.itertuples():
        out.loc[(out.d_1 >= r.desde) & (out.d_1 <= r.hasta), "gobierno_inicio"] = r.gobierno_id

    # Signo: última regla (bloque, gobierno) registrada estrictamente antes de la sesión.
    c = _mapa_signo()
    out["fecha_sesion"] = pd.to_datetime(out.fecha_inicio_sesion.str[:10])
    q = out[["bloque_inicio", "gobierno_inicio", "fecha_sesion"]].drop_duplicates()
    q = q.merge(c, left_on=["bloque_inicio", "gobierno_inicio"], right_on=["BLOQUE_N", "gobierno_id"], how="left")
    q = q[q.fecha_dia < q.fecha_sesion].sort_values("fecha_dia")
    sig = q.groupby(["bloque_inicio", "gobierno_inicio", "fecha_sesion"]).agg(
        signo_inicio=("signo_politico", "last"), signo_regla_fecha=("fecha_dia", "last")
    )
    out = out.merge(sig.reset_index(), how="left", on=["bloque_inicio", "gobierno_inicio", "fecha_sesion"])
    out["signo_inicio"] = out.signo_inicio.fillna("NO_VERIFICADO")
    out.loc[out.bloque_inicio == DESCONOCIDO, "signo_inicio"] = DESCONOCIDO
    return out.drop(columns=["d_1", "fecha_sesion", "persona_id"])


def estado_bloque_fila(df: pd.DataFrame) -> pd.Series:
    """`bloque_historico_estado` de la fila (calidad del dato, no su valor). Por decisión del
    usuario, BLOCKED → bloque DESCONOCIDO, sin rellenar."""
    v = consulta("select votacion_id, legislador_id, bloque_historico_estado from votos")
    return df[["votacion_id", "legislador_id"]].merge(v, how="left").bloque_historico_estado.fillna("")


def agregar_contexto(df: pd.DataFrame) -> pd.DataFrame:
    ctx = contexto_inicio_sesion(df)
    out = df.merge(ctx, how="left", on=["legislador_id", "fecha_inicio_sesion"], validate="m:1")
    bloqueada = estado_bloque_fila(out).values == "BLOCKED"
    out["bloque_fila_blocked"] = bloqueada
    out.loc[bloqueada, ["bloque_inicio", "signo_inicio"]] = DESCONOCIDO
    return out


# ---------------------------------------------------------------- historial


def conteos(df: pd.DataFrame, variante: str) -> pd.DataFrame:
    """Conteos de historial (enteros). Disponibilidad: el proveedor sólo cuenta votos con
    fecha_local < limite_predictivo_sesion (móvil) o < min(límite, 2023-01-01) (congelado);
    verificado de forma independiente en tests/test_fuga_temporal.py."""
    cols = HIST_MOVIL if variante == "movil" else HIST_CONGELADO
    return pd.DataFrame({k: df[c].astype(int).values for k, c in cols.items()}, index=df.index)


def features_historial(c: pd.DataFrame, objetivo: str, prior: np.ndarray, alpha: float) -> pd.DataFrame:
    """Proporciones suavizadas hacia `prior` (estimado sólo con el train del fold) + volumen.

    objetivo='voto': proporciones A/N/AB entre votos emitidos.
    objetivo='presencia': tasa de presencia sobre votos+ausencias.
    """
    out = pd.DataFrame(index=c.index)
    if objetivo == "voto":
        n = c.A + c.N + c.AB
        for i, k in enumerate(["A", "N", "AB"]):
            out[f"h_{k}"] = (c[k] + alpha * prior[i]) / (n + alpha)
    else:
        n = c.A + c.N + c.AB + c.AU
        out["h_pres"] = (n - c.AU + alpha * prior[0]) / (n + alpha)
    out["h_log_n"] = np.log1p(n)
    out["sin_historial"] = (n == 0).astype(int)
    return out
