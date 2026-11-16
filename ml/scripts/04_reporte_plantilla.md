# Etapa 4 · Logística vs LightGBM, calibración, umbral e intervalos de conteo (validación 2023–2024)

Generado por `scripts/04_modelos.py` + `scripts/04b_tema_robustez.py` + `scripts/04_reporte.py`. **PRUEBA no se cargó ni se predijo.** Tests: `pytest tests` → 32 pasan (24 anteriores + 8 de la etapa 4: particiones del rolling origin, calibradores, umbral, intervalos y tema para la app).

> Todo lo que se ajusta sale de **predicciones out-of-fold (OOF) del rolling origin dentro de train**: familia, hiperparámetros, calibrador, pesos de decisión, σ/τ de los intervalos y residuos empíricos. Validación (25 votaciones, 6 sesiones) sólo se transforma y se reporta. OOF de voto: 115 votaciones de 2017, 2018, 2019 y 2022.

## Resumen

1. **Logística vs LightGBM, con los mismos folds:**
   - **Voto | presente:** gana la logística en las dos variantes (rolling origin 0,388 frente a 0,394 en solo_tema; 0,396 frente a 0,402 en con_autor). LightGBM sobreajusta en el fold 2022.
   - **Presencia:** gana LightGBM (0,400 frente a 0,406–0,409; mejor en 4–5 de 6 folds).
2. **solo_tema vs con_autor: la diferencia es chica y no es consistente.**
   - **Rolling origin:** con_autor es *peor* en voto (+0,008; gana sólo 2 de 4 folds).
   - **Validación:** el log loss empata (IC pareado del combinado [−0,055; +0,051]). con_autor mejora el F1 con umbral (+0,045) y el error en negativos Σp (−3,6), pero **predice RECHAZADAS 2 votaciones de Milei que fueron aprobadas** (acierto 0,92 contra 1,00).
   - **Recomendación:** hoy no vale el cambio en la app sólo por esto. Ver §3 y §8.
3. **Calibración:** las probabilidades ya estaban razonablemente calibradas (ECE ≤ 0,06).
   - Rolling origin elige temperatura (T = 0,90, apenas *más* concentrada) en solo_tema y nada en con_autor. La isotónica empeora en rolling origin.
   - El defecto que se ve en las curvas, NEGATIVO sobreconfiado por encima de 0,6, no lo arregla ningún calibrador monótono global.
4. **Umbral (pesos por clase sobre probabilidades calibradas, sin class weights):**
   - **F1 macro en validación:** sube de 0,391 a 0,450 (solo_tema) y de 0,462 a 0,496 (con_autor).
   - **ABSTENCION:** ahora aparece (33–34 aciertos de 200), con muchos falsos positivos.
5. **Intervalos de conteo:** suponer independencia da IC80 de ±8 votos que cubren el **6–24%** de las veces. Hay que modelar la correlación con un efecto común por votación (τ) y uno por bloque (σ).
   - **Simulación con σ y τ (elegidos en OOF):** cubre lo nominal en validación, 0,68–0,92 en IC80. A cambio, los IC80 miden alrededor de **±70 afirmativos** y **±50 negativos**, poco útiles para la app.
   - **Intervalos empíricos** (residuos OOF): son la mitad de anchos, pero en validación sólo cubren el 48–64%.
   - **Lectura:** el modelo todavía no sabe *cuáles* votaciones se van a dividir.

## 1. Logística vs LightGBM · rolling origin (mismos folds y mismas features)

{ro}

- **Variantes de features:**
  - **solo_tema:** voto = tema + hist_tema; presencia = tema.
  - **con_autor:** voto = origen, signo_autor, alineación, inter_signo, inter_bloque, tema, hist_tema; presencia = origen, alineación, inter_signo, tema.
  - Las dos llevan la base de la etapa 2: historial, distrito, bloque y signo al inicio. Se sacó es_autor.
- **Grillas:**
  - **Logística:** C ∈ {{0,0003 … 0,03}}.
  - **LightGBM:** hojas ∈ {{4, 7, 15}}, árboles ∈ {{60, 100, 150, 300}}, learning rate 0,05, min_child_samples 200, sin class weights. Agregué configuraciones más regularizadas después de ver que LightGBM sobreajustaba con 200–500 árboles en un fold: la grilla se decidió con rolling origin, no con validación.
- **Elección por rolling origin:**
  - **Voto:** logística C=0,003 en las dos variantes.
  - **Presencia:** LightGBM (7 hojas, 150 árboles) en las dos.

## 2. Tabla comparativa principal · validación · historial móvil · IC95 por sesión

{principal}

- **Columnas:**
  - **B** = voto | presente.
  - **A** = presencia.
  - **A×B** = combinado de 4 clases.
  - **F1 con umbral:** regla argmax(w·p) con los pesos elegidos en OOF (§5).
  - **ECE:** uno contra el resto, 10 bins.
  - **Acierto de resultado:** con conteo esperado Σp.
  - **Cobertura:** intervalo simulado con efecto por bloque y por votación, contra totales oficiales.
- **Calibrado vs sin calibrar:** en con_autor coinciden porque rolling origin eligió no calibrar.

Historial congelado al 2023-01-01:

{congelado}

## 3. ¿Vale identificar al autor en la app? con_autor − solo_tema

{diferencia}

**Lectura:**
- **Rolling origin:** la información del autor no mejora el log loss.
- **Validación:** ayuda en el F1 con umbral y en el error de conteo de negativos, pero empeora el resultado en los proyectos del Ejecutivo de Milei (§7).
- **Origen del problema:** la feature de alineación interactúa con un `signo` documental que clasifica a PRO y UCR como NO_OFICIALISTA bajo Milei, cuando en 2024 votaron con el gobierno.
- **Recomendación:**
  - **No pedir todavía** el cambio estructural del autor en la app.
  - **Primero**, agregar una feature de "alineación reciente del bloque con el oficialismo" (proporción de votaciones de los últimos meses, antes de D-1, en las que el bloque votó como el bloque oficialista) y repetir esta comparación.
  - Si con eso con_autor gana en rolling origin, se pide el cambio en la app.

## 4. Calibración (elegida con rolling sobre los folds OOF: el calibrador se ajusta con los folds anteriores y se evalúa en el siguiente)

{calibracion}

![Curvas de calibración](04_calibracion.png)

- **Cómo leer el gráfico:**
  - La diagonal es la calibración perfecta.
  - En con_autor el calibrador elegido es "sin calibrar", así que las curvas OOF con y sin calibrar coinciden.
  - ABSTENCION casi nunca supera 0,2, así que sólo hay 1 o 2 bins con datos.
- **Lo que muestran:**
  - AFIRMATIVO está bien calibrado.
  - **NEGATIVO** sigue la diagonal hasta alrededor de 0,5 y después queda **sobreconfiado**: con p ≈ 0,7–0,8, el NEGATIVO real es 0,2–0,55. En validación esa zona son justamente PRO y UCR en proyectos de Milei.
  - Una temperatura única no puede corregir esa forma, y la isotónica sobreajusta, porque hay pocas filas en la cola.

## 5. Umbral de decisión (pesos por clase elegidos en OOF calibrado)

{umbral}

- **Uso:** este umbral sirve para mostrar un voto por diputado en la app.
- **Por qué no se usa para contar:** el conteo por votación se hace con Σp (§6), que no depende del umbral y tiene menos error que contar votos por argmax o por umbral.
- **ABSTENCION:** casi no se puede predecir (F1 de la clase ≈ 0,1). Propongo mostrarla en la app sólo como probabilidad, no como voto.

## 6. Conteo esperado e intervalos sin asumir independencia

- **Modelo de simulación:**
  - Cada diputado vota según sus probabilidades calibradas, más dos efectos aleatorios en el logit de NEGATIVO, ABSTENCION y AUSENTE (relativos a AFIRMATIVO).
  - Un efecto es común a toda la votación (τ): toda la Cámara se corre hacia el consenso o hacia la división.
  - El otro es común a cada bloque en esa votación (σ): el bloque se mueve junto.
  - (σ, τ) se eligen en OOF, buscando la cobertura más cercana a 80% y 90%.
- **Alternativa empírica:** Σp + cuantiles de los residuos OOF.
- **Referencias de cobertura:**
  - **Filas existentes:** lo que el modelo puede ver.
  - **Totales oficiales:** incluyen las 7–14 bancas sin fila por votación, que cuentan como "sin asignar".

Selección de (σ, τ) en OOF (las mejores 4 y el caso independiente):

{sigma}

Cobertura real, todas las votaciones:

{cob_todas}

**Lectura:**
- **Independencia:** subestima muchísimo la incertidumbre. El IC80 cubre 0–24%.
- **Por qué los intervalos simulados son tan anchos:** la distribución real es **bimodal**. En 2 de cada 3 votaciones hay 0–5 negativos; en las demás, 80–110. Σp, en cambio, predice un valor intermedio (mediana 16).
- **Cobertura en OOF:** es optimista, porque σ y τ se eligieron con esos mismos datos.
- **Cobertura en validación:** es la medición honesta. Los intervalos simulados cubren el nivel nominal, pero miden ±60–80 votos.
- **Intervalos empíricos:** quedan cortos en validación (0,48–0,64). 2023–2024 tuvo más votaciones divididas que el promedio de train.
- **Propuesta para la app:** mostrar Σp con el intervalo simulado y, al lado, una alerta de "votación potencialmente dividida" cuando el IC80 de negativos supere un umbral. Un intervalo estrecho sería falsa precisión.

## 7. Estrato de votaciones divididas (margen oficial < 100)

{divididas}

Cobertura en divididas:

{cob_div}

- **Error en negativos Σp:** en las divididas sigue en 42–50 por votación con todos los modelos, contra 17–25 en las consensuadas.
- **Intervalos:** los simulados cubren las divididas porque son anchos. Los empíricos no las cubren.

### Diagnóstico: votaciones de validación que se predicen RECHAZADAS (no se usa para elegir)

{diagnostico}

- **Etapa 3 (todas las features, argmax):** predijo RECHAZADA **HCDN_ACTA_5385**, el proyecto del Ejecutivo de Milei sobre regularización de armas de fuego (0007-PE-2024, tema JUSTICIA_SEGURIDAD). Fue aprobado 142 a 89.
- **con_autor en la etapa 4:** también predice RECHAZADA **HCDN_ACTA_5101**, la Ley Bases (144 a 109), incluso con Σp.
- **Causa:** el error viene de **PRO (37 diputados) y UCR (32)**.
  - La regla documental del dataset los clasifica **NO_OFICIALISTA** bajo Milei. El propio dataset advierte que "bloque nuclear distinto no implica oposición a todo proyecto".
  - En train, la combinación "proyecto del Ejecutivo vigente × diputado no oficialista" casi siempre votó en contra: con CFK y con Macri, la oposición principal se oponía a los proyectos del Ejecutivo.
  - En 2024, PRO y UCR votaron a favor (33 de 37 y 31 de 32), pero el modelo les asigna P(NEG) ≈ 0,45–0,55 y, con argmax, NEGATIVO.
- **Por qué es un cambio de régimen:** un gobierno con un bloque propio de 37 diputados, que gobierna con apoyo de la oposición "dialoguista". No hay ejemplos de eso en train.
- **Por qué solo_tema lo esquiva:** no usa la alineación del autor. Su predicción para esos bloques depende más del historial personal y del tema.
- **Remedio propuesto:** la feature de alineación reciente del bloque con el oficialismo (§3), calculada con votos anteriores a D-1, que ya existen en 2024 desde diciembre de 2023.

## 8. Con y sin historial

{subgrupos}

## 9. Ejecutivo de un gobierno anterior · filas de train (punto 5)

- **Tamaño:** **{ea_filas} filas** de voto | presente en **{ea_vot} votaciones** de train. Detalle: {ea_detalle}.
- **Votos:** el {ea_afirm} fue AFIRMATIVO; son proyectos de consenso que quedaron pendientes de un gobierno al siguiente.
- **Consecuencia:** el modelo casi no tiene ejemplos de un proyecto del Ejecutivo anterior con votación dividida. En validación hay 677 filas así (proyectos de AF votados con Milei), y con 5 votaciones de train esa categoría no se puede estimar bien.

## 10. Robustez del tema (punto 6)

Sobre las 425 votaciones generales de train y validación. Formato: "% OTROS · % igual al tema del título original".

{tema}

- **Qué no afecta:** mayúsculas y minúsculas, puntuación y abreviaturas comunes casi no cambian nada.
- **Prefijo "Proyecto de ley":** con las reglas actuales rompía el 6–8% de los títulos, por la regla de "APROBACIÓN DEL CONVENIO…" anclada al inicio. La limpieza de prefijos lo corrige al 100% sin cambiar ningún tema del dataset (verificado en los 1.741 expedientes).
- **Títulos truncados** (6 palabras o 40 caracteres): son el problema real. Alrededor de 40% cae en OTROS.
- **Texto solo** (primeros 500 caracteres): no sirve como sustituto. Sólo coincide con el tema del título en el 23–45% de los casos, porque el encabezado y los artículos meten ruido.
- **Texto como respaldo:** cuando el título da OTROS, sí sirve. Baja OTROS de 6% a 3% en train sin cambiar los demás temas.

**Propuesta para calcular el tema de un proyecto nuevo en la app** (`asignar_tema_app` en `src/poroteo/temas.py`):
1. Usar el **título completo** del poroteo, limpiando encabezados y prefijos ("Proyecto de ley", "H. Cámara…", "Mensaje…").
2. Si da OTROS y hay `textoProyecto`, aplicar las mismas reglas a sus primeros 500 caracteres limpios.
3. Si sigue en OTROS, **mostrar el tema como editable** en la app (lista cerrada de 14 categorías) y marcar `tema_fuente = "usuario"` en la metadata. Nunca usar un LLM para postura ni resultado. Si se usa para el tema, que reciba sólo título y texto.
4. Pedir en la app un **título de al menos 10 palabras o 60 caracteres**, o avisar que el tema puede quedar en OTROS.

## 11. Skills instaladas: archivos, scripts y red (punto 7)

| Skill | Publicador | Archivos | ¿Ejecuta scripts? | ¿Accede a red? |
|---|---|---|---|---|
| pandas-pro | Jeffallan/claude-skills | `SKILL.md` + 5 `references/*.md` (agregaciones, limpieza, operaciones, merges, rendimiento) | No. Sólo markdown | No. Sólo links de autor y documentación en el texto |
| python-testing-patterns | wshobson/agents | `SKILL.md` + `references/advanced-patterns.md`, `references/details.md` | No. Sólo markdown con ejemplos de código (`requests.get` a `api.example.com` dentro de ejemplos con `mock.patch`) | No. Menciona `pip install pytest-cov` como instrucción, no se ejecuta |
| scikit-learn | K-Dense-AI/scientific-agent-skills | `SKILL.md` + 8 `references/*.md` + **2 scripts**: `scripts/classification_pipeline.py`, `scripts/clustering_analysis.py` | **Sí, si se le pide**: los scripts son demos que usan datasets que vienen con sklearn (`load_breast_cancer`, `load_iris`) y guardan PNG en el directorio actual. Su frontmatter declara `allowed-tools: Read Write Edit Bash` | **Indirectamente**: el SKILL.md propone correrlos con `uv run --with scikit-learn==1.9.1 …`, que **descarga paquetes de PyPI**. Los scripts en sí no abren conexiones |

No ejecuté ninguno de los dos scripts de la skill de scikit-learn ni ningún comando `uv`/`pip` sugerido por las skills. Todo el código de este proyecto usa el `.venv` con `requirements.txt` fijado.

## 12. Notas para lo que sigue

- **Feature de alineación reciente bloque ↔ oficialismo** (antes de D-1), para corregir el cambio de régimen de 2024. Después, repetir solo_tema vs con_autor.
- **Calibración por clase en la cola de NEGATIVO** (p > 0,6), con más datos o con un término de interacción en vez de un recalibrador global.
- **Etapa 5 (similitud de texto)** como experimento separado, sobre la variante solo_tema.
- **Test:** no se tocó. Queda pendiente la evaluación única, con tu aprobación, sobre la variante y la configuración que elijas.
