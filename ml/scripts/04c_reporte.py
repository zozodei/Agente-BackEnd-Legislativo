"""Etapa 4c · Protocolo de evaluación v2 para las variantes de la etapa 4 y 4b.

- Intervalo bootstrap del 90 % por votación (1000 remuestreos de votaciones).
- Decisión con el promedio de rolling origin (OOF de ENTRENAMIENTO) y la validación 2023–2024.
- Comparación pareada de cada variante contra solo_tema (diferencia y su intervalo).
- Error absoluto en negativos y en el margen (afirmativos − negativos, con Σp), contra totales
  oficiales; total y en divididas (margen oficial < 100). Mismas definiciones que 04_modelos.py.
- F1 macro con umbral (pesos de decisión de la etapa 4), recalculado desde las predicciones.

Sólo usa derivados de 04_modelos.py. PRUEBA no se carga. Salida: derivados/04c_resultados.json.

Uso: .venv\\Scripts\\python -I scripts\\04c_reporte.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.stdout.reconfigure(encoding="utf-8")

from poroteo import calibracion as CAL  # noqa: E402
from poroteo import rutas  # noqa: E402

D = rutas.RAIZ / "derivados"
CL3 = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION"]
CL4 = ["AFIRMATIVO", "NEGATIVO", "ABSTENCION", "AUSENTE"]
VARIANTES = ["solo_tema", "solo_tema_alin", "con_autor", "con_autor_alin"]
BASE = "solo_tema"
B = 1000
N_DIV = 100  # divididas: margen oficial < 100
rng = np.random.default_rng(20261127)


def ic90(x):
    return float(np.percentile(x, 5)), float(np.percentile(x, 95))


def boot_idx(n):
    return rng.integers(0, n, size=(B, n))


# ---------------------------------------------------------------- validación (2023–2024)

votaciones = pd.read_csv(D / "04_votaciones_validacion.csv")
pred = {v: pd.read_csv(D / f"04_predicciones_validacion_{v}.csv") for v in VARIANTES}
metricas = pd.read_pickle(D / "04_metricas_filas.pkl")
pesos = {v: metricas[(metricas.modelo == v) & (metricas.evaluacion == "B_umbral") & (metricas.historial == "movil")].pesos.iloc[0] for v in VARIANTES}


def por_votacion(v):
    """Métricas por votación de la variante v (validación, historial móvil)."""
    t = votaciones[votaciones.modelo == v].set_index("votacion_id").sort_index()
    p = pred[v].copy()
    p["sum3"] = p[[f"p_{c}" for c in CL3]].sum(1)
    # Probabilidad condicional a estar presente = p(voto) / Σ p(voto). Coincide con la salida B calibrada.
    for c in CL3:
        p[f"q_{c}"] = p[f"p_{c}"] / p.sum3
    presentes = p[p.real4.isin(CL3)].copy()
    y = presentes.real4.map({c: i for i, c in enumerate(CL3)}).values.astype(int)
    Q = presentes[[f"q_{c}" for c in CL3]].values
    ll_fila = -np.log(np.clip(Q[np.arange(len(y)), y], 1e-15, 1))
    presentes["ll"] = ll_fila
    pw = CAL.predecir_con_pesos(Q, pesos[v])
    presentes["pw"] = pw
    presentes["y"] = y
    g = presentes.groupby("votacion_id")
    conf = {}
    for vid, gg in g:
        cm = np.zeros((3, 3), int)
        np.add.at(cm, (gg.y.values, gg.pw.values), 1)
        conf[vid] = cm
    out = pd.DataFrame({
        "ll_sum": g.ll.sum(),
        "ll_n": g.ll.size(),
        "neg_total": (t.esp_NEGATIVO - t.of_N).abs(),
        "margen_total": ((t.esp_AFIRMATIVO - t.esp_NEGATIVO) - (t.of_A - t.of_N)).abs(),
        "divid": t.margen_oficial < N_DIV,
    })
    return out, conf


val, conf_val = {}, {}
for v in VARIANTES:
    val[v], conf_val[v] = por_votacion(v)
ids = sorted(set.intersection(*[set(val[v].index) for v in VARIANTES]))
for v in VARIANTES:
    val[v] = val[v].loc[ids]


def f1_desde_confusion(cm):
    """F1 macro de 3 clases a partir de la matriz de confusión (aditiva por votación)."""
    tp = np.diag(cm).astype(float)
    prec = tp / np.maximum(cm.sum(0), 1)
    rec = tp / np.maximum(cm.sum(1), 1)
    f1 = np.where(prec + rec > 0, 2 * prec * rec / np.maximum(prec + rec, 1e-12), 0)
    return f1.mean()


# ---------------------------------------------------------------- rolling origin (ENTRENAMIENTO, OOF)

oof = {}
for v in VARIANTES:
    o = pd.read_csv(D / f"04_oof_votaciones_{v}.csv").set_index("votacion_id")
    oof[v] = pd.DataFrame({
        "neg_total": (o.esp_NEGATIVO - o.of_N).abs(),
        "divid": o.margen_oficial < N_DIV,
    })
oids = sorted(set.intersection(*[set(oof[v].index) for v in VARIANTES]))
for v in VARIANTES:
    oof[v] = oof[v].loc[oids]

elegidos = json.load(open(D / "04_elegidos.json", encoding="utf-8"))["seleccion"]
ro = pd.read_csv(D / "04_rolling_origin.csv")
ro_ll = {}
for v in VARIANTES:
    fam, par = elegidos[f"voto|{v}"]
    s = ro[(ro.objetivo == "voto") & (ro.variante == v) & (ro.familia == fam) & (ro.param.astype(str) == str(par))]
    ro_ll[v] = s.log_loss.values  # una por año de rolling origin


# ---------------------------------------------------------------- estadísticas

def media_boot(x, idx):
    return x[idx].mean(1)


def ratio_boot(s, n, idx):
    """Log loss ponderado por fila: Σ pérdidas / Σ filas sobre las votaciones remuestreadas."""
    return s[idx].sum(1) / n[idx].sum(1)


def tabla_val():
    filas = []
    for v in VARIANTES:
        d, cm = val[v], conf_val[v]
        idx = boot_idx(len(d))
        ll_est = d.ll_sum.sum() / d.ll_n.sum()
        fila = {"variante": v}
        fila["Log loss voto (B)"] = (float(ll_est), ic90(ratio_boot(d.ll_sum.values, d.ll_n.values, idx)))
        for nombre, col, mask in (("EA neg. Σp total", "neg_total", None), ("EA neg. Σp divididas", "neg_total", "divid"),
                                  ("EA margen Σp total", "margen_total", None), ("EA margen Σp divididas", "margen_total", "divid")):
            x = d[col].values
            if mask:
                x = x[d[mask].values]
            bi = boot_idx(len(x))
            fila[nombre] = (float(x.mean()), ic90(media_boot(x, bi)))
        cms = np.stack([cm[k] for k in ids])
        fila["F1 macro con umbral"] = (float(f1_desde_confusion(cms.sum(0))),
                                       ic90(np.array([f1_desde_confusion(cms[i].sum(0)) for i in idx])))
        filas.append(fila)
    return filas


def paired(v, base=BASE):
    """Diferencia pareada v − base con las mismas votaciones remuestreadas."""
    dv, db = val[v], val[base]
    idx = boot_idx(len(ids))
    out = {}
    e_v, e_b = dv.ll_sum.sum() / dv.ll_n.sum(), db.ll_sum.sum() / db.ll_n.sum()
    out["Log loss voto (B)"] = (float(e_v - e_b), ic90(ratio_boot(dv.ll_sum.values, dv.ll_n.values, idx) - ratio_boot(db.ll_sum.values, db.ll_n.values, idx)))
    for nombre, col in (("EA neg. Σp total", "neg_total"), ("EA margen Σp total", "margen_total")):
        d = dv[col].values - db[col].values
        out[nombre] = (float(d.mean()), ic90(media_boot(d, idx)))
    cv_, cb_ = np.stack([conf_val[v][k] for k in ids]), np.stack([conf_val[base][k] for k in ids])
    f1d = f1_desde_confusion(cv_.sum(0)) - f1_desde_confusion(cb_.sum(0))
    bf = np.array([f1_desde_confusion(cv_[i].sum(0)) - f1_desde_confusion(cb_[i].sum(0)) for i in idx])
    out["F1 macro con umbral"] = (float(f1d), ic90(bf))
    return out


def paired_ro(v, base=BASE):
    """Rolling origin: diferencias pareadas por votación OOF (EA neg) y por año (log loss)."""
    a, b = oof[v], oof[base]
    d = a.neg_total.values - b.neg_total.values
    m = (a.divid & b.divid).values
    dd = d[m]
    ll = ro_ll[v] - ro_ll[base]
    return {
        "EA neg. Σp total (OOF)": (float(d.mean()), ic90(media_boot(d, boot_idx(len(d))))),
        "EA neg. Σp divididas (OOF)": (float(dd.mean()), ic90(media_boot(dd, boot_idx(len(dd))))),
        "Log loss voto (RO, por año)": (float(ll.mean()), ic90(media_boot(ll, boot_idx(len(ll))))),
    }


def medias_ro(v):
    return {
        "EA neg. Σp total (OOF)": float(oof[v].neg_total.mean()),
        "EA neg. Σp divididas (OOF)": float(oof[v].neg_total[oof[v].divid].mean()),
        "Log loss voto (RO medio, uncal.)": float(ro_ll[v].mean()),
    }


def ref_ley_bases_armas():
    res = {}
    refs = {"Ley Bases": "HCDN_ACTA_5101", "armas": "HCDN_ACTA_5385"}
    for v in VARIANTES:
        p = pred[v]
        for nombre, vid in refs.items():
            g = p[p.votacion_id == vid]
            for prefijo in ("PRO", "UCR"):
                m = g[g.bloque_inicio.str.startswith(prefijo)]
                res[f"{v} | {nombre} | {prefijo}"] = round(float((m.p_NEGATIVO / m[[f"p_{c}" for c in CL4]].sum(1)).mean()), 3) if len(m) else None
            t = votaciones[(votaciones.modelo == v) & (votaciones.votacion_id == vid)]
            res[f"{v} | {nombre} | resultado predicho"] = t.esp_res.iloc[0] if len(t) else None
    return res


resultados = {
    "validacion_tabla": tabla_val(),
    "pareado_val": {v: paired(v) for v in VARIANTES if v != BASE},
    "pareado_ro": {v: paired_ro(v) for v in VARIANTES if v != BASE},
    "medias_ro": {v: medias_ro(v) for v in VARIANTES},
    "ley_bases_armas": ref_ley_bases_armas(),
    "n_votaciones_val": len(ids),
    "n_votaciones_oof": len(oids),
}

print(f"Votaciones de validación: {len(ids)} · OOF (ENTRENAMIENTO): {len(oids)} · B={B}")
for fila in resultados["validacion_tabla"]:
    print(fila["variante"])
    for k, val_ in fila.items():
        if k != "variante":
            est, (lo, hi) = val_
            print(f"  {k}: {est:.3f} [{lo:.3f}, {hi:.3f}]")
print("\nPareadas vs solo_tema (validación):")
for v, dct in resultados["pareado_val"].items():
    for k, (est, (lo, hi)) in dct.items():
        print(f"  {v} − {BASE} · {k}: {est:+.3f} [{lo:+.3f}, {hi:+.3f}]")
print("\nPareadas vs solo_tema (rolling origin):")
for v, dct in resultados["pareado_ro"].items():
    for k, (est, (lo, hi)) in dct.items():
        print(f"  {v} − {BASE} · {k}: {est:+.3f} [{lo:+.3f}, {hi:+.3f}]")
print("\nMedias de rolling origin:")
for v, dct in resultados["medias_ro"].items():
    print(f"  {v}: " + ", ".join(f"{k}={x:.3f}" for k, x in dct.items()))
print("\nLey Bases y armas:")
for k, x in resultados["ley_bases_armas"].items():
    print(f"  {k}: {x}")


def _json(o):
    if isinstance(o, tuple):
        return [_json(x) for x in o]
    if isinstance(o, list):
        return [_json(x) for x in o]
    if isinstance(o, dict):
        return {str(k): _json(v) for k, v in o.items()}
    if isinstance(o, (np.floating, float)):
        return float(o)
    if isinstance(o, np.integer):
        return int(o)
    return o


json.dump(_json(resultados), open(D / "04c_resultados.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("\nGuardado en", D / "04c_resultados.json")
