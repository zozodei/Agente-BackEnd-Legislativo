"""Etapa 5b · Reporte: modelos con texto (limpio) contra solo_tema, B1 y B2.

Protocolo de 4c y 5: bootstrap 90 % por votación (1000 remuestreos), pareado contra solo_tema,
rolling origin (OOF de ENTRENAMIENTO, folds 2014–2020) y validación 2023–2024.

Evaluación SOLO en votaciones con texto real (fuente = "texto"). Las votaciones que sólo tienen
título entran como vecinos y como objetivos de las features, pero no se usan para decidir.
Acierto por diputado en rolling origin (OOF por fila) y en validación.

B1 y B2 con espacio político unificado y vecinos sólo "en general". Control de vecinos para Ley
Bases, armas y la dividida con más error de solo_tema.

Uso: .venv\\Scripts\\python -I scripts\\05b_reporte.py
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML / "src"))
sys.stdout.reconfigure(encoding="utf-8")

from poroteo import rutas  # noqa: E402
from poroteo.carga import leer_dataset  # noqa: E402
from poroteo.features import agregar_contexto  # noqa: E402
from poroteo.texto import normalizar  # noqa: E402

D = rutas.RAIZ / "derivados"
CL3 = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION"]
BASE = "solo_tema"
MODELOS = ["solo_tema", "solo_tema_texto", "con_autor", "con_autor_texto"]
ANIOS_RO = range(2014, 2021)
B = 1000
N_DIV = 100
rng = np.random.default_rng(20261201)
CTRL = {"Ley Bases": "HCDN_ACTA_5101", "armas": "HCDN_ACTA_5385"}

el = json.load(open(D / "05_modo_elegido.json", encoding="utf-8"))
MODO, K = el["modo"], el["K"]

_spec = importlib.util.spec_from_file_location("t5", ML / "scripts" / "05_texto.py")
T5 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T5)


def ic90(x):
    return float(np.percentile(x, 5)), float(np.percentile(x, 95))


def boot_idx(n):
    return rng.integers(0, n, size=(B, n))


def f1_desde_confusion(cm):
    tp = np.diag(cm).astype(float)
    prec = tp / np.maximum(cm.sum(0), 1)
    rec = tp / np.maximum(cm.sum(1), 1)
    f1 = np.where(prec + rec > 0, 2 * prec * rec / np.maximum(prec + rec, 1e-12), 0)
    return f1.mean()


# ---------------------------------------------------------------- conjuntos de votaciones con texto real

tv = pd.read_csv(D / f"05_textos_{MODO}.csv", dtype=str, keep_default_na=False)
CON_TEXTO = set(tv[tv.fuente_texto == "texto"].votacion_id)
vt = pd.read_csv(D / "04_votaciones_validacion.csv")
VAL_IDS = sorted(set(vt[vt.modelo == BASE].votacion_id) & CON_TEXTO)

oof_base = pd.read_csv(D / "04_oof_filas_solo_tema.csv")
anio_vot = oof_base.groupby("votacion_id").anio.first()
RO_IDS = sorted(v for v in anio_vot.index if anio_vot[v] in ANIOS_RO and v in CON_TEXTO)


# ---------------------------------------------------------------- métricas de modelos

def por_votacion_val(v, ids):
    t = vt[vt.modelo == v].set_index("votacion_id").sort_index()
    p = pd.read_csv(D / f"04_predicciones_validacion_{v}.csv")
    p = p[p.votacion_id.isin(ids) & p.real4.isin(CL3)].copy()
    return _por_votacion(p, t, pcols=[f"p_{c}" for c in CL3], ycol="real4")


def por_votacion_ro(v, ids):
    o = pd.read_csv(D / f"04_oof_filas_{v}.csv")
    o = o[o.votacion_id.isin(ids)].copy()
    t = pd.read_csv(D / f"04_oof_votaciones_{v}.csv").set_index("votacion_id").sort_index()
    o["real4"] = o.y.map({i: c for i, c in enumerate(CL3)})
    return _por_votacion(o, t, pcols=[f"p_{c}" for c in CL3], ycol="real4")


def _por_votacion(p, t, pcols, ycol):
    Q = p[pcols].div(p[pcols].sum(1), axis=0).values
    y = p[ycol].map({c: i for i, c in enumerate(CL3)}).values.astype(int)
    p = p.assign(ll=-np.log(np.clip(Q[np.arange(len(y)), y], 1e-15, 1)), ok=(Q.argmax(1) == y).astype(float))
    g = p.groupby("votacion_id")
    ids_v = sorted(g.size().index)
    return pd.DataFrame({
        "ll_sum": g.ll.sum().reindex(ids_v), "ll_n": g.ll.size().reindex(ids_v),
        "acierto_sum": g.ok.sum().reindex(ids_v), "acierto_n": g.ok.size().reindex(ids_v),
        "neg_total": (t.esp_NEGATIVO - t.of_N).abs().reindex(ids_v).values,
        "margen_total": ((t.esp_AFIRMATIVO - t.esp_NEGATIVO) - (t.of_A - t.of_N)).abs().reindex(ids_v).values,
        "divid": (t.margen_oficial < N_DIV).reindex(ids_v).values,
    }, index=ids_v)


VAL = {v: por_votacion_val(v, VAL_IDS) for v in MODELOS}
RO = {v: por_votacion_ro(v, RO_IDS) for v in MODELOS}
vids_val = sorted(set.intersection(*[set(VAL[v].index) for v in MODELOS]))
vids_ro = sorted(set.intersection(*[set(RO[v].index) for v in MODELOS]))
for v in MODELOS:
    VAL[v], RO[v] = VAL[v].loc[vids_val], RO[v].loc[vids_ro]


# ---------------------------------------------------------------- B1 y B2

pool = T5.votos_pool()  # bloque ya en espacio político, sólo votaciones elegibles
votos_por_vid = {vid: g.drop_duplicates("legislador_id").set_index("legislador_id")[["cls", "bloque"]]
                 for vid, g in pool.groupby("votacion_id")}


def mayorias(vid):
    V = votos_por_vid[vid]
    pres = V[V.cls.isin(CL3)]
    mayor = {}
    for b, grp in pres.groupby("bloque"):
        c = grp.cls.value_counts()
        if len(c) == 1 or c.iloc[0] > c.iloc[1]:
            mayor[b] = c.index[0]
    return mayor


MAYOR = {vid: mayorias(vid) for vid in votos_por_vid}
VEC = pd.read_csv(D / f"05_vecinos_{MODO}.csv")
VEC = VEC[VEC["rank"] <= K].sort_values(["votacion_id", "rank"])
VEC = {t: list(g.vecino_votacion_id) for t, g in VEC.groupby("votacion_id")}


def roster_de(ids, anios=None):
    r = leer_dataset("general", ["votacion_id", "legislador_id", "fecha_inicio_sesion", "objetivo_voto", "split"])
    r = r[r.votacion_id.isin(set(ids))]
    r = agregar_contexto(r).drop_duplicates(["votacion_id", "legislador_id"])
    r["bloque_inicio"] = r.bloque_inicio.fillna("NA").map(lambda b: T5.espacio(normalizar(b)))
    return r


def predecir_b(t, grp):
    b1, b2 = [], []
    for legis, bloque in zip(grp.legislador_id.values, grp.bloque_inicio.values):
        p1 = None
        for vid in VEC.get(t, []):
            c = MAYOR.get(vid, {}).get(bloque)
            if c is not None:
                p1 = c
                break
        if p1 is None:
            p1 = "AFIRMATIVO"  # sin vecino con mayoría en ese espacio: se cuenta como fallback
        p2 = None
        for vid in VEC.get(t, []):
            V = votos_por_vid.get(vid)
            if V is not None and legis in V.index and V.cls.get(legis) in CL3:
                p2 = V.cls.get(legis)
                break
        b1.append(p1)
        b2.append(p2 if p2 is not None else p1)
    return b1, b2


def baselines(ids):
    r = roster_de(ids)
    partes = []
    for t, grp in r.groupby("votacion_id"):
        b1, b2 = predecir_b(t, grp)
        partes.append(grp.assign(b1=b1, b2=b2))
    return pd.concat(partes, ignore_index=True)


def metricas_b(RB_ALL, ids, of_src):
    RB = RB_ALL[RB_ALL.objetivo_voto.isin(CL3)]
    out = {}
    of = of_src.set_index("votacion_id")
    for col, nombre in (("b1", "B1"), ("b2", "B2")):
        g = RB.assign(ok=(RB[col] == RB.objetivo_voto).astype(float)).groupby("votacion_id")
        neg = RB_ALL.assign(n=(RB_ALL[col] == "NEGATIVO")).groupby("votacion_id").n.sum()
        idx = sorted(set(ids) & set(g.size().index))
        out[nombre] = pd.DataFrame({
            "acierto_sum": g.ok.sum().reindex(idx), "acierto_n": g.size().reindex(idx),
            "neg_total": (neg.reindex(idx) - of.of_N.reindex(idx)).abs(),
            "divid": of.margen_oficial.reindex(idx) < N_DIV,
        }, index=idx)
    return out


RB_VAL = baselines(VAL_IDS)
RB_RO = baselines(RO_IDS)
BVAL = metricas_b(RB_VAL, VAL_IDS, vt[vt.modelo == BASE])
oof_v = pd.read_csv(D / "04_oof_votaciones_solo_tema.csv")
BRO = metricas_b(RB_RO, RO_IDS, oof_v)
BVAL = {k: v.loc[vids_val] for k, v in BVAL.items()}
BRO = {k: v.loc[vids_ro] for k, v in BRO.items()}


# ---------------------------------------------------------------- estadísticas

def fila_tabla(m, es_modelo):
    idx = boot_idx(len(m))
    out = {}
    if es_modelo:
        out["Log loss voto (B)"] = (float(m.ll_sum.sum() / m.ll_n.sum()),
                                    ic90(m.ll_sum.values[idx].sum(1) / m.ll_n.values[idx].sum(1)))
    out["Acierto por diputado"] = (float(m.acierto_sum.sum() / m.acierto_n.sum()),
                                   ic90(m.acierto_sum.values[idx].sum(1) / m.acierto_n.values[idx].sum(1)))
    dv = np.asarray(m.divid.values, bool)
    if dv.sum() > 0:
        bi = boot_idx(dv.sum())
        out["Acierto en divididas"] = (float(m.acierto_sum[dv].sum() / m.acierto_n[dv].sum()),
                                       ic90(m.acierto_sum.values[dv][bi].sum(1) / m.acierto_n.values[dv][bi].sum(1)))
    x = m.neg_total.values
    out["EA neg. Σp total"] = (float(x.mean()), ic90(x[boot_idx(len(x))].mean(1)))
    return out


def pareada(a, r, es_modelo):
    idx = boot_idx(len(a))
    out = {}
    if es_modelo:
        out["Log loss voto (B)"] = (float(a.ll_sum.sum() / a.ll_n.sum() - r.ll_sum.sum() / r.ll_n.sum()), ic90(
            (a.ll_sum.values[idx].sum(1) / a.ll_n.values[idx].sum(1)) - (r.ll_sum.values[idx].sum(1) / r.ll_n.values[idx].sum(1))))
    da = a.acierto_sum.values / a.acierto_n.values - r.acierto_sum.values / r.acierto_n.values
    out["Acierto por diputado"] = (float(da.mean()), ic90(da[idx].mean(1)))
    dd = a.neg_total.values - r.neg_total.values
    out["EA neg. Σp total"] = (float(dd.mean()), ic90(dd[idx].mean(1)))
    return out


res = {"modo": MODO, "K": K, "n_val_texto": len(vids_val), "n_ro_texto": len(vids_ro)}
res["val_tabla"] = [dict(variante=v, **fila_tabla(VAL[v], True)) for v in MODELOS]
res["val_tabla"] += [dict(variante=k, **fila_tabla(BVAL[k], False)) for k in ("B1", "B2")]
res["ro_tabla"] = [dict(variante=v, **fila_tabla(RO[v], True)) for v in MODELOS]
res["ro_tabla"] += [dict(variante=k, **fila_tabla(BRO[k], False)) for k in ("B1", "B2")]
res["val_vs_solo"] = {v: pareada(VAL[v], VAL[BASE], True) for v in MODELOS if v != BASE}
res["ro_vs_solo"] = {v: pareada(RO[v], RO[BASE], True) for v in MODELOS if v != BASE}
res["val_vs_B"] = {f"{v} vs {k}": pareada(VAL[v], BVAL[k], False) for v in MODELOS for k in ("B1", "B2")}
res["ro_vs_B"] = {f"{v} vs {k}": pareada(RO[v], BRO[k], False) for v in MODELOS for k in ("B1", "B2")}


def imprimir(titulo, filas):
    print(f"\n{titulo}")
    for f in filas:
        print(" ", f["variante"])
        for k, val_ in f.items():
            if k != "variante":
                est, (lo, hi) = val_
                print(f"    {k}: {est:.3f} [{lo:.3f}, {hi:.3f}]")


print(f"modo={MODO} K={K} · validación con texto: {len(vids_val)} · RO con texto (2014–2020): {len(vids_ro)}")
imprimir("VALIDACIÓN (2023–2024)", res["val_tabla"])
imprimir("ROLLING ORIGIN (2014–2020, OOF)", res["ro_tabla"])
for titulo, clave in (("VAL pareadas vs solo_tema", "val_vs_solo"), ("RO pareadas vs solo_tema", "ro_vs_solo"),
                      ("VAL vs B1/B2", "val_vs_B"), ("RO vs B1/B2", "ro_vs_B")):
    print(f"\n{titulo}:")
    for v, dct in res[clave].items():
        for k, (est, (lo, hi)) in dct.items():
            print(f"  {v} · {k}: {est:+.3f} [{lo:+.3f}, {hi:+.3f}]")


# ---------------------------------------------------------------- control de vecinos

def control():
    out = {}
    base_v = VAL[BASE]
    div = base_v[base_v.divid.astype(bool)]
    refs = dict(CTRL)
    if len(div):
        refs["dividida con más error"] = (div.neg_total).idxmax()
    tit = pd.read_csv(D / f"05_textos_{MODO}.csv", dtype=str, keep_default_na=False).set_index("votacion_id").titulo
    vec_full = pd.read_csv(D / f"05_vecinos_{MODO}.csv")
    pred_txt = pd.read_csv(D / "04_predicciones_validacion_solo_tema_texto.csv")
    for nombre, vid in refs.items():
        vv = vec_full[(vec_full.votacion_id == vid) & (vec_full["rank"] <= 5)].sort_values("rank")
        vecs = [{"votacion": r.vecino_votacion_id, "fecha": r.fecha_vecino, "sim": float(r.similitud),
                 "titulo": str(r.titulo_vecino)[:150], "fuente": r.fuente_texto_vecino} for r in vv.itertuples()]
        r_ = roster_de([vid])
        b_ = baselines([vid]) if vid in set(r_.votacion_id) else None
        bl = []
        p_ = pred_txt[pred_txt.votacion_id == vid].copy()
        p_["bloque"] = p_.bloque_inicio.fillna("NA").map(lambda b: T5.espacio(normalizar(b)))
        for etiqueta, nb in (("PRO", "PRO"), ("UCR", "UCR"), ("LLA", "LA LIBERTAD AVANZA"), ("UxP", "PERONISMO")):
            if b_ is None:
                break
            g = b_[(b_.bloque_inicio == T5.espacio(normalizar(nb))) & b_.objetivo_voto.isin(CL3)]
            real = g.objetivo_voto.value_counts().to_dict()
            pb1 = g.b1.value_counts().to_dict()
            pb2 = g.b2.value_counts().to_dict()
            pt = p_[(p_.bloque == T5.espacio(normalizar(nb))) & p_.real4.isin(CL3 + ["AUSENTE"])]
            esp = {c: round(float(pt[f"p_{c}"].sum()), 1) for c in CL3}
            bl.append({"bloque": etiqueta, "real": {c: int(real.get(c, 0)) for c in CL3},
                       "texto_sum_p": esp, "B1": {c: int(pb1.get(c, 0)) for c in CL3}, "B2": {c: int(pb2.get(c, 0)) for c in CL3}})
        out[nombre] = {"votacion": vid, "titulo": str(tit.get(vid, ""))[:200], "vecinos_top5": vecs, "por_bloque": bl}
    return out


res["control"] = control()
for nombre, c in res["control"].items():
    print(f"\n== {nombre}: {c['votacion']} · {c['titulo'][:120]}")
    for v in c["vecinos_top5"]:
        print(f"   {v['votacion']} · {v['fecha']} · sim {v['sim']:.3f} [{v['fuente']}] · {v['titulo'][:100]}")
    for b in c["por_bloque"]:
        print(f"   {b['bloque']}: real {b['real']} · texto Σp {b['texto_sum_p']} · B1 {b['B1']} · B2 {b['B2']}")


def _json(o):
    if isinstance(o, (list, tuple)):
        return [_json(x) for x in o]
    if isinstance(o, dict):
        return {str(k): _json(v) for k, v in o.items()}
    if isinstance(o, (np.floating, float)):
        return float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


json.dump(_json(res), open(D / "05b_resultados.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("\nGuardado en", D / "05b_resultados.json")
