"""Etapa 5 (y 5b) · Proyectos parecidos del pasado y cómo votó cada diputado en ellos.

Todo local: ningún texto del dataset sale del equipo. Los embeddings se calculan con un modelo
descargado una vez y corren en CPU.

  1. Texto por votación (sólo lo que existía antes de votar):
       - título del proyecto (proyectos / proyectos_de_ley vía proyectos_features.csv)
       - texto original del proyecto (documentos_proyectos, tipos PROYECTO_ORIGINAL_* o sin tipo)
       - fundamentos del proyecto original (sólo en modo limpio_fund)
     Sin texto → se usa sólo el título (fuente = "titulo"). Sin título ni texto → fuera.
  2. Limpieza: se corta la nota de elevación del Poder Ejecutivo (todo lo previo a la fórmula de
     sanción o al primer artículo), la fórmula de sanción, "Artículo N°", "Comuníquese al Poder
     Ejecutivo" y stopwords comunes y legales.
  3. Espacio político (bloques entre épocas): el nombre viejo y el nuevo de un mismo bloque se
     unen con `familia_politica_literal` (poroteo.proyectos.familias) y, además, el peronismo
     (FRENTE PARA LA VICTORIA, FRENTE DE TODOS, UNION POR LA PATRIA) como un solo espacio.
  4. Similitud: TF-IDF (palabras 1–2 + caracteres 3–5), un vectorizador por año objetivo ajustado
     sólo con textos de años anteriores (2023 en adelante: sólo ENTRENAMIENTO). O embeddings
     multilingües (modo emb), que no se ajustan con datos.
  5. Vecinos: votaciones "en general" con texto (o título) y fecha ESTRICTAMENTE anterior a la
     sesión. Se guardan los 20 primeros.
  6. Features por (votación, diputado), ponderadas por similitud.

Uso: .venv\\Scripts\\python -I scripts\\05_texto.py --modo limpio --ks 20
"""

from __future__ import annotations

# torch debe cargarse antes que numpy/scipy/sklearn en Windows (conflicto de DLL); sólo se usa en modo emb.
try:
    import torch  # noqa: F401
except Exception:  # noqa: BLE001
    torch = None

import argparse
import re
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.stdout.reconfigure(encoding="utf-8")

from poroteo import rutas  # noqa: E402
from poroteo.carga import leer_dataset  # noqa: E402
from poroteo.features import _gobiernos, agregar_contexto  # noqa: E402
from poroteo.proyectos import familias, votos_elegibles  # noqa: E402
from poroteo.texto import normalizar  # noqa: E402

DERIV = rutas.RAIZ / "derivados"
TABLAS = rutas.TABLAS
LAM = 2.0  # suavizado hacia el prior del bloque
CL3 = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION"]
K_MAX = 20
MAX_CHARS = 20000
TIPOS_OK = ("PROYECTO_ORIGINAL_PDF", "PROYECTO_ORIGINAL_HTML", "proyecto_original_no_necesariamente_version_votada", "")
ESTADOS_EXCLUIDOS = ("recuperado_ocr_spa_pendiente_revision",)
PERONISMO = {"FRENTE PARA LA VICTORIA - PJ", "FRENTE DE TODOS", "UNION POR LA PATRIA"}
MODOS = ("limpio", "limpio3000", "limpio_fund", "emb")
COLS_FEAT = ["txt_own_A", "txt_own_N", "txt_own_AB", "txt_own_n", "txt_own_neff",
             "txt_bmaj_A", "txt_bmaj_N", "txt_bmaj_AB", "txt_bmaj_n_abs",
             "txt_rebeld", "txt_gob_A", "txt_gob_N", "txt_gob_AB", "txt_gob_n",
             "txt_sim_max", "txt_sim_mean", "txt_sin_texto"]

# Stopwords comunes (español, sin tildes) y legales/procedimentales. Se quitan del texto.
STOPWORDS = set("""
A AL ANTE BAJO CADA CON CONTRA DE DEL DESDE DURANTE EL ELLA ELLAS ELLO ELLOS EN ENTRE ES ESA ESAS ESE ESO
ESOS ESTA ESTAS ESTE ESTOS FUE FUERON HACIA HASTA LA LAS LE LES LO LOS MEDIANTE MI MIS MUY NO NOS O
PARA PERO POR QUE QUIEN SE SEGUN SER SI SIN SOBRE SON SU SUS TAMBIEN TE TODO TODOS TODA TODAS TU UN UNA
UNAS UNO UNOS Y YA QUE COMO CUANDO DONDE MAS MENOS AQUEL ESTA ESTABA HAY HAN TIENE TIENEN SEA SEAN
SERA SERAN HABRA DEBE DEBEN PUEDE PUEDEN PODRA ASI ADEMAS ETC CUAL CUALES OTRO OTROS OTRA OTRAS MISMO
MISMA MISMOS MISMAS SOLO SOLAMENTE ALGUN ALGUNA ALGUNOS ALGUNAS NINGUN NINGUNA CUYO CUYA CUYOS CUYAS
ARTICULO ARTICULOS LEY LEYES PROYECTO PRESENTE PRESENTES DISPOSICION DISPOSICIONES CONGRESO NACION
ARGENTINA ARGENTINO ARGENTINOS PODER EJECUTIVO CAMARA SENADO DIPUTADOS INCISO INCISOS CAPITULO TITULO
ANEXO DECRETO REGLAMENTARIA REGLAMENTARIO REGLAMENTARIAS REGLAMENTARIOS LEGISLACION NACIONAL NACIONALES
REPUBLICA REUNIDOS SANCIONAN FUERZA
""".split())

FORMULA_SANCION = "SANCIONAN CON FUERZA DE LEY"
MARCAS_INICIO = ("EL SENADO Y CAMARA", "PROYECTO DE LEY", "ARTICULO 1", "TITULO I", "CAPITULO I")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def limpiar(texto_norm: str) -> str:
    """Texto ya normalizado (mayúsculas, sin tildes). Quita nota de elevación, fórmula de sanción,
    numeraciones, cierre 'comuníquese' y stopwords."""
    t = texto_norm
    if FORMULA_SANCION in t:
        t = t[t.index(FORMULA_SANCION) + len(FORMULA_SANCION):]
    else:
        pos = [t.find(m) for m in MARCAS_INICIO if t.find(m) >= 0]
        if pos and min(pos) < 3000:
            t = t[min(pos):]
    t = re.sub(r"COMUNIQUESE AL PODER EJECUTIVO.*$", " ", t)
    t = re.sub(r"ARTICULO\s*(\d+|N)\s*[°º]?\s*[.\-:]*", " ", t)
    t = re.sub(r"\bN\s*[°º]\s*\d+", " ", t)
    t = re.sub(r"[^A-Z0-9 ]", " ", t)
    palabras = [w for w in t.split() if w not in STOPWORDS and not w.isdigit()]
    return " ".join(palabras)


# ---------------------------------------------------------------- 1 · texto por votación

def textos_por_votacion(modo: str) -> pd.DataFrame:
    ve = pd.read_csv(TABLAS / "votacion_expediente.csv", dtype=str, keep_default_na=False)[["votacion_id", "expediente"]]
    pf = pd.read_csv(DERIV / "proyectos_features.csv", dtype=str, keep_default_na=False)[["expediente", "titulo"]]
    d = pd.read_csv(TABLAS / "documentos_proyectos.csv", dtype=str, keep_default_na=False,
                    usecols=["expediente", "tipo_documento", "estado", "texto_original", "fundamentos"])
    d = d[d.tipo_documento.isin(TIPOS_OK) & ~d.estado.isin(ESTADOS_EXCLUIDOS)]
    d = d.assign(n=d.texto_original.str.len()).sort_values("n", ascending=False).drop_duplicates("expediente")
    ex = ve.merge(pf, on="expediente", how="left").merge(
        d[["expediente", "texto_original", "fundamentos"]], on="expediente", how="left")
    for c in ("titulo", "texto_original", "fundamentos"):
        ex[c] = ex[c].fillna("")
    ex["n"] = ex.texto_original.str.len()
    ex["tiene_doc"] = ex.texto_original.str.len() > 0
    ex["tiene_titulo"] = ex.titulo.str.len() > 0
    ex = ex.sort_values(["votacion_id", "tiene_doc", "n"], ascending=[True, False, False])
    out = ex.drop_duplicates("votacion_id")[["votacion_id", "expediente", "titulo", "texto_original", "fundamentos",
                                             "tiene_doc", "tiene_titulo"]].copy()

    def armar(r):
        titulo = normalizar(r.titulo)
        if r.tiene_doc:
            cuerpo = normalizar(r.texto_original)
            if modo == "limpio_fund" and r.fundamentos:
                cuerpo = cuerpo + " " + normalizar(r.fundamentos)
            if modo == "limpio3000":
                cuerpo = limpiar(cuerpo)[:3000]
                return ("texto", limpiar(titulo) + " " + cuerpo)
            return ("texto", (limpiar(titulo) + " " + limpiar(cuerpo))[:MAX_CHARS])
        if r.tiene_titulo:
            return ("titulo", limpiar(titulo))
        return ("nada", "")

    res = [armar(r) for r in out.itertuples()]
    out["fuente_texto"] = [f for f, _ in res]
    out["texto"] = [t for _, t in res]
    out["tiene_texto"] = out.fuente_texto.isin(["texto", "titulo"]) & (out.texto.str.len() > 0)
    return out.drop(columns=["texto_original", "fundamentos"])


# ---------------------------------------------------------------- 2 · votos, espacio político y "en general"

FAM = familias()


def espacio(bloque_norm: str) -> str:
    if bloque_norm in PERONISMO:
        return "PERONISMO"
    return FAM.get(bloque_norm, bloque_norm)


def votos_pool() -> pd.DataFrame:
    e = votos_elegibles()
    v = pd.read_csv(TABLAS / "votos.csv", dtype=str, keep_default_na=False, usecols=["votacion_id", "legislador_id", "bloque"])
    m = e.merge(v, on=["votacion_id", "legislador_id"], how="left")
    m["bloque"] = m.bloque.map(normalizar).map(espacio)
    m["cls"] = np.where(m.voto_resuelto.isin(CL3), m.voto_resuelto, "AUSENTE")
    m["fecha"] = pd.to_datetime(m.fecha_local)
    return m[["votacion_id", "legislador_id", "bloque", "cls", "fecha"]]


def votaciones_en_general() -> set:
    """Votaciones "en general" (incluye 'en general y en particular'). Excluye las de artículos."""
    v = pd.read_csv(TABLAS / "votaciones.csv", dtype=str, keep_default_na=False,
                    usecols=["votacion_id", "tipo_verificado", "tipo_inferido_titulo"])
    ok = v.tipo_verificado.isin(["GENERAL", "GENERAL_Y_PARTICULAR"]) | (
        v.tipo_verificado.eq("SIN_CONFIRMAR") & v.tipo_inferido_titulo.isin(["GENERAL_HEURISTICO", "GENERAL_Y_PARTICULAR_HEURISTICO"]))
    return set(v.loc[ok, "votacion_id"])


# ---------------------------------------------------------------- 3 · similitud

def vectorizadores_para(anio_objetivo: int, pool_t: pd.DataFrame):
    fit = pool_t[pool_t.anio <= 2022] if anio_objetivo >= 2023 else pool_t[pool_t.anio < anio_objetivo]
    if len(fit) < 5:
        return None
    vw = TfidfVectorizer(analyzer="word", ngram_range=(1, 2), sublinear_tf=True, min_df=2)
    vc = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=2)
    vw.fit(fit.texto)
    vc.fit(fit.texto)
    return vw, vc


def matriz_tfidf(vecs, textos):
    vw, vc = vecs
    return (hstack([vw.transform(textos), vc.transform(textos)]) / np.sqrt(2)).tocsr()


def embeddings(textos: list[str]) -> np.ndarray:
    from sentence_transformers import SentenceTransformer  # import tardío: sólo en modo emb
    modelo = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2", device="cpu")
    modelo.max_seq_length = 256
    E = modelo.encode(textos, batch_size=32, normalize_embeddings=True, show_progress_bar=False)
    return np.asarray(E, dtype=np.float32)


# ---------------------------------------------------------------- 4 · features por votación

def gobierno_de(fecha: pd.Timestamp, gob: pd.DataFrame) -> str:
    g = gob[gob.desde <= fecha]
    return g.gobierno_id.iloc[-1] if len(g) else "PREVIO"


def features_votacion(filas_t: pd.DataFrame, vecinos, votos: dict, gob_t: str) -> pd.DataFrame:
    n_d = len(filas_t)
    legisladores = filas_t.legislador_id.values
    if not vecinos:
        M = pd.DataFrame(np.nan, index=range(n_d), columns=COLS_FEAT)
        M["txt_sin_texto"] = 1.0
        return M.assign(legislador_id=legisladores)

    sims = np.array([s for _, s, _ in vecinos])
    gobs = [g for _, _, g in vecinos]
    bmaj = []
    for vid, _, _ in vecinos:
        V = votos[vid]
        pres = V[V.cls.isin(CL3)]
        mayor = {}
        for b, grp in pres.groupby("bloque"):
            c = grp.cls.value_counts()
            if len(c) == 1 or c.iloc[0] > c.iloc[1]:
                mayor[b] = c.index[0]
        bmaj.append(mayor)

    prior_cache = {}

    def prior_de(bloque_t):
        if bloque_t not in prior_cache:
            pb = {c: 0.0 for c in CL3}
            for vid, s, _ in vecinos:
                V = votos[vid]
                m = V[(V.bloque == bloque_t) & V.cls.isin(CL3)]
                for c, n in m.cls.value_counts().items():
                    pb[c] += s * n
            tb = sum(pb.values())
            prior_cache[bloque_t] = {c: (pb[c] / tb if tb > 0 else 1 / 3) for c in CL3}
        return prior_cache[bloque_t]

    filas = []
    for legis, bloque_t in zip(legisladores, filas_t.bloque_inicio.values):
        own = [votos[vid].cls.get(legis) for vid, _, _ in vecinos]
        prior = prior_de(bloque_t)

        def prop(ks):
            cnt = {c: 0.0 for c in CL3}
            cuenta, tot, sw2 = 0, 0.0, 0.0
            for k in ks:
                c = own[k]
                if c in CL3:
                    cnt[c] += sims[k]
                    tot += sims[k]
                    sw2 += sims[k] ** 2
                    cuenta += 1
            pr = {c: (cnt[c] + LAM * prior[c]) / (tot + LAM) for c in CL3}
            neff = tot ** 2 / sw2 if sw2 > 0 else 0.0
            return pr, cuenta, neff

        todos = range(len(vecinos))
        pr, cuenta, neff = prop(todos)
        bm = {c: 0.0 for c in CL3}
        bt, na = 0.0, 0
        for k in todos:
            if own[k] not in CL3:
                c = bmaj[k].get(bloque_t)
                if c is not None:
                    bm[c] += sims[k]
                    bt += sims[k]
                    na += 1
        num = den = 0.0
        for k in todos:
            m = bmaj[k].get(bloque_t)
            if own[k] in CL3 and m is not None:
                den += sims[k]
                num += sims[k] * (own[k] != m)
        pg, cg, _ = prop([k for k in todos if gobs[k] == gob_t])
        filas.append({
            "txt_own_A": pr["AFIRMATIVO"], "txt_own_N": pr["NEGATIVO"], "txt_own_AB": pr["ABSTENCION"],
            "txt_own_n": cuenta, "txt_own_neff": neff,
            "txt_bmaj_A": bm["AFIRMATIVO"] / bt if bt > 0 else np.nan,
            "txt_bmaj_N": bm["NEGATIVO"] / bt if bt > 0 else np.nan,
            "txt_bmaj_AB": bm["ABSTENCION"] / bt if bt > 0 else np.nan,
            "txt_bmaj_n_abs": na,
            "txt_rebeld": num / den if den > 0 else np.nan,
            "txt_gob_A": pg["AFIRMATIVO"], "txt_gob_N": pg["NEGATIVO"], "txt_gob_AB": pg["ABSTENCION"],
            "txt_gob_n": cg,
            "txt_sim_max": float(sims.max()), "txt_sim_mean": float(sims.mean()), "txt_sin_texto": 0.0,
        })
    return pd.DataFrame(filas).assign(legislador_id=legisladores)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modo", choices=MODOS, default="limpio")
    ap.add_argument("--ks", type=int, nargs="+", default=[5, 10, 20])
    args = ap.parse_args()
    modo, KS = args.modo, args.ks
    t0 = time.time()
    DERIV.mkdir(exist_ok=True)
    log(f"modo={modo} · textos…")
    tv = textos_por_votacion(modo)
    fecha_s = pd.read_csv(TABLAS / "votacion_sesion.csv", dtype=str, keep_default_na=False)[["votacion_id", "fecha_inicio_sesion"]]
    tv = tv.merge(fecha_s, on="votacion_id", how="left")
    tv.to_csv(DERIV / f"05_textos_{modo}.csv", index=False)

    gen = pd.concat([leer_dataset(n, ["votacion_id", "legislador_id", "fecha_inicio_sesion", "split"]) for n in ("general", "presencia")])
    gen = gen[gen.split.isin(["ENTRENAMIENTO", "VALIDACION"])].drop_duplicates(["votacion_id", "legislador_id"])
    fila_v = gen.drop_duplicates("votacion_id")[["votacion_id", "split", "fecha_inicio_sesion"]]
    inv = fila_v.merge(tv[["votacion_id", "tiene_texto", "fuente_texto"]], on="votacion_id", how="left")
    inv["tiene_texto"] = inv.tiene_texto.fillna(False).astype(bool)
    inv["anio"] = inv.fecha_inicio_sesion.str[:4].astype(int)
    cob = inv.groupby("anio").agg(votaciones=("votacion_id", "size"), con_texto=("tiene_texto", "sum")).reset_index()
    cob["cobertura"] = (cob.con_texto / cob.votaciones).round(3)
    cob.to_csv(DERIV / f"05_cobertura_{modo}.csv", index=False)
    log("cobertura:\n" + cob.to_string(index=False))

    log("votos, espacio político y votaciones en general…")
    pool = votos_pool()
    en_general = votaciones_en_general()
    fecha_vid = pool.groupby("votacion_id").fecha.first()
    base = tv[tv.tiene_texto].reset_index(drop=True)
    base["fecha_voto"] = base.votacion_id.map(fecha_vid)
    base["anio"] = base.fecha_voto.dt.year
    en_pool = (base.votacion_id.isin(en_general) & base.fecha_voto.notna()).values
    pos = {v: i for i, v in enumerate(base.votacion_id)}
    pool_ids = set(base.votacion_id[en_pool])
    log(f"  pool de vecinos (en general, con texto o título): {len(pool_ids)} votaciones")

    gob_tab = _gobiernos()
    gob_tab["desde"] = pd.to_datetime(gob_tab.desde)
    gob_tab = gob_tab.sort_values("desde")
    gob_vid = {v: gobierno_de(fecha_vid[v], gob_tab) for v in pool_ids}
    votos = {vid: g.drop_duplicates("legislador_id").set_index("legislador_id")[["cls", "bloque"]]
             for vid, g in pool[pool.votacion_id.isin(pool_ids)].groupby("votacion_id")}

    log("similitud y vecinos…")
    targets = inv[inv.tiene_texto].copy()
    vecinos_t, filas_vec = {}, []
    E = embeddings(base.texto.tolist()) if modo == "emb" else None
    for anio in sorted(targets.anio.unique()):
        if modo != "emb":
            # el vectorizador sólo ve textos del pool (en general), con la regla de años de la etapa 5
            vecs = vectorizadores_para(int(anio), base[en_pool])
            if vecs is None:
                continue
            X = matriz_tfidf(vecs, base.texto)
        for r in targets[targets.anio == anio].itertuples():
            if r.votacion_id not in pos:
                continue
            D = pd.to_datetime(r.fecha_inicio_sesion)
            cand = np.where(en_pool & (base.fecha_voto < D).values & (base.votacion_id != r.votacion_id).values)[0]
            if len(cand) == 0:
                continue
            i = pos[r.votacion_id]
            s = E[cand] @ E[i] if modo == "emb" else (X[i] @ X[cand].T).toarray().ravel()
            orden = np.argsort(-s)[:K_MAX]
            vecinos_t[r.votacion_id] = [(base.votacion_id.iloc[cand[j]], float(s[j]), gob_vid[base.votacion_id.iloc[cand[j]]]) for j in orden]
            for rank, j in enumerate(orden, 1):
                c = cand[j]
                filas_vec.append({"votacion_id": r.votacion_id, "rank": rank,
                                  "vecino_votacion_id": base.votacion_id.iloc[c],
                                  "fecha_vecino": base.fecha_voto.iloc[c].date().isoformat(),
                                  "similitud": round(float(s[j]), 4),
                                  "titulo_vecino": base.titulo.iloc[c],
                                  "fuente_texto_vecino": base.fuente_texto.iloc[c],
                                  "anio_votacion": int(anio)})
    pd.DataFrame(filas_vec).to_csv(DERIV / f"05_vecinos_{modo}.csv", index=False)
    log(f"  votaciones con vecinos: {len(vecinos_t)} de {len(targets)} con texto o título")

    log("features por diputado…")
    gen_rows = agregar_contexto(gen)
    gen_rows["bloque_inicio"] = gen_rows.bloque_inicio.map(lambda b: espacio(normalizar(b)) if isinstance(b, str) else b)
    gen_rows["gob_t"] = [gobierno_de(pd.Timestamp(f[:10]), gob_tab) for f in gen_rows.fecha_inicio_sesion]
    gob_t_vot = gen_rows.drop_duplicates("votacion_id").set_index("votacion_id").gob_t
    for K in KS:
        partes = []
        for t, grp in gen_rows.groupby("votacion_id"):
            vec = vecinos_t.get(t, [])[:K]
            ft = features_votacion(grp[["legislador_id", "bloque_inicio"]], vec, votos, gob_t_vot[t])
            partes.append(ft.assign(votacion_id=t))
        F = pd.concat(partes, ignore_index=True)
        F.to_csv(DERIV / f"05_feat_{modo}_K{K}.csv", index=False)
        log(f"  K={K}: {len(F)} filas")
    log(f"Listo en {(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
