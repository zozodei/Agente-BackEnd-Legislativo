"""Etapa 2b · ¿En cuántas votaciones de ENTRENAMIENTO el autor del proyecto se puede cruzar
con un legislador? (preparación del experimento 'es autor' de la etapa 3; no modela).

Fuente: proyectos_de_ley.AUTOR (sólo el autor principal, formato "APELLIDO, NOMBRE").
Cruce contra historial_bloques_intervalos con mandato vigente en PUBLICACION_FECHA:
  SEGURO   → "APELLIDO, NOMBRE" normalizado idéntico y único entre mandatos vigentes.
  DUDOSO   → apellido idéntico y único + primer nombre compatible, o apellido único sin nombre
             compatible. Van a derivados/02_autor_cruces_revision.csv. NO se usan sin revisión.
  SIN_CRUCE / NO_APLICA (expediente de Senado, PE, JGM: el autor no es diputado).
Nada de matching difuso silencioso.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from poroteo import rutas  # noqa: E402
from poroteo.carga import consulta, leer_dataset  # noqa: E402
from poroteo.texto import normalizar  # noqa: E402


def partir(nombre: str) -> tuple[str, str]:
    ap, _, no = normalizar(nombre).partition(",")
    return ap.strip(), no.strip()


def cruzar(autor: str, fecha: pd.Timestamp, vig: pd.DataFrame) -> tuple[str, str, str]:
    ap, no = partir(autor)
    v = vig[(vig.INICIO <= fecha) & (fecha <= vig.MANDATO_FIN)]
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


def main():
    g = leer_dataset("general", ["votacion_id", "expediente", "split"])
    ev = g[g.split == "ENTRENAMIENTO"].drop_duplicates("votacion_id")
    pl = consulta("select EXP_DIPUTADOS expediente, AUTOR, PUBLICACION_FECHA from proyectos_de_ley where EXP_DIPUTADOS<>''")
    pl = pl.drop_duplicates("expediente")
    h = consulta("select ID, APELLIDO, NOMBRE, INICIO, FIN, CESE from historial_bloques_intervalos")
    for c in ("INICIO", "FIN", "CESE"):
        h[c] = pd.to_datetime(h[c].str[:10])
    h["MANDATO_FIN"] = h[["FIN", "CESE"]].min(axis=1)
    h["AP"], h["NO"] = h.APELLIDO.map(normalizar), h.NOMBRE.map(normalizar)

    ev = ev.merge(pl, how="left", on="expediente")
    filas = []
    for r in ev.itertuples():
        tipo = r.expediente.split("-")[1] if r.expediente.count("-") == 2 else ""
        if tipo != "D":
            filas.append((r.votacion_id, r.expediente, r.AUTOR, "NO_APLICA", "", f"expediente tipo {tipo or '?'}: autor no es diputado"))
            continue
        if not isinstance(r.AUTOR, str) or not r.AUTOR:
            filas.append((r.votacion_id, r.expediente, "", "SIN_CRUCE", "", "sin AUTOR"))
            continue
        est, lid, mot = cruzar(r.AUTOR, pd.Timestamp(r.PUBLICACION_FECHA[:10]), h)
        filas.append((r.votacion_id, r.expediente, r.AUTOR, est, lid, mot))
    t = pd.DataFrame(filas, columns=["votacion_id", "expediente", "autor", "estado", "legislador_id", "motivo"])
    rev = t[t.estado == "DUDOSO"]
    (rutas.RAIZ / "derivados").mkdir(exist_ok=True)
    rev.to_csv(rutas.RAIZ / "derivados" / "02_autor_cruces_revision.csv", index=False, encoding="utf-8")
    t.to_csv(rutas.RAIZ / "derivados" / "02_autor_cruces_todos.csv", index=False, encoding="utf-8")
    print(t.estado.value_counts().to_string())
    print("votaciones de train:", len(t), "· con autor diputado SEGURO:", (t.estado == "SEGURO").sum())


if __name__ == "__main__":
    main()
