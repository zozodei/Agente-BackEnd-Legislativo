"""Baselines de la etapa 2. Todos se ajustan SOLO con el train recibido (fold o
ENTRENAMIENTO completo); priors, vocabularios de categorías y escalas incluidos.

Interfaz: fit(df) / predict_proba(df) → matriz (n, K) en el orden de `clases`.
`df` trae los conteos de historial (columnas A, N, AB, AU) y el contexto al inicio.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .features import DESCONOCIDO, features_historial

CLASES = {"voto": ["AFIRMATIVO", "NEGATIVO", "ABSTENCION"], "presencia": ["AUSENTE", "PRESENTE"]}


def _y(df, objetivo):
    return df["y"].values


def _dist(y, K, peso=None):
    c = np.bincount(y, weights=peso, minlength=K).astype(float) + 1e-3
    return c / c.sum()


def _personal(df: pd.DataFrame, objetivo: str, prior: np.ndarray, alpha: float) -> np.ndarray:
    """Proporciones personales suavizadas hacia un prior por fila (n, K)."""
    if objetivo == "voto":
        cnt = df[["A", "N", "AB"]].values.astype(float)
    else:
        cnt = np.c_[df.AU.values, (df.A + df.N + df.AB).values].astype(float)
    n = cnt.sum(axis=1, keepdims=True)
    return (cnt + alpha * prior) / (n + alpha)


class Constante:
    """(a) Distribución de clases de train para todas las filas (argmax = clase mayoritaria)."""

    nombre = "a_constante"

    def __init__(self, objetivo):
        self.objetivo, self.K = objetivo, len(CLASES[objetivo])

    def fit(self, df):
        self.p = _dist(_y(df, self.objetivo), self.K)
        return self

    def predict_proba(self, df):
        return np.tile(self.p, (len(df), 1))


class Historial:
    """(b) Historial personal suavizado. con_contexto=False: prior global.
    con_contexto=True: prior jerárquico bloque_inicio → signo_inicio → global (arranque en frío
    explícito para diputados sin historial)."""

    def __init__(self, objetivo, alpha=10.0, con_contexto=False, min_n=200):
        self.objetivo, self.alpha, self.ctx, self.min_n = objetivo, alpha, con_contexto, min_n
        self.K = len(CLASES[objetivo])
        self.nombre = "b_historial" + ("_bloque_signo" if con_contexto else "")

    def fit(self, df):
        y = _y(df, self.objetivo)
        self.glob = _dist(y, self.K)
        self.tablas = {}
        if self.ctx:
            for col in ("bloque_inicio", "signo_inicio"):
                t = {}
                for k, idx in df.groupby(col).indices.items():
                    if k != DESCONOCIDO and len(idx) >= self.min_n:
                        t[k] = _dist(y[idx], self.K)
                self.tablas[col] = t
        return self

    def prior_filas(self, df) -> tuple[np.ndarray, np.ndarray]:
        P = np.tile(self.glob, (len(df), 1))
        fuente = np.array(["global"] * len(df), dtype=object)
        if self.ctx:
            for col in ("signo_inicio", "bloque_inicio"):  # bloque pisa a signo si existe
                t = self.tablas[col]
                m = df[col].map(lambda k: k in t).values
                if m.any():
                    P[m] = np.stack([t[k] for k in df[col].values[m]])
                    fuente[m] = col.split("_")[0]
        return P, fuente

    def predict_proba(self, df):
        prior, _ = self.prior_filas(df)
        return _personal(df, self.objetivo, prior, self.alpha)


class Logistica:
    """(c) Regresión logística: historial suavizado (log-proporciones, volumen, flag sin
    historial) + distrito_inicio; con_contexto añade bloque_inicio y signo_inicio."""

    def __init__(self, objetivo, C=0.1, con_contexto=True, alpha=10.0, min_freq=200):
        self.objetivo, self.C, self.ctx, self.alpha, self.min_freq = objetivo, C, con_contexto, alpha, min_freq
        self.K = len(CLASES[objetivo])
        self.nombre = "c_logistica" + ("_bloque_signo" if con_contexto else "_sin_bloque_signo")

    def _X(self, df):
        X = features_historial(df[["A", "N", "AB", "AU"]], self.objetivo, self.prior_h, self.alpha)
        for c in [c for c in X if c.startswith("h_") and c != "h_log_n"]:
            X[c] = np.log(X[c])
        X["distrito_inicio"] = df.distrito_inicio.values
        if self.ctx:
            X["bloque_inicio"] = df.bloque_inicio.values
            X["signo_inicio"] = df.signo_inicio.values
        return X

    def fit(self, df):
        y = _y(df, self.objetivo)
        d = _dist(y, self.K)
        self.prior_h = d if self.objetivo == "voto" else d[1:2]
        X = self._X(df)
        cat = [c for c in ("distrito_inicio", "bloque_inicio", "signo_inicio") if c in X]
        num = [c for c in X if c not in cat]
        pre = ColumnTransformer(
            [
                ("num", StandardScaler(), num),
                ("cat", OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=self.min_freq), cat),
            ]
        )
        self.pipe = Pipeline([("pre", pre), ("lr", LogisticRegression(C=self.C, max_iter=3000))])
        self.pipe.fit(X, y)
        return self

    def predict_proba(self, df):
        P = self.pipe.predict_proba(self._X(df))
        out = np.zeros((len(df), self.K))
        out[:, self.pipe.classes_] = P
        return out


# ---------------------------------------------------------------- etapa 3: features de proyecto

# Grupo → (categóricas, numéricas). "{G}" se reemplaza por la agrupación del diputado
# (bloque_inicio o familia_inicio). Disponibilidad de cada columna: ver poroteo/proyectos.py.
GRUPOS_PROYECTO = {
    "origen": (["origen_expediente", "origen_autor"], []),
    "signo_autor": (["signo_autor_publicacion"], []),
    "alineacion": (["alineacion_gobierno_sesion"], []),
    "inter_signo": (["x_alin_signo"], []),
    "inter_bloque": (["x_alin_{G}"], ["mismo_bloque_autor", "misma_familia_autor"]),
    "es_autor": ([], ["es_autor_si", "es_autor_desconocido"]),
    "tema": (["tema", "x_tema_signo"], []),
    "hist_tema": ([], ["ht_A", "ht_N", "ht_AB", "ht_log_n"]),
    "alin_reciente": ([], ["alin_rec", "alin_rec_log_n"]),  # etapa 4b: alineación reciente bloque ↔ oficialismo
}


class LogisticaProyecto(Logistica):
    """(c) logística con bloque/signo + grupos de features de proyecto.

    agrupacion: "bloque" (como etapa 2), "familia" (familia_politica_literal en lugar del
    nombre del bloque) o "bloque+interbloque" (agrega interbloque documentado en D-1).
    hist_tema: proporciones del diputado en el tema suavizadas hacia su historial general
    con peso `beta`.
    """

    def __init__(self, objetivo, C=0.1, grupos=(), agrupacion="bloque", beta=10.0, alpha=10.0, min_freq=200, nombre=None):
        super().__init__(objetivo, C, True, alpha, min_freq)
        self.grupos, self.agrupacion, self.beta = tuple(grupos), agrupacion, beta
        self.nombre = nombre or ("d_proyecto_" + "+".join(self.grupos) + f"_{agrupacion}")

    def _cols(self):
        G = "familia" if self.agrupacion == "familia" else "bloque"
        cat = ["distrito_inicio", f"{G}_inicio", "signo_inicio"]
        if self.agrupacion == "bloque+interbloque":
            cat.append("interbloque_inicio")
        num = []
        for g in self.grupos:
            c, n = GRUPOS_PROYECTO[g]
            cat += [x.replace("{G}", G) for x in c]
            num += n
        return cat, num

    def _X(self, df):
        X = features_historial(df[["A", "N", "AB", "AU"]], self.objetivo, self.prior_h, self.alpha)
        for c in [c for c in X if c.startswith("h_") and c != "h_log_n"]:
            X[c] = np.log(X[c])
        cat, num = self._cols()
        if "hist_tema" in self.grupos:
            nt = (df.tA + df.tN + df.tAB).values
            for i, k in enumerate(["A", "N", "AB"]):
                gen = np.exp(X[f"h_{k}"].values)
                X[f"ht_{k}"] = np.log((df[f"t{k}"].values + self.beta * gen) / (nt + self.beta))
            X["ht_log_n"] = np.log1p(nt)
        for c in cat:
            X[c] = df[c].values
        for c in num:
            if c not in X:
                X[c] = df[c].values.astype(float)
        return X

    def fit(self, df):
        y = _y(df, self.objetivo)
        d = _dist(y, self.K)
        self.prior_h = d if self.objetivo == "voto" else d[1:2]
        X = self._X(df)
        cat, _ = self._cols()
        num = [c for c in X if c not in cat]
        pre = ColumnTransformer(
            [
                ("num", StandardScaler(), num),
                ("cat", OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=self.min_freq), cat),
            ]
        )
        self.pipe = Pipeline([("pre", pre), ("lr", LogisticRegression(C=self.C, max_iter=3000))])
        self.pipe.fit(X, y)
        return self


# ---------------------------------------------------------------- etapa 4: LightGBM


class LGBMProyecto(LogisticaProyecto):
    """LightGBM con las MISMAS features que LogisticaProyecto (historial suavizado, contexto al
    inicio, features de proyecto). Categóricas nativas; categorías vistas sólo en el train del
    fold (las nuevas quedan como faltantes). Sin class weights."""

    def __init__(self, objetivo, params: dict, grupos=(), agrupacion="bloque", beta=10.0, alpha=10.0, nombre=None):
        super().__init__(objetivo, 1.0, grupos, agrupacion, beta, alpha, nombre=nombre)
        self.params = dict(params)

    def _Xl(self, df):
        X = self._X(df)
        cat, _ = self._cols()
        for c in cat:
            X[c] = pd.Categorical(X[c], categories=self.cats[c])
        return X

    def fit(self, df):
        from lightgbm import LGBMClassifier

        y = _y(df, self.objetivo)
        d = _dist(y, self.K)
        self.prior_h = d if self.objetivo == "voto" else d[1:2]
        X = self._X(df)
        cat, _ = self._cols()
        self.cats = {c: sorted(X[c].astype(str).unique()) for c in cat}
        X = self._Xl(df)
        base = dict(learning_rate=0.05, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0,
                    min_child_samples=200, cat_smooth=50, min_data_per_group=200, max_cat_to_onehot=8,
                    n_jobs=1, verbose=-1, random_state=0)
        base.update(self.params)
        self.m = LGBMClassifier(**base).fit(X, y, categorical_feature=cat)
        return self

    def predict_proba(self, df):
        P = self.m.predict_proba(self._Xl(df))
        out = np.zeros((len(df), self.K))
        out[:, self.m.classes_] = P
        return out
