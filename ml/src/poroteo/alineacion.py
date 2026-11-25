"""Alineación reciente del bloque con el oficialismo (etapa 4b).

Pregunta: ¿cuánto votó este bloque como el bloque oficialista en las últimas votaciones
ANTES de la sesión? Corrige el cambio de régimen de 2024: PRO y UCR están marcados como
NO_OFICIALISTA bajo Milei, pero en 2024 votaron con el gobierno. Medir la alineación reciente
con votos pasados deja que el modelo lo aprenda sin depender de la etiqueta documental.

Definiciones (todas con información ESTRICTAMENTE anterior a la sesión):
- Mayoría de un bloque en una votación: AFIRMATIVO vs NEGATIVO entre sus diputados que votaron
  (ABSTENCION y ausentes no cuentan). Empate o sin votos → sin mayoría (no cuenta).
- Oficialismo en una votación: los diputados que votaron AFIRMATIVO/NEGATIVO y cuyo bloque
  consta como OFICIALISMO (`es_oficialismo` de `contexto_bloque_fecha`) en el día anterior a la
  votación. Mayoría de esos votos.
- Acuerdo: el bloque y el oficialismo tienen mayoría y coinciden en la votación.
- Feature: proporción suavizada de acuerdos del bloque en las votaciones con fecha en
  [límite − VENTANA_DIAS, límite), donde límite = `limite_predictivo_sesion`. Si no hay votos,
  vale PRIOR. Nunca se usa PRUEBA: las votaciones de la ventana son anteriores al límite, y
  los límites de ENTRENAMIENTO y VALIDACION son < 2025.

Limitación: el bloque oficialista se cuenta a sí mismo, así que su alineación es 1 por construcción.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .carga import consulta
from .proyectos import votos_elegibles
from .texto import normalizar

VENTANA_DIAS = 180
ALPHA = 5.0  # suavizado hacia PRIOR; con pocas votaciones en la ventana, pesa más el prior
PRIOR = 0.5
COLUMNAS = ["alin_rec", "alin_rec_log_n"]


def _oficialismo_por_bloque() -> pd.DataFrame:
    """Línea de tiempo documental: bloque normalizado, fecha de la regla y si es oficialismo."""
    c = consulta("select bloque, fecha_dia, es_oficialismo from contexto_bloque_fecha")
    c["b"] = c.bloque.map(normalizar)
    c["f"] = pd.to_datetime(c.fecha_dia)
    # Sólo cuenta como oficialismo el "1" documentado. Vacío (NO_VERIFICADO) no es oficialismo.
    c["of"] = (c.es_oficialismo.str.strip() == "1").astype(int)
    return c.groupby(["b", "f"], as_index=False).of.max().sort_values("f")


def acuerdos_bloque_oficialismo() -> pd.DataFrame:
    """Una fila por (votación, bloque) con mayoría definida y mayoría oficialista definida.
    Columnas: b (bloque normalizado), f (fecha de la votación), agree (1 si coinciden)."""
    e = votos_elegibles()
    e = e[e.voto_resuelto.isin(["AFIRMATIVO", "NEGATIVO"])]
    v = consulta("select votacion_id, legislador_id, bloque, bloque_historico_estado from votos")
    m = e.merge(v, on=["votacion_id", "legislador_id"], how="inner")
    m = m[m.bloque_historico_estado != "BLOCKED"]
    m["b"] = m.bloque.map(normalizar)
    m["f"] = pd.to_datetime(m.fecha_local)
    m["A"] = (m.voto_resuelto == "AFIRMATIVO").astype(int)
    m["N"] = 1 - m.A

    # Flag de oficialismo de cada bloque, con la regla documental vigente el día ANTERIOR a la votación.
    linea = _oficialismo_por_bloque()
    voto_b = m[["votacion_id", "b", "f"]].drop_duplicates().sort_values("f")
    voto_b = pd.merge_asof(voto_b, linea[["b", "f", "of"]], on="f", by="b", direction="backward", allow_exact_matches=False)
    voto_b["of"] = voto_b.of.fillna(0).astype(int)
    m = m.merge(voto_b[["votacion_id", "b", "of"]], on=["votacion_id", "b"], how="left")

    # Mayoría de cada bloque y del oficialismo, por votación.
    bloques = m.groupby(["votacion_id", "b"], as_index=False).agg(bA=("A", "sum"), bN=("N", "sum"), f=("f", "first"))
    bloques["bmaj"] = np.sign(bloques.bA - bloques.bN)
    of = m[m.of == 1].groupby("votacion_id").agg(oA=("A", "sum"), oN=("N", "sum"))
    of["omaj"] = np.sign(of.oA - of.oN)
    bloques = bloques.merge(of[["omaj"]], left_on="votacion_id", right_index=True, how="left")
    ok = (bloques.bmaj != 0) & bloques.omaj.notna() & (bloques.omaj != 0)
    out = bloques.loc[ok, ["b", "f"]].copy()
    out["agree"] = (bloques.loc[ok, "bmaj"] == bloques.loc[ok, "omaj"]).astype(int).values
    return out.sort_values(["b", "f"]).reset_index(drop=True)


def agregar_alineacion_reciente(df: pd.DataFrame, acuerdos: pd.DataFrame) -> pd.DataFrame:
    """Agrega `alin_rec` y `alin_rec_log_n` a `df`. Requiere `bloque_inicio` (normalizado) y
    `limite_predictivo_sesion`. Devuelve una copia."""
    out = df.copy()
    n = len(out)
    cons_ok = np.full(n, 0.0)
    cnt = np.zeros(n)
    L = pd.to_datetime(out.limite_predictivo_sesion).values
    ventana = np.timedelta64(VENTANA_DIAS, "D")
    grupos = out.bloque_inicio.values
    indices = pd.Series(np.arange(n)).groupby(grupos).indices
    por_bloque = {b: g for b, g in acuerdos.groupby("b")}
    for b, idx in indices.items():
        if b not in por_bloque:
            continue
        g = por_bloque[b].sort_values("f")
        f = g.f.values
        acum_agree = np.concatenate([[0.0], np.cumsum(g.agree.values)])
        Lq = L[idx]
        hi = np.searchsorted(f, Lq, side="left")  # votaciones con fecha < límite
        lo = np.searchsorted(f, Lq - ventana, side="left")  # ... y fecha >= límite − ventana
        cons_ok[idx] = acum_agree[hi] - acum_agree[lo]
        cnt[idx] = hi - lo
    out["alin_rec"] = (cons_ok + ALPHA * PRIOR) / (cnt + ALPHA)
    out["alin_rec_log_n"] = np.log1p(cnt)
    return out
