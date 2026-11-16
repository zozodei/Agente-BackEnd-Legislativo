"""Calibración post-hoc, umbral de decisión y ECE. Todo se AJUSTA sólo con predicciones
out-of-fold (OOF) del rolling origin dentro de ENTRENAMIENTO; validación sólo se transforma.

- Temperatura: p_k ∝ p_k^(1/T), un único T que minimiza la log loss OOF.
- Isotónica: una regresión isotónica por clase (uno contra el resto) y renormalización.
- Umbral: regla de decisión argmax_k (w_k · p_k) con pesos por clase (w_AFIRM = 1). Equivale a
  bajar el umbral de las clases minoritarias sin tocar las probabilidades ni el entrenamiento.
"""

from __future__ import annotations

import itertools

import numpy as np
from scipy.optimize import minimize_scalar
from sklearn.isotonic import IsotonicRegression

EPS = 1e-6


def log_loss(y, P):
    return float(-np.mean(np.log(np.clip(P[np.arange(len(y)), y], 1e-12, 1))))


class SinCalibrar:
    nombre = "sin_calibrar"

    def fit(self, P, y):
        return self

    def transform(self, P):
        return P


class Temperatura:
    nombre = "temperatura"

    def fit(self, P, y):
        L = np.log(np.clip(P, EPS, 1))

        def f(t):
            return log_loss(y, _softmax(L / t))

        self.T = float(minimize_scalar(f, bounds=(0.2, 5.0), method="bounded").x)
        return self

    def transform(self, P):
        return _softmax(np.log(np.clip(P, EPS, 1)) / self.T)


class Isotonica:
    nombre = "isotonica"

    def fit(self, P, y):
        self.iso = []
        for k in range(P.shape[1]):
            r = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip")
            r.fit(P[:, k], (y == k).astype(float))
            self.iso.append(r)
        return self

    def transform(self, P):
        Q = np.column_stack([r.predict(P[:, k]) for k, r in enumerate(self.iso)])
        Q = np.clip(Q, EPS, 1)
        return Q / Q.sum(axis=1, keepdims=True)


CALIBRADORES = {"sin_calibrar": SinCalibrar, "temperatura": Temperatura, "isotonica": Isotonica}


def _softmax(L):
    L = L - L.max(axis=1, keepdims=True)
    E = np.exp(L)
    return E / E.sum(axis=1, keepdims=True)


def elegir_calibrador(oof: list[tuple[int, np.ndarray, np.ndarray]]) -> tuple[str, dict]:
    """Rolling sobre los folds OOF (ordenados por año): el calibrador se ajusta con los folds
    ANTERIORES y se evalúa en el siguiente. Devuelve el de menor log loss medio."""
    oof = sorted(oof, key=lambda x: x[0])
    res = {k: [] for k in CALIBRADORES}
    for i in range(1, len(oof)):
        P_tr = np.vstack([o[1] for o in oof[:i]])
        y_tr = np.concatenate([o[2] for o in oof[:i]])
        _, P_te, y_te = oof[i]
        for k, cls in CALIBRADORES.items():
            res[k].append(log_loss(y_te, cls().fit(P_tr, y_tr).transform(P_te)))
    medias = {k: float(np.mean(v)) for k, v in res.items()}
    return min(medias, key=medias.get), {"medias": medias, "por_fold": res}


def predecir_con_pesos(P, w):
    return (P * np.asarray(w)[None, :]).argmax(axis=1)


def f1_macro(y, pred, K):
    f = []
    for k in range(K):
        tp = np.sum((y == k) & (pred == k))
        d = np.sum(y == k) + np.sum(pred == k)
        if d:
            f.append(2 * tp / d)
    return float(np.mean(f))


def elegir_pesos(P, y, grillas=None) -> tuple[list[float], float]:
    """Pesos por clase (la primera fija en 1) que maximizan F1 macro en OOF."""
    K = P.shape[1]
    if grillas is None:
        grillas = [np.round(np.arange(1, 4.01, 0.25), 2)] + [np.array([1, 1.5, 2, 3, 5, 8, 12, 20])] * (K - 2)
    mejor, mf = [1.0] * K, f1_macro(y, P.argmax(axis=1), K)
    for ws in itertools.product(*grillas):
        w = [1.0, *ws]
        f = f1_macro(y, predecir_con_pesos(P, w), K)
        if f > mf + 1e-9:
            mejor, mf = w, f
    return [float(x) for x in mejor], mf


def ece_por_clase(y, P, bins=10) -> list[float]:
    """ECE uno contra el resto por clase, bins de ancho fijo."""
    out = []
    for k in range(P.shape[1]):
        p, o = P[:, k], (y == k).astype(float)
        b = np.minimum((p * bins).astype(int), bins - 1)
        e = 0.0
        for j in range(bins):
            m = b == j
            if m.any():
                e += m.mean() * abs(p[m].mean() - o[m].mean())
        out.append(float(e))
    return out


def curva_calibracion(y, P, k, bins=10):
    p, o = P[:, k], (y == k).astype(float)
    b = np.minimum((p * bins).astype(int), bins - 1)
    filas = []
    for j in range(bins):
        m = b == j
        if m.sum() >= 20:
            filas.append((float(p[m].mean()), float(o[m].mean()), int(m.sum())))
    return filas
