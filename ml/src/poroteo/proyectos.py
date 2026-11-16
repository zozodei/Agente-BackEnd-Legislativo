"""Features de PROYECTO (etapa 3). Dos niveles:

1. `tabla_expedientes()` → una fila por expediente, sólo con campos FIJOS desde la
   presentación: número/tipo de expediente, TIPO de norma, cámara de origen, AUTOR,
   PUBLICACION_FECHA y TITULO (`proyectos_de_ley` / `proyectos`). Nada de estado, trámite,
   dictámenes ni firmas, que cambian después de la presentación.
   Derivados de esos campos con datos fechados en la publicación:
   - autor diputado cruzado (SEGURO / DUDOSO / SIN_CRUCE) contra mandatos vigentes en
     PUBLICACION_FECHA (sin matching difuso);
   - bloque del autor vigente en PUBLICACION_FECHA (intervalo literal HCDN);
   - gobierno vigente en PUBLICACION_FECHA (`gobiernos_historicos`);
   - tema por reglas sobre el título (`temas.py`).

2. `features_sesion(df, tabla)` → rasgos que dependen de la sesión y se calculan con datos
   de D-1 (día anterior a la sesión) o con reglas documentales fechadas ANTES de la sesión:
   alineación del autor con el gobierno vigente en D-1, interacciones con el signo/bloque del
   diputado, es_autor e historial del diputado en el tema (votos con fecha < límite).

PUBLICACION_FECHA es siempre <= D-1 en los datos (mínimo 2 días antes de la sesión); lo
verifica tests/test_features_proyecto.py.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .carga import consulta
from .features import DESCONOCIDO, _gobiernos, _intervalos, _mapa_signo
from .temas import asignar_tema
from .texto import normalizar

NO_APLICA = "NO_APLICA"
CORTE_SIN_PRUEBA = "2025-01-01"  # ninguna votación de PRUEBA entra a la tabla ni al historial

IDENTIDAD_OK = (
    "NOMBRE_COMPLETO_PROVINCIA_MANDATO_UNICOS",
    "ALIAS_DETALLE_OFICIAL_MANDATO_UNICOS",
    "ALIAS_TEMPORAL_NOMBRE_DISTRITO_MANDATO_UNICOS_FASE4",
)
CONTRASTE_OK = ("coincide", "solo_fuente_oficial", "COINCIDE_DETALLE_ALIAS", "VERIFICADO_ACTA_DIARIO",
                "VERIFICADO_DIARIO_LISTA_NOMINAL")


# ---------------------------------------------------------------- autor


def _partir(nombre: str) -> tuple[str, str]:
    ap, _, no = normalizar(nombre).partition(",")
    return ap.strip(), no.strip()


def cruzar_autor(autor: str, fecha: pd.Timestamp, h: pd.DataFrame) -> tuple[str, str, str]:
    """Autor "APELLIDO, NOMBRE" → (estado, persona ID, motivo) contra mandatos vigentes en `fecha`.
    SEGURO sólo con nombre completo normalizado idéntico y único. Todo lo demás es DUDOSO o
    SIN_CRUCE y no se usa como cruce."""
    ap, no = _partir(autor)
    v = h[(h.INICIO <= fecha) & (fecha <= h.MANDATO_FIN)]
    exacto = v[(v.AP == ap) & (v.NO == no)].ID.unique()
    if len(exacto) == 1:
        return "SEGURO", exacto[0], "nombre completo idéntico"
    mismo_ap = v[v.AP == ap]
    if mismo_ap.ID.nunique() == 0:
        return "SIN_CRUCE", "", "ningún diputado con ese apellido en mandato"
    primer = no.split(" ")[0] if no else ""
    compat = mismo_ap[mismo_ap.NO.str.split(" ").str[0] == primer] if primer else mismo_ap.iloc[:0]
    if compat.ID.nunique() == 1:
        return "DUDOSO", compat.ID.iloc[0], f"apellido + primer nombre ({compat.NOMBRE.iloc[0]})"
    if mismo_ap.ID.nunique() == 1:
        return "DUDOSO", mismo_ap.ID.iloc[0], f"sólo apellido único ({mismo_ap.NOMBRE.iloc[0]})"
    return "DUDOSO", "|".join(sorted(mismo_ap.ID.unique())), "apellido ambiguo"


def intervalos_con_nombres() -> pd.DataFrame:
    h = _intervalos()
    n = consulta("select ID, APELLIDO, NOMBRE from historial_bloques_intervalos")
    h["AP"], h["NO"], h["NOMBRE"] = n.APELLIDO.map(normalizar).values, n.NOMBRE.map(normalizar).values, n.NOMBRE.values
    return h


def origen_autor(tipo_exp: str, tipo_norma: str, autor: str) -> str:
    """Quién presentó el proyecto. Un expediente S con TIPO 'MENSAJE Y PROYECTO DE LEY' es un
    mensaje del Poder Ejecutivo que ingresó por el Senado."""
    if tipo_exp in ("PE", "JGM") or (tipo_exp == "S" and tipo_norma.startswith("MENSAJE")):
        return "EJECUTIVO"
    persona = "," in (autor or "")
    if tipo_exp == "D":
        return "DIPUTADO" if persona else "COMISION"
    if tipo_exp == "S":
        return "SENADOR" if persona else "COMISION"
    return "OTRO"


# ---------------------------------------------------------------- tabla por expediente


def _expedientes_objetivo(datasets: pd.DataFrame) -> pd.DataFrame:
    """Expedientes de las filas de train/validación + expedientes de votaciones anteriores a
    2025 (para el historial por tema). Ninguna votación de PRUEBA."""
    ve = consulta("select v.votacion_id, v.expediente, v.proyecto_id, a.fecha_local from votacion_expediente v "
                  "join votaciones a using(votacion_id)")
    ve = ve[ve.fecha_local < CORTE_SIN_PRUEBA]
    d = datasets[["expediente", "proyecto_id"]]
    return pd.concat([d, ve[["expediente", "proyecto_id"]]]).drop_duplicates("expediente")


def tabla_expedientes(datasets: pd.DataFrame) -> pd.DataFrame:
    """Una fila por expediente con campos fijos desde la presentación (ver docstring)."""
    exps = _expedientes_objetivo(datasets)
    pr = consulta("select PROYECTO_ID, TITULO, PUBLICACION_FECHA, CAMARA_ORIGEN, TIPO, AUTOR from proyectos")
    pl = consulta("select PROYECTO_ID, TITULO, PUBLICACION_FECHA, CAMARA_ORIGEN, TIPO, AUTOR from proyectos_de_ley")
    fuente = pd.concat([pl.assign(fuente_proyecto="proyectos_de_ley"), pr.assign(fuente_proyecto="proyectos")])
    fuente = fuente.drop_duplicates("PROYECTO_ID")
    t = exps.merge(fuente, how="left", left_on="proyecto_id", right_on="PROYECTO_ID").drop(columns="PROYECTO_ID")
    t = t.fillna({"TITULO": "", "PUBLICACION_FECHA": "", "CAMARA_ORIGEN": "", "TIPO": "", "AUTOR": "", "fuente_proyecto": ""})
    t = t.rename(columns={"TITULO": "titulo", "PUBLICACION_FECHA": "publicacion_fecha", "CAMARA_ORIGEN": "camara_origen",
                          "TIPO": "tipo_norma", "AUTOR": "autor"})
    t["publicacion_fecha"] = t.publicacion_fecha.str[:10]
    partes = t.expediente.str.split("-")
    t["origen_expediente"] = np.where(partes.str.len() == 3, partes.str[1], "OTRO")
    t["origen_autor"] = [origen_autor(a, b, c) for a, b, c in zip(t.origen_expediente, t.tipo_norma, t.autor)]
    t["tema"] = t.titulo.map(asignar_tema)

    # Gobierno vigente en la fecha de publicación
    pub = pd.to_datetime(t.publicacion_fecha, errors="coerce")
    g = _gobiernos()
    t["gobierno_publicacion"] = np.where(pub.isna(), DESCONOCIDO, "PREVIO_2011_NO_DOCUMENTADO")
    for r in g.itertuples():
        t.loc[(pub >= r.desde) & (pub <= r.hasta), "gobierno_publicacion"] = r.gobierno_id

    # Autor diputado: cruce en la fecha de publicación + bloque vigente ese día
    h = intervalos_con_nombres()
    est, pid, mot, bloq, bdesde = [], [], [], [], []
    for r, f in zip(t.itertuples(), pub):
        if r.origen_autor != "DIPUTADO" or pd.isna(f):
            est.append(NO_APLICA if r.origen_autor != "DIPUTADO" else "SIN_CRUCE")
            pid.append(""); mot.append(f"autor {r.origen_autor.lower()}"); bloq.append(NO_APLICA if r.origen_autor != "DIPUTADO" else DESCONOCIDO)
            bdesde.append(pd.NaT)
            continue
        e, p, m = cruzar_autor(r.autor, f, h)
        est.append(e); pid.append(p if e == "SEGURO" else ""); mot.append(m)
        if e != "SEGURO":
            bloq.append(DESCONOCIDO); bdesde.append(pd.NaT)
            continue
        x = h[(h.ID == p) & (h.INICIO <= f) & (f <= h.MANDATO_FIN) & (h.BLOQUE_INICIO <= f) & (f <= h.BLOQUE_FIN)]
        if x.BLOQUE_N.nunique() == 1:
            bloq.append(x.BLOQUE_N.iloc[0]); bdesde.append(x.BLOQUE_INICIO.max())
        else:
            bloq.append(DESCONOCIDO); bdesde.append(pd.NaT)
    t["autor_cruce_estado"], t["autor_persona_id"], t["autor_cruce_motivo"] = est, pid, mot
    t["autor_bloque_publicacion"], t["autor_bloque_desde"] = bloq, pd.to_datetime(pd.Series(bdesde)).dt.strftime("%Y-%m-%d").values
    cols = ["expediente", "proyecto_id", "fuente_proyecto", "publicacion_fecha", "tipo_norma", "camara_origen",
            "origen_expediente", "origen_autor", "autor", "autor_cruce_estado", "autor_cruce_motivo", "autor_persona_id",
            "autor_bloque_publicacion", "autor_bloque_desde", "gobierno_publicacion", "tema", "titulo"]
    return t[cols].reset_index(drop=True)


# ---------------------------------------------------------------- reglas fechadas


def signo_regla(bloques: pd.Series, gobiernos: pd.Series, fechas_sesion: pd.Series) -> pd.DataFrame:
    """Signo documental (bloque × gobierno) con la última regla registrada ESTRICTAMENTE antes
    de la sesión. Devuelve signo y fecha de la regla (NaT si no consta → NO_VERIFICADO)."""
    q = pd.DataFrame({"b": bloques.values, "g": gobiernos.values, "f": fechas_sesion.values})
    u = q.drop_duplicates()
    c = _mapa_signo()
    m = u.merge(c, left_on=["b", "g"], right_on=["BLOQUE_N", "gobierno_id"], how="left")
    m = m[m.fecha_dia < m.f].sort_values("fecha_dia")
    r = m.groupby(["b", "g", "f"]).agg(signo=("signo_politico", "last"), fecha_regla=("fecha_dia", "last")).reset_index()
    out = q.merge(r, how="left", on=["b", "g", "f"])
    out["signo"] = out.signo.fillna("NO_VERIFICADO")
    return out[["signo", "fecha_regla"]]


def familias() -> dict[str, str]:
    """`familia_politica_literal` (estática por bloque; agrupa variantes de nombre como
    PRO / UNION PRO / PROPUESTA REPUBLICANA). SIN_AGRUPAR → el bloque es su propia familia."""
    c = consulta("select distinct bloque, familia_politica_literal f from contexto_bloque_fecha")
    c["b"] = c.bloque.map(normalizar)
    return {b: f for b, f in zip(c.b, c.f) if f != "SIN_AGRUPAR"}


def interbloques() -> pd.DataFrame:
    ib = consulta("select bloque_normalizado b, interbloque, desde, hasta from bloque_interbloque_historico")
    ib["b"] = ib.b.map(normalizar)
    ib["desde"], ib["hasta"] = pd.to_datetime(ib.desde), pd.to_datetime(ib.hasta)
    return ib


# ---------------------------------------------------------------- historial por tema


def votos_elegibles() -> pd.DataFrame:
    """Mismos criterios que el proveedor usa para prev_* (verificados en test_fuga_temporal).
    Sólo votaciones anteriores a 2025 (PRUEBA no entra)."""
    v = consulta(
        "select votacion_id, legislador_id, voto_resuelto, fecha_local, identidad_estado, mandato_estado, "
        "duplicado_conflictivo, estado_contraste, ausencia_estado from votos "
        f"where fecha_local < '{CORTE_SIN_PRUEBA}'"
    )
    a = consulta("select * from votaciones")
    ctl = [c for c in a.columns if c.startswith("control_total_") and not c.endswith("_fase2")]
    conflictivas = set(a.loc[a[ctl].eq("FAIL").any(axis=1), "votacion_id"])
    ok = (
        ((v.voto_resuelto.isin(["AFIRMATIVO", "NEGATIVO", "ABSTENCION"]) & v.estado_contraste.isin(CONTRASTE_OK))
         | v.ausencia_estado.str.startswith("CONFIRMADA_"))
        & v.identidad_estado.isin(IDENTIDAD_OK)
        & (v.mandato_estado == "PASS")
        & ~v.duplicado_conflictivo.str.lower().eq("true")
        & ~v.votacion_id.isin(conflictivas)
    )
    return v.loc[ok, ["votacion_id", "legislador_id", "voto_resuelto", "fecha_local"]]


def tema_por_votacion(tabla: pd.DataFrame, datasets: pd.DataFrame) -> pd.Series:
    """Tema de cada votación: el del expediente del dataset si la votación está en él; si no,
    el tema más frecuente entre sus expedientes vinculados (empate → primero por expediente)."""
    tema = dict(zip(tabla.expediente, tabla.tema))
    d = datasets.drop_duplicates("votacion_id")
    out = dict(zip(d.votacion_id, d.expediente.map(tema)))
    ve = consulta("select votacion_id, expediente from votacion_expediente").sort_values(["votacion_id", "expediente"])
    ve["tema"] = ve.expediente.map(tema)
    ve = ve.dropna(subset=["tema"])
    for vid, g in ve.groupby("votacion_id"):
        if vid not in out:
            out[vid] = g.tema.value_counts().index[0]
    return pd.Series(out, name="tema")


def historial_tema(filas: pd.DataFrame, elegibles: pd.DataFrame, tema_vot: pd.Series) -> pd.DataFrame:
    """Conteos A/N/AB del legislador en votaciones del MISMO tema con fecha_local < límite
    predictivo de la sesión (estricto). `filas` trae legislador_id, tema, limite_predictivo_sesion."""
    e = elegibles[elegibles.voto_resuelto.isin(["AFIRMATIVO", "NEGATIVO", "ABSTENCION"])].copy()
    e["tema"] = e.votacion_id.map(tema_vot)
    e = e.dropna(subset=["tema"])
    e["f"] = pd.to_datetime(e.fecha_local)
    for k, c in (("tA", "AFIRMATIVO"), ("tN", "NEGATIVO"), ("tAB", "ABSTENCION")):
        e[k] = (e.voto_resuelto == c).astype(int)
    agg = e.groupby(["legislador_id", "tema", "f"])[["tA", "tN", "tAB"]].sum().reset_index().sort_values("f")
    agg[["tA", "tN", "tAB"]] = agg.groupby(["legislador_id", "tema"])[["tA", "tN", "tAB"]].cumsum()

    q = filas[["legislador_id", "tema", "limite_predictivo_sesion"]].copy()
    q["f"] = pd.to_datetime(q.limite_predictivo_sesion)
    q["_i"] = np.arange(len(q))
    q = q.sort_values("f")
    m = pd.merge_asof(q, agg, on="f", by=["legislador_id", "tema"], direction="backward", allow_exact_matches=False)
    m = m.sort_values("_i")
    return m[["tA", "tN", "tAB"]].fillna(0).astype(int).set_index(filas.index)


# ---------------------------------------------------------------- features por fila


def features_sesion(df: pd.DataFrame, tabla: pd.DataFrame, tema_hist: pd.DataFrame | None = None) -> pd.DataFrame:
    """Agrega a `df` (con contexto al inicio: bloque_inicio, signo_inicio, gobierno_inicio) los
    rasgos de proyecto. Las columnas *_fecha_regla / interbloque_desde quedan para el test."""
    t = tabla.set_index("expediente")
    out = df.copy()
    e = out.expediente
    for c in ("origen_expediente", "origen_autor", "tema", "autor_cruce_estado", "autor_persona_id",
              "autor_bloque_publicacion", "gobierno_publicacion", "publicacion_fecha"):
        out[c] = e.map(t[c]).fillna(DESCONOCIDO).values
    fecha_ses = pd.to_datetime(out.fecha_inicio_sesion.str[:10])
    d_1 = fecha_ses - pd.Timedelta(days=1)
    # Proyecto presentado después de D-1 (p. ej. sobre tablas el mismo día): no hay features
    # de proyecto para esa fila. Se marca DESCONOCIDO, sin rellenar.
    pub = pd.to_datetime(out.publicacion_fecha, errors="coerce")
    out["proyecto_disponible"] = (pub <= d_1).values
    nd = ~out.proyecto_disponible
    for c in ("origen_expediente", "origen_autor", "tema", "autor_cruce_estado", "autor_bloque_publicacion", "gobierno_publicacion"):
        out.loc[nd, c] = DESCONOCIDO
    out.loc[nd, "autor_persona_id"] = ""
    if tema_hist is not None:
        tema_hist = tema_hist.copy()
        tema_hist.loc[nd.values] = 0
    es_dip = out.origen_autor.eq("DIPUTADO")
    bloque_autor_ok = es_dip & ~out.autor_bloque_publicacion.isin([DESCONOCIDO, NO_APLICA])

    # (b) signo del autor a la fecha de publicación (regla bloque × gobierno de la publicación)
    s_pub = signo_regla(out.autor_bloque_publicacion, out.gobierno_publicacion, fecha_ses)
    out["signo_autor_publicacion"] = np.where(bloque_autor_ok, s_pub.signo.values,
                                              np.where(es_dip, DESCONOCIDO, NO_APLICA))
    out["signo_autor_fecha_regla"] = s_pub.fecha_regla.where(bloque_autor_ok.values).values

    # (c) alineación con el gobierno vigente en D-1
    s_ses = signo_regla(out.autor_bloque_publicacion, out.gobierno_inicio, fecha_ses)
    ejec = out.origen_autor.eq("EJECUTIVO")
    gob_doc = ~out.gobierno_publicacion.isin(["PREVIO_2011_NO_DOCUMENTADO", DESCONOCIDO])
    alin = np.select(
        [ejec & gob_doc & (out.gobierno_publicacion == out.gobierno_inicio), ejec & gob_doc, ejec,
         bloque_autor_ok, es_dip],
        ["EJECUTIVO_VIGENTE", "EJECUTIVO_ANTERIOR", "EJECUTIVO_NO_DOCUMENTADO",
         "DIPUTADO_" + s_ses.signo.values, "DIPUTADO_DESCONOCIDO"],
        default=out.origen_autor.values,
    )
    out["alineacion_gobierno_sesion"] = alin
    out["alineacion_fecha_regla"] = s_ses.fecha_regla.where(bloque_autor_ok.values).values

    # Agrupaciones más estables que el nombre del bloque
    fam = familias()
    out["familia_inicio"] = out.bloque_inicio.map(lambda b: fam.get(b, b))
    ib = interbloques()
    out["interbloque_inicio"] = "SIN_INTERBLOQUE_DOCUMENTADO"
    out["interbloque_desde"] = pd.NaT
    for r in ib.itertuples():
        m = (out.bloque_inicio == r.b) & (d_1 >= r.desde) & (d_1 <= r.hasta)
        out.loc[m, "interbloque_inicio"] = r.interbloque
        out.loc[m, "interbloque_desde"] = r.desde
    out["familia_autor"] = out.autor_bloque_publicacion.map(lambda b: fam.get(b, b))

    # (d) interacciones con el diputado
    out["x_alin_signo"] = out.alineacion_gobierno_sesion + "|" + out.signo_inicio
    out["x_alin_bloque"] = out.alineacion_gobierno_sesion + "|" + out.bloque_inicio
    out["x_alin_familia"] = out.alineacion_gobierno_sesion + "|" + out.familia_inicio
    out["mismo_bloque_autor"] = (bloque_autor_ok & (out.bloque_inicio == out.autor_bloque_publicacion)).astype(int)
    out["misma_familia_autor"] = (bloque_autor_ok & (out.familia_inicio == out.familia_autor)).astype(int)
    out["x_tema_signo"] = out.tema + "|" + out.signo_inicio

    # (e) es_autor: SI / NO / DESCONOCIDO (DUDOSO o sin cruce no se convierten en 0)
    leg = consulta("select legislador_id, persona_id from legisladores")
    pers = out.legislador_id.map(dict(zip(leg.legislador_id, leg.persona_id)))
    seguro = out.autor_cruce_estado.eq("SEGURO")
    out["es_autor"] = np.select(
        [seguro & (pers == out.autor_persona_id), seguro, ~es_dip],
        ["SI", "NO", "NO"], default=DESCONOCIDO,
    )
    out["es_autor_si"] = (out.es_autor == "SI").astype(int)
    out["es_autor_desconocido"] = (out.es_autor == DESCONOCIDO).astype(int)

    if tema_hist is not None:
        out[["tA", "tN", "tAB"]] = tema_hist.values
    return out
