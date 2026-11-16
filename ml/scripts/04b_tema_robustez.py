"""Etapa 4b · Robustez del tema: ¿cuánto cae en OTROS y cuánto cambia el tema si el título
llega escrito de otra forma, o si sólo hay texto? Sobre votaciones generales de train y
validación (PRUEBA no).

Uso: .venv\\Scripts\\python -I scripts\\04b_tema_robustez.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from poroteo import rutas  # noqa: E402
from poroteo.carga import consulta, leer_dataset  # noqa: E402
from poroteo.temas import OTROS, asignar_tema, asignar_tema_app  # noqa: E402

DERIV = rutas.RAIZ / "derivados"


def abreviar(t: str) -> str:
    """Abreviaturas comunes de redacción."""
    rep = [(r"(?i)\bley\b", "L."), (r"(?i)\bart[ií]culo\b", "art."), (r"(?i)\bnacional\b", "nac."),
           (r"(?i)\bmodificaci[oó]n\b", "modif."), (r"(?i)\brep[uú]blica argentina\b", "RA"),
           (r"(?i)\bprovincia\b", "pcia."), (r"(?i)\br[eé]gimen\b", "rég.")]
    for a, b in rep:
        t = re.sub(a, b, t)
    return t


VARIANTES = {
    "original": lambda t: t,
    "minúsculas": lambda t: t.lower(),
    "con prefijo 'Proyecto de ley: '": lambda t: "Proyecto de ley: " + t,
    "con prefijo 'PROYECTO DE LEY - ' (mayúsc.)": lambda t: "PROYECTO DE LEY - " + t.upper(),
    "sin puntuación": lambda t: re.sub(r"[^\w\s]", " ", t),
    "abreviado (L., art., nac., modif., rég.)": abreviar,
    "primeras 6 palabras": lambda t: " ".join(t.split()[:6]),
    "primeros 40 caracteres": lambda t: t[:40],
}


def main():
    g = leer_dataset("general", ["votacion_id", "expediente", "split"])
    g = g[g.split.isin(["ENTRENAMIENTO", "VALIDACION"])].drop_duplicates("votacion_id")
    t = pd.read_csv(DERIV / "proyectos_features.csv", dtype=str, keep_default_na=False)
    d = consulta("select expediente, texto_original from documentos_proyectos").drop_duplicates("expediente")
    m = g.merge(t[["expediente", "titulo", "tema"]], on="expediente").merge(d, how="left", on="expediente")
    m["texto_original"] = m.texto_original.fillna("")
    filas = []
    for nombre, f in VARIANTES.items():
        for regla, fn in (("reglas actuales", lambda x: asignar_tema(x)), ("propuesta app (limpia prefijos)", lambda x: asignar_tema_app(x)[0])):
            tema = m.titulo.map(lambda x: fn(f(x)))
            for s in ("ENTRENAMIENTO", "VALIDACION"):
                k = m.split == s
                filas.append({"entrada": nombre, "regla": regla, "split": s, "n": int(k.sum()),
                              "% OTROS": f"{(tema[k] == OTROS).mean():.0%}", "% igual al tema original": f"{(tema[k] == m.tema[k]).mean():.0%}"})
    con_texto = m.texto_original.str.len() > 50
    for nombre, fn in (("primeros 500 caracteres del texto (sin título)", lambda r: asignar_tema_app(r.texto_original[:500])[0]),
                       ("título + respaldo con texto si da OTROS", lambda r: asignar_tema_app(r.titulo, r.texto_original)[0]),
                       ("primeras 6 palabras + respaldo con texto", lambda r: asignar_tema_app(" ".join(r.titulo.split()[:6]), r.texto_original)[0])):
        tema = m[con_texto].apply(fn, axis=1)
        for s in ("ENTRENAMIENTO", "VALIDACION"):
            k = m[con_texto].split == s
            filas.append({"entrada": nombre, "regla": "propuesta app (limpia prefijos)", "split": s, "n": int(k.sum()),
                          "% OTROS": f"{(tema[k] == OTROS).mean():.0%}", "% igual al tema original": f"{(tema[k] == m[con_texto].tema[k]).mean():.0%}"})
    r = pd.DataFrame(filas)
    r.to_csv(DERIV / "04_tema_robustez.csv", index=False)
    print(r.to_string(index=False))
    print("cobertura de texto:", m.groupby("split").apply(lambda x: (x.texto_original.str.len() > 50).mean()).round(2).to_dict())


if __name__ == "__main__":
    main()
