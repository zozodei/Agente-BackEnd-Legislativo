"""Etapa 3a · Genera derivados/proyectos_features.csv (una fila por expediente) y la
cobertura de campos de proyecto en train/validación. No modifica datos originales.

Incluye expedientes de las filas ENTRENAMIENTO/VALIDACION de los conjuntos general y
presencia, y los de votaciones anteriores a 2025 (para el historial por tema). PRUEBA no.

Uso: .venv\\Scripts\\python -I scripts\\03a_proyectos_features.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from poroteo import rutas  # noqa: E402
from poroteo.carga import consulta, leer_dataset  # noqa: E402
from poroteo.proyectos import tabla_expedientes  # noqa: E402

DERIV = rutas.RAIZ / "derivados"


def filas_train_val() -> pd.DataFrame:
    partes = []
    for nombre in ("general", "presencia"):
        d = leer_dataset(nombre, ["votacion_id", "expediente", "proyecto_id", "split"])
        partes.append(d[d.split.isin(["ENTRENAMIENTO", "VALIDACION"])].drop_duplicates("votacion_id").assign(conjunto=nombre))
    return pd.concat(partes, ignore_index=True)


def cobertura_campos_disponibles(v: pd.DataFrame) -> pd.DataFrame:
    """7a · ¿Qué campos de tipo/tema/comisión trae el dataset y con qué cobertura?"""
    g = v[v.conjunto == "general"]
    d = consulta("select expediente, tipo_proyecto_ficha, sumario_ficha, firmantes_ficha from documentos_proyectos")
    d = d.drop_duplicates("expediente")
    a = consulta("select votacion_id, nombre_ley_derivado, palabras_clave_derivadas from votaciones")
    pl = consulta("select PROYECTO_ID proyecto_id, TIPO, TITULO from proyectos_de_ley")
    m = g.merge(d, how="left", on="expediente").merge(a, how="left", on="votacion_id").merge(pl, how="left", on="proyecto_id")
    campos = {
        "proyectos_de_ley.TIPO (tipo de norma)": "TIPO",
        "proyectos_de_ley.TITULO": "TITULO",
        "documentos_proyectos.tipo_proyecto_ficha": "tipo_proyecto_ficha",
        "documentos_proyectos.sumario_ficha": "sumario_ficha",
        "documentos_proyectos.firmantes_ficha": "firmantes_ficha",
        "votaciones.nombre_ley_derivado": "nombre_ley_derivado",
        "votaciones.palabras_clave_derivadas": "palabras_clave_derivadas",
    }
    filas = []
    for etiqueta, c in campos.items():
        ok = m[c].fillna("").astype(str).str.strip().replace({"[]": ""}).ne("")
        filas.append({"campo": etiqueta, **{s: f"{ok[m.split == s].mean():.0%}" for s in ("ENTRENAMIENTO", "VALIDACION")}})
    filas.append({"campo": "comisión de giro / cabecera", "ENTRENAMIENTO": "no existe en el dataset", "VALIDACION": "no existe en el dataset"})
    return pd.DataFrame(filas)


def main():
    DERIV.mkdir(exist_ok=True)
    v = filas_train_val()
    t = tabla_expedientes(v)
    t.to_csv(DERIV / "proyectos_features.csv", index=False, encoding="utf-8")
    print("proyectos_features.csv:", len(t), "expedientes")

    cob = cobertura_campos_disponibles(v)
    cob.to_csv(DERIV / "03_cobertura_campos.csv", index=False)
    print(cob.to_string(index=False))

    # Cobertura de las features derivadas sobre las votaciones generales
    g = v[v.conjunto == "general"].merge(t, how="left", on="expediente", suffixes=("", "_t"))
    resumen = {}
    for c in ("origen_expediente", "origen_autor", "autor_cruce_estado", "gobierno_publicacion", "tema"):
        resumen[c] = {s: g[g.split == s][c].value_counts().to_dict() for s in ("ENTRENAMIENTO", "VALIDACION")}
    dip = g[g.origen_autor == "DIPUTADO"]
    resumen["autor_bloque_conocido"] = {s: f"{(dip[dip.split == s].autor_bloque_publicacion != 'DESCONOCIDO').mean():.0%}"
                                        for s in ("ENTRENAMIENTO", "VALIDACION")}
    json.dump(resumen, open(DERIV / "03_cobertura_features.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps(resumen, indent=1, ensure_ascii=False))
    rev = t[t.autor_cruce_estado == "DUDOSO"]
    rev.to_csv(DERIV / "03_autor_cruces_revision.csv", index=False, encoding="utf-8")
    print("dudosos a revisión:", len(rev))


if __name__ == "__main__":
    main()
