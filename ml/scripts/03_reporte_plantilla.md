# Etapa 3 · Features de proyecto (validación 2023–2024)

Generado por `scripts/03a_proyectos_features.py` + `scripts/03_proyecto.py` + `scripts/03_reporte.py`. **PRUEBA no se cargó ni se predijo**: la tabla de expedientes y el historial por tema sólo usan votaciones anteriores a 2025, y un test lo verifica. Tests: `pytest tests` → 24 pasan (13 de la etapa 2 + 11 nuevos de fuga en features de proyecto).

> Experimental: validación = 25 votaciones generales en 6 sesiones. Los IC son amplios. **La selección se hizo con rolling origin dentro de train**; validación sólo se reporta.

## Resumen

1. **Ahora el modelo sí distingue proyectos dentro de una sesión.** El desvío de los negativos esperados entre votaciones de una misma sesión pasa de 0 (referencia) a ≈ 13–17. La correlación de Spearman entre negativos esperados (Σp) y reales sube de 0,01 a **0,45 [0,22; 0,85]** con todas las features de proyecto. El error en negativos Σp baja de 41,1 a **32,6** por votación.
2. **En log loss por diputado la mejora es chica y está dentro del IC:** 0,505 → 0,494 con todas las features. En rolling origin, en cambio, la mejora es consistente: 0,408 → 0,390–0,396, mejor en 3 o 4 de los 4 folds.
3. **El F1 macro sube de 0,32 a 0,42 sin class weights.** El modelo ahora predice NEGATIVO cuando corresponde (269 aciertos contra 52). ABSTENCION todavía nunca sale por argmax.
4. **Lo que más aporta es el tema**, tanto como categoría como en forma de historial del diputado en ese tema. Origen y signo del autor solos empeoran en rolling origin. "Es autor" no mueve nada: hay 148 filas SI en train y 6 en validación.
5. **Rolling origin elige "{mejor}" (C={mejor_C}).** En validación ese modelo queda por detrás de "todas las features" en casi todas las métricas. No lo cambio mirando validación: lo dejo anotado (§10).

## 1. Qué campos de tipo/tema trae el dataset (7a)

{cobertura}

- **Uso:** `TIPO` (tipo de norma) y `TITULO`, fijos desde la presentación y con cobertura completa.
- **Descartados:**
  - **Ficha** (`sumario`, `firmantes`, `tipo_proyecto_ficha`): tiene 0% de cobertura en validación. Además, los firmantes son firmas y quedan fuera por decisión previa.
  - **`nombre_ley_derivado` y `palabras_clave_derivadas`:** provienen de ¿Cómo Votó?, se generaron en parte con IA y a partir de la votación ya ocurrida. No son campos fijos desde la presentación y podrían filtrar información posterior.
  - **Comisión de giro o cabecera:** no existe en el dataset.

**Tema asignado:** lista cerrada de 14 categorías más OTROS (`src/poroteo/temas.py`), con reglas regex sobre el título.
- Escribí las reglas mirando sólo títulos de ENTRENAMIENTO.
- Se aplican igual al `titulo` de un poroteo nuevo de la app.
- No se usó LLM.
- OTROS queda en el 6% de train (24 de 400) y en 2 de 25 en validación.
- **Archivo:** `derivados/proyectos_features.csv`, con 1.741 expedientes, una fila por expediente y sólo campos fijos.

Distribución de temas:

{tema}

## 2. Features de proyecto construidas

| Grupo | Variables | Por qué está disponible antes de la sesión |
|---|---|---|
| origen | `origen_expediente` (D/S/PE/JGM), `origen_autor` (DIPUTADO/SENADOR/EJECUTIVO/COMISION) | Número y tipo del expediente, más el `TIPO` de norma, fijos desde la presentación. **Hallazgo:** 99 de los 183 expedientes "S" de train son *mensajes del Ejecutivo* que entraron por el Senado (`TIPO = MENSAJE Y PROYECTO DE LEY`). Los cuento como EJECUTIVO. |
| signo_autor | signo del bloque del autor (si es diputado) con el gobierno vigente en la fecha de publicación | Intervalo de bloque vigente en `PUBLICACION_FECHA` (siempre ≤ D-1) y regla documental con fecha < sesión |
| alineacion | EJECUTIVO_VIGENTE / **EJECUTIVO_ANTERIOR** / DIPUTADO_{{OFICIALISMO, NO_OFICIALISTA, NO_VERIFICADO}} / SENADOR / COMISION | Gobierno de la publicación contra gobierno vigente en D-1. Los mensajes de un gobierno anterior quedan separados: en validación hay 677 filas de EJECUTIVO_ANTERIOR, en su mayoría proyectos de AF votados con Milei. |
| inter_signo | alineación × signo del diputado al inicio | Combinación de las dos anteriores |
| inter_bloque | alineación × bloque del diputado; mismo bloque / misma familia que el autor | Ídem |
| es_autor | SI / NO / DESCONOCIDO | Cruce SEGURO del autor. Los DUDOSOS quedan DESCONOCIDO, no 0, y van a `derivados/03_autor_cruces_revision.csv` (12) |
| tema | tema, tema × signo del diputado | Reglas sobre el título |
| hist_tema | proporción A/N/Abs del diputado en votaciones previas del mismo tema, suavizada hacia su historial general (β=10), y log(n) | Votos elegibles con los mismos criterios que `prev_*` y `fecha_local` < límite predictivo de la sesión. El test lo recalcula por fuerza bruta. |

- **Proyectos presentados después de D-1:** son 3 votaciones de presencia en train, como un desafuero sobre tablas. Todas sus features de proyecto quedan DESCONOCIDO, sin rellenar. Ninguna votación general está en ese caso: la publicación es siempre al menos 2 días antes de la sesión.
- **Agrupaciones más estables que el nombre del bloque (punto 2):**
  - **`familia_politica_literal`** (documentada y estática por bloque) une variantes de nombre: PRO / UNION PRO / PROPUESTA REPUBLICANA, las de UCR y las de CC. Los bloques SIN_AGRUPAR quedan como su propia familia. FPV, FdT y UxP son familias distintas en el dataset y no inventé una agrupación "peronismo".
  - **Interbloque:** sale de `bloque_interbloque_historico` cuando D-1 cae en el período documentado, que va de 2018-03 a 2023-12.

Origen del autor en las votaciones generales:

{origen}

## 3. Tabla comparativa principal · historial móvil · IC95 por sesión

- **B** = voto | presente.
- **A** = presencia.
- **A×B** = combinado de 4 clases.
- **Vot** = por votación contra los totales oficiales.
- **Σp** = conteo esperado (suma de probabilidades); **argmax** = como lo muestra hoy la app.
- **Spearman** = correlación de rangos entre conteo esperado y oficial en las 25 votaciones.
- **Desvío intra-sesión Σneg** = desvío medio de los negativos esperados entre votaciones de la misma sesión.

La referencia usa la presencia de la etapa 2. Las demás filas usan la presencia elegida en rolling origin (§7).

{principal}

- **Acierto de resultado de 0,96:** es 1 votación de 25 que pasa a predecirse RECHAZADA. Sigue sin discriminar.
- **Spearman negativo de afirmativos en la referencia:** sin información de proyecto, el número de afirmativos predicho sólo sigue la presencia de la sesión. Las votaciones con muchos afirmativos reales son las consensuadas, y en esas no hay más presentes.

## 4. Ablación · rolling origin (selección) y validación (sólo reporte)

- **"todas menos g"** muestra lo que se pierde al sacar el grupo g.
- **"ref + sólo g"** muestra lo que aporta el grupo g solo.
- **Folds mejor que ref:** en cuántos de los 4 folds (2017, 2018, 2019, 2022) la variante tiene menor log loss que la referencia.

{ablacion}

Lectura:
- **Tema e historial por tema** son los únicos grupos que solos ganan en los 4 folds.
- **Origen y signo del autor solos** empeoran: el modelo los usa mal sin interacción con el diputado. En la variante completa, sacar el origen incluso mejora en rolling origin, porque la alineación ya contiene esa información.
- **Las interacciones** (inter_signo, inter_bloque) aportan más que sus partes.
- **es_autor** es neutro.
- **Familia en lugar de bloque** gana en los 4 folds, pero por milésimas (0,4079 → 0,4074). **Interbloque**, igual (0,4056), y en validación empeora. No justifican cambiar la agrupación por ahora.

## 5. ¿Distingue proyectos? Consensuadas contra divididas (punto 3)

- **Corte pedido (margen < 30):** deja sólo 2 votaciones divididas en validación.
- **Corte de sensibilidad (margen < 100):** deja 10 divididas y 15 consensuadas.

{estratos}

La mejora en negativos Σp viene sobre todo de las **consensuadas**: 36,0 → 23,8 en margen ≥ 100. Ahí el modelo ahora sabe que no hay oposición. En las **divididas** el error sigue alto, alrededor de 46–49. Saber *cuántos* de un bloque se van a oponer sigue siendo el problema abierto.

## 6. Con y sin historial

Móvil (sólo 34 filas sin historial; IC poco informativo):

{subgrupos}

Congelado al 2023-01-01 (arranque en frío: 680 filas sin historial):

{subgrupos_congelado}

Historial congelado, tabla completa:

{congelado}

## 7. Presencia

{presencia}

En rolling origin, la logística con bloque/signo y features de proyecto le gana al historial con prior (0,406 frente a 0,416). En validación empatan. La elijo por rolling origin para el combinado.

## 8. Rolling origin por fold (voto, con el C elegido para cada variante)

{rolling}

## 9. Matrices de confusión (B, móvil, validación)

{confusiones}

## 10. Conclusión y elección provisoria

- **Elección por rolling origin:**
  - **Voto | presente → {mejor}, C={mejor_C}.** Rolling origin medio 0,390, frente a 0,408 de la referencia.
  - **Presencia → logística + proyecto.**
- **Diferencia con validación:** en validación, "todas las features" (y "ref + sólo hist_tema") quedan mejor que la elegida en Spearman y en error de negativos. **No cambio la elección mirando validación.** Las diferencias entre las mejores variantes en rolling origin (0,390–0,396) son chicas frente a la variación entre folds. Propongo que la etapa 4 (LightGBM) parta del conjunto completo de features de proyecto y deje que rolling origin decida.
- **Producción:** ninguna de estas features usa firmas. Todas se pueden calcular para un proyecto nuevo de la app con su título y su autor. El autor hoy es texto libre: hace falta que la app identifique al autor (diputado, PE, senador) para tener origen y alineación. Sin eso, sólo queda el tema.

### Notas para la etapa 4

- Calibración (isotónica o Platt dentro de rolling origin) y curva de calibración. Si hace falta, umbral de decisión sobre probabilidades **calibradas**, para que NEGATIVO y ABSTENCION aparezcan sin usar class weights.
- Exponer en la app el **conteo esperado con intervalo** (por simulación de las probabilidades) además del voto por diputado. Σp es mejor que argmax en todas las variantes.
- Revisar las votaciones divididas: interacción tema × bloque e historial del bloque en el tema.
