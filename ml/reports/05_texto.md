# Etapa 5 · Proyectos parecidos del pasado y cómo votó cada diputado

Generado por `scripts/05_texto.py` (textos, similitud, vecinos y features), `scripts/05_seleccion_k.py` (K) y `scripts/05_reporte.py` (tablas, B1/B2 y control). Los modelos `solo_tema_texto` y `con_autor_texto` salen de `scripts/04_modelos.py` (mismo protocolo que 4c).

**Todo local.** Ningún texto del dataset salió del equipo. **PRUEBA no se cargó ni se predijo.** El dataset original no se modificó.

**Limitación principal:** sólo **13 de las 25 votaciones de validación tienen texto**. Las conclusiones son sobre esas 13. Ver §0.

---

## 0 · Inventario de texto y cobertura

### Campos usados (existían antes de la votación)

| campo | origen | uso |
|---|---|---|
| Título del proyecto | `proyectos` / `proyectos_de_ley` (vía `proyectos_features.csv`) | sí |
| Texto original del proyecto | `documentos_proyectos.texto_original`, sólo tipos `PROYECTO_ORIGINAL_PDF`, `PROYECTO_ORIGINAL_HTML`, `proyecto_original_no_necesariamente_version_votada` | sí |

El texto final es título + ". " + texto original, normalizado (sin tildes, mayúsculas), con tope de 20 000 caracteres. Se excluyen los documentos con estado `recuperado_ocr_spa_pendiente_revision` (OCR sin revisar).

### Campos excluidos

| campo | motivo |
|---|---|
| `votaciones.nombre_ley_derivado`, `palabras_clave_derivadas`, `tipo_derivado_repo` | escritos después de la votación |
| `votaciones.titulo` | título del acta: escrito después de votar y puede mencionar el resultado. Duda, afuera |
| `documentos_proyectos.fundamentos` | son los fundamentos del proyecto (pre-votación), pero el campo mezcla fuentes (ficha, dictamen). Duda, afuera |
| `documentos_proyectos.texto_documento` | cobertura 8 %, mezcla dictamen y proyecto. Afuera |
| `documentos_proyectos.sumario_ficha`, `tipo_proyecto_ficha`, `firmantes_ficha` | ficha web, puede tener estado posterior. Afuera |
| `documentos_proyectos.estado`, `estado_fase*`, `sanción`, `DICTAMEN_ORDEN_DEL_DIA`, `SANCION_POSTERIOR_AL_VOTO` | estado o documentos posteriores. Afuera |
| etiquetas de postura, `tema` construido con resultado | no se usan |

Si querés incluir `fundamentos` o `votaciones.titulo`, decímelo: son los dos casos dudosos.

### Cobertura por año (votaciones de ENTRENAMIENTO y VALIDACIÓN, con texto)

| año | votaciones | con texto | cobertura |
|---|---|---|---|
| 2011 | 41 | 37 | 0,90 |
| 2012 | 93 | 77 | 0,83 |
| 2013 | 103 | 81 | 0,79 |
| 2014 | 120 | 103 | 0,86 |
| 2015 | 57 | 54 | 0,95 |
| 2016 | 174 | 168 | 0,97 |
| 2017 | 119 | 112 | 0,94 |
| 2018 | 53 | 51 | 0,96 |
| 2019 | 41 | 41 | 1,00 |
| 2020 | 35 | 29 | 0,83 |
| **2021** | 24 | **0** | **0,00** |
| **2022** | 56 | **0** | **0,00** |
| **2023** | 23 | **7** | **0,30** |
| 2024 | 31 | 29 | 0,94 |

Los años 2021 y 2022 no tienen texto en el dataset (no es un error del código: `documentos_proyectos` no trae texto para esos expedientes). 2023 tiene cobertura baja. Por eso la validación con texto queda en 13 votaciones.

---

## 1 · Similitud

- **Variante A (TF-IDF):** palabras 1–2 + caracteres 3–5, sublinear, min_df 2. Un vectorizador por año objetivo: para 2023 en adelante, ajustado sólo con ENTRENAMIENTO (≤ 2022); para años anteriores, con los textos de años anteriores. Nunca con VALIDACIÓN ni PRUEBA. Coseno en [0, 1].
- **Variante B (sentence-transformers):** **no probada.** Requiere instalar `torch` (del orden de GB) y descargar un modelo multilingüe. No la intenté. Si querés, la pruebo en otra pasada.

## 2 · Vecinos

- Vecinos = votaciones con texto y votos individuales, con fecha **estrictamente anterior** a la sesión.
- Se guardan los 20 más parecidos por votación: `derivados/05_vecinos.csv` (votación, rango, vecino, fecha, similitud, título).
- **K elegido por rolling origin** (`derivados/05_seleccion_k_rolling.csv`). Modelo de prueba: logística sobre bloque + features de texto, folds 2014–2022 (entrena con años previos):

| K | log loss RO (texto) | log loss RO (sólo bloque) |
|---|---|---|
| 5 | 0,5016 | 0,5142 |
| 10 | 0,4929 | 0,5142 |
| **20** | **0,4927** | 0,5142 |

K = 20. K = 10 está prácticamente empatado. Además, el texto mejora el log loss frente a bloque solo en todos los K.

## 3 · Features por diputado y votación

Por cada (votación, diputado), ponderadas por similitud, con suavizado (λ = 2) hacia el bloque:

- `txt_own_A/N/AB`: voto propio del diputado en los vecinos, suavizado hacia su bloque. `txt_own_n`: vecinos donde votó. `txt_own_neff`: cantidad efectiva de vecinos.
- `txt_bmaj_A/N/AB`: mayoría de su bloque actual en los vecinos donde él no votó. `txt_bmaj_n_abs`: cantidad.
- `txt_rebeld`: apartamiento del bloque en los vecinos donde votó.
- `txt_gob_A/N/AB`, `txt_gob_n`: la proporción propia, sólo con vecinos del gobierno vigente en la votación.
- `txt_sim_max`, `txt_sim_mean`: similitud del vecino más cercano y media. `txt_sin_texto`: 1 si la votación no tiene texto (features en neutro).

Variantes: `solo_tema_texto` (tema + historial + texto en el voto) y `con_autor_texto` (grupos de `con_autor` + texto en el voto). **La presencia es la de la variante base** (sin texto), así la comparación sólo mide el voto.

## 4 · Tabla de validación con intervalos (13 votaciones con texto)

Bootstrap 90 % por votación, 1000 remuestreos. Acierto = porcentaje de votos individuales presentes bien predichos.

| variante | Log loss voto (B) | Acierto por diputado | Acierto en divididas | EA neg. Σp total |
|---|---|---|---|---|
| solo_tema | 0,566 [0,468; 0,662] | 0,722 [0,649; 0,801] | 0,640 [0,570; 0,724] | 37,8 [29,0; 47,1] |
| **solo_tema_texto** | 0,533 [0,441; 0,629] | 0,766 [0,698; 0,835] | 0,743 [0,655; 0,828] | 37,5 [26,0; 48,9] |
| con_autor | 0,522 [0,398; 0,653] | 0,802 [0,728; 0,869] | 0,707 [0,640; 0,777] | 29,1 [21,3; 37,6] |
| **con_autor_texto** | 0,493 [0,388; 0,607] | 0,810 [0,737; 0,881] | 0,719 [0,636; 0,800] | 32,1 [24,5; 40,3] |
| B1 | — | 0,709 [0,630; 0,792] | 0,618 [0,543; 0,690] | 47,8 [29,4; 66,4] |
| B2 | — | 0,685 [0,589; 0,781] | 0,549 [0,469; 0,634] | 35,2 [22,4; 47,7] |

Nota: el EA de `solo_tema` sobre estas 13 votaciones (37,8) no es comparable con el 34,8 de 4c, que usa las 25.

## 5 · Pareadas: modelo − solo_tema, y modelo − B1 / B2

**Contra solo_tema (validación):**

| variante | Δ log loss voto | Δ acierto | Δ EA neg. total |
|---|---|---|---|
| solo_tema_texto | −0,033 [−0,095; +0,030] | +0,041 [−0,041; +0,122] | −0,2 [−5,7; +5,1] |
| con_autor | −0,044 [−0,099; +0,007] | +0,076 [+0,030; +0,128] | −8,7 [−16,6; −0,9] |
| con_autor_texto | **−0,073 [−0,118; −0,029]** | +0,085 [+0,037; +0,136] | −5,7 [−14,0; +2,1] |

**Contra B1 y B2 (acierto y EA, no hay log loss en los baselines):**

| variante | Δ acierto vs B1 | Δ acierto vs B2 | Δ EA vs B1 | Δ EA vs B2 |
|---|---|---|---|---|
| solo_tema_texto | +0,053 [−0,017; +0,117] | +0,076 [−0,006; +0,161] | −10,2 [−25,7; +6,8] | +2,4 [−10,2; +16,2] |
| con_autor_texto | **+0,097 [+0,021; +0,177]** | **+0,120 [+0,044; +0,191]** | −15,7 [−32,7; +1,7] | −3,1 [−14,0; +7,7] |

**Rolling origin (promedio de folds OOF, contra solo_tema):**

| variante | Δ log loss voto (RO) | Δ EA neg. OOF |
|---|---|---|
| solo_tema_texto | −0,001 [−0,010; +0,008] | **+0,73 [+0,05; +1,37]** (peor) |
| con_autor_texto | +0,006 [−0,008; +0,021] | +1,88 [−0,17; +3,85] (peor en punto) |

No calculé el acierto en rolling origin: el OOF por fila no se guarda en los derivados.

## 6 · Decisión según la regla

Regla: igual que en 4c (mejora log loss de voto y error en negativos, con al menos uno de los dos con intervalo que no cruce cero, y sin empeorar el otro), **y** ganarle a B1 y a B2.

- **solo_tema_texto:** no cumple. Mejora en punto las dos métricas, pero ningún intervalo excluye cero. En rolling origin, el error en negativos empeora de forma significativa (+0,73). **Descartada.**
- **con_autor_texto:** cumple la parte de validación contra solo_tema (log loss con intervalo que excluye cero; error en negativos mejora en punto). **No cumple con rolling origin**: el error en negativos empeora (+1,88 en punto, intervalo a punto de excluir cero) y el log loss empeora ligeramente (+0,006). Como la regla pide decidir con el promedio de rolling origin y validación, **no se adopta**.
- **Contra B1 y B2:** `con_autor_texto` gana en acierto con intervalo que excluye cero (+0,097 y +0,120). En EA no gana con significancia. `solo_tema_texto` no le gana con significancia a ninguno.

**Veredicto: el texto no pasa la regla.** Con 13 votaciones de validación, la ganancia en log loss de `con_autor_texto` no se sostiene en rolling origin. El acierto sobre B1/B2 viene casi entero de la base con autor: contra `con_autor` sin texto, el texto agrega en punto +0,008 de acierto y +3 de error en negativos (cifras de tabla, sin intervalo pareado; no lo calculé).

Lo que sí se confirma: el texto ayuda a `solo_tema` en acierto (+0,04 en punto) y en divididas (+0,10 en punto). Esa señal es chica y no es significativa con 13 votaciones.

## 7 · Control de sentido común (punto 6)

Vecinos (top 5, con título, fecha y similitud) y predicción contra real para PRO, UCR, LLA y UxP. "texto Σp" es el esperado del modelo `solo_tema_texto` (suma de probabilidades). B1 y B2 son predicciones por bloque (mayoría) y por diputado.

### 7.1 · Ley Bases (HCDN_ACTA_5101)

Vecinos (similitud baja, 0,34–0,36):

| vecino | fecha | sim | título |
|---|---|---|---|
| HCDN_ACTA_4773 | 2023-04-19 | 0,361 | Modificación de la legislación vigente sobre prevención y represión del lavado de activos… |
| HCDN_ACTA_3800 | 2018-05-09 | 0,348 | Régimen de financiamiento productivo |
| HCDN_ACTA_3683 | 2017-11-22 | 0,348 | Régimen de financiamiento productivo |
| HCDN_ACTA_3684 | 2017-11-22 | 0,348 | Régimen de financiamiento productivo |
| HCDN_ACTA_3732 | 2017-12-20 | 0,343 | Reforma del sistema tributario argentino |

Predicción contra real (presentes):

| bloque | real (A / N / AB) | texto Σp (A / N / AB) | B1 (A / N / AB) | B2 (A / N / AB) |
|---|---|---|---|---|
| PRO | 36 / 0 / 0 | 13,0 / 12,4 / 1,8 | 0 / 36 / 0 | 2 / 34 / 0 |
| UCR | 31 / 2 / 0 | 5,7 / 16,7 / 1,6 | 33 / 0 / 0 | 10 / 17 / 6 |
| LLA | 35 / 0 / 0 | 28,4 / 1,3 / 0,8 | 35 / 0 / 0 | 34 / 0 / 1 |
| UxP | 0 / 93 / 0 | 33,9 / 35,5 / 3,2 | 93 / 0 / 0 | 88 / 3 / 2 |

Lectura: el modelo de texto se equivoca en UCR (predice NEG donde fue AFIRM) y deja PRO dividido 13 / 12 cuando fue unánime. B1 acierta UCR pero falla PRO; B2 también falla PRO. Los vecinos no son parecidos (sim < 0,37), así que el texto no aporta mucha información aquí.

### 7.2 · Armas de fuego (HCDN_ACTA_5385)

Vecinos (similitud 0,32–0,33; incluye la propia Ley Bases como vecina):

| vecino | fecha | sim | título |
|---|---|---|---|
| HCDN_ACTA_4845 | 2023-09-20 | 0,333 | Creación del programa de generación y fortalecimiento del empleo argentino "Empleo MiPyME" |
| HCDN_ACTA_4045 | 2020-11-17 | 0,324 | Presupuesto general de la administración nacional para el ejercicio fiscal 2021 |
| HCDN_ACTA_4777 | 2023-04-19 | 0,321 | Autorización de la entrada de tropas extranjeras al territorio nacional… |
| HCDN_ACTA_5121 | 2024-02-06 | 0,316 | Ley de Bases y puntos de partida para la libertad de los argentinos |
| HCDN_ACTA_5115 | 2024-02-06 | 0,316 | Ley de Bases y puntos de partida para la libertad de los argentinos |

Predicción contra real (presentes):

| bloque | real (A / N / AB) | texto Σp (A / N / AB) | B1 (A / N / AB) | B2 (A / N / AB) |
|---|---|---|---|---|
| PRO | 33 / 0 / 0 | 13,2 / 9,4 / 1,0 | 0 / 0 / 33 | 21 / 0 / 12 |
| UCR | 31 / 0 / 0 | 7,2 / 12,1 / 1,5 | 31 / 0 / 0 | 10 / 2 / 19 |
| LLA | 37 / 0 / 0 | 31,1 / 1,8 / 0,5 | 37 / 0 / 0 | 35 / 0 / 2 |
| UxP | 1 / 83 / 1 | 11,9 / 57,2 / 2,0 | 0 / 85 / 0 | 57 / 28 / 0 |

Lectura: en armas el texto acierta LLA y UxP (NEG), pero falla UCR (predice NEG con 12 de 31 AFIRM). B1 acierta UCR y UxP y falla PRO. Ninguno acierta PRO en su totalidad.

### 7.3 · Dividida con más error de solo_tema (HCDN_ACTA_4844)

Universidad Nacional Madres de Plaza de Mayo (creación en CABA). Vecinos:

| vecino | fecha | sim | título |
|---|---|---|---|
| HCDN_ACTA_89 | 2014-10-22 | 0,483 | Creación del Instituto Universitario Nacional de Derechos Humanos "Madres de Plaza de Mayo"… |
| HCDN_ACTA_95 | 2014-10-22 | 0,318 | Creación de la Universidad Pedagógica Nacional |
| HCDN_ACTA_93 | 2014-10-22 | 0,313 | Creación de la Universidad Nacional del Alto Uruguay (UNAU)… |
| HCDN_ACTA_134 | 2014-07-02 | 0,305 | Declarar símbolo nacional argentino al pañuelo blanco de las Madres de Plaza de Mayo |
| HCDN_ACTA_96 | 2014-10-22 | 0,299 | Universidad Nacional Guillermo Brown… |

Predicción contra real (presentes):

| bloque | real (A / N / AB) | texto Σp (A / N / AB) | B1 (A / N / AB) | B2 (A / N / AB) |
|---|---|---|---|---|
| PRO | 0 / 26 / 0 | 23,3 / 4,7 / 4,0 | 26 / 0 / 0 | 26 / 0 / 0 |
| UCR | 0 / 0 / 0 | sin votos presentes en el padrón de la base | — | — |
| LLA | 0 / 2 / 0 | 0,6 / 0,4 / 0,1 | 2 / 0 / 0 | 2 / 0 / 0 |
| UxP | 0 / 0 / 0 | sin votos presentes en el padrón de la base | — | — |

Lectura: en esta votación el texto también falla PRO (predice AFIRM, fue NEG). Vecino principal bastante parecido (0,48, creación de un instituto con el mismo nombre). El resto de los vecinos son creaciones de universidades y tienen votos muy distintos. UCR y UxP no aparecen con votos en el padrón de esta sesión, así que el control no los puede evaluar.

---

## 8 · Qué quedó afuera y por qué

- **Sin texto para 2021–2022 y para la mayoría de 2023.** Es la limitación principal. Se puede resolver sólo si el dataset trae el texto de esos proyectos.
- **Variante B (embeddings) no probada.**
- **Control de vecinos:** sólo 3 votaciones, como pediste.
- **Acierto en rolling origin para los modelos:** no calculado (el OOF por fila no se guarda).

## 9 · Archivos

- `derivados/05_cobertura_texto_por_anio.csv`, `derivados/05_textos_votacion.csv`
- `derivados/05_vecinos.csv` (20 vecinos por votación, con título, fecha y similitud). Evidencia para explicar votos.
- `derivados/05_texto_features_K5.csv`, `…K10.csv`, `…K20.csv`
- `derivados/05_seleccion_k_rolling.csv`, `derivados/05_k_elegido.json`
- `derivados/05_resultados.json`

## 10 · Para que decidas

1. ¿Descartamos `con_autor_texto` como candidato (la regla con rolling origin no lo deja pasar)? Mi recomendación: sí, por ahora.
2. ¿Querés que incluya `fundamentos` o `votaciones.titulo`, o los dejo afuera?
3. ¿Pruebo la variante B (embeddings)? Requiere instalar torch (del orden de GB).
4. ¿Qué hacemos con los años sin texto? Hace falta traer el texto de 2021–2023 para que la validación tenga más peso.
