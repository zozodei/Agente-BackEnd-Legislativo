# Decisiones técnicas

Registro de las decisiones tomadas sin consultar (la consigna pide elegir la opción más
razonable, anotarla y seguir). Cada una dice qué se eligió, por qué y qué alternativa quedó.

## Datos

1. **El dataset es el de Supabase (¿Cómo Votó?)**, exportado a `data/raw` y limpiado en
   `data/dataset`. El zip de la rama `ML-TESTING` no está disponible y no aporta datos que no
   estén acá.
2. **Las tablas de origen no se modifican.** Lo limpio va a tablas nuevas
   (`votaciones_enriquecidas`, `votos_correcciones`, `bloques_unificados`…) y a las vistas
   `votaciones` y `votos`. Así no se copian 768.789 votos.
3. **Conteos desde los votos individuales**, no desde las columnas de `cv_votaciones`, que
   están corridas (ver `DIAGNOSTICO.md`). El backend usa `conteo_coaliciones.tot`.
4. **"Oficialismo" = bloque del partido del presidente en funciones**, por fecha (`gobiernos`).
   Es una definición operativa y neutral. No se usan las etiquetas `coalicion` de la fuente
   porque son inconsistentes.
5. **"Posición del bloque" = cómo votaron quienes hoy integran el bloque**, no el id del bloque.
   Funciona con bloques nuevos o que cambiaron de nombre.
6. **El dataset se versiona en el repo** (`data/`, ~20 MB comprimido) para que el modelo sea
   reproducible y para que el equipo lo tenga. El CSV de votos va comprimido (`votos.csv.gz`).

## Modelo

7. **Regresión logística multinomial** (4 clases: afirmativo, negativo, abstención, ausente)
   en producción. En el backtesting le gana a la línea de base y al gradient boosting en
   accuracy, F1 y calibración con escenarios; además es interpretable y pesa unos KB.
   Números en `EVALUACION_MODELOS.md`.
8. **Todo en JavaScript, sin Python.** El backend es Node y Vercel corre Node: el mismo código
   calcula las features al entrenar y al predecir, sin diferencias entre ambos.
9. **Anti-fuga temporal:** las features de una votación usan solo votaciones de días anteriores
   (lo verifican los tests). Backtesting con corte temporal: entrena hasta 2022, calibra con
   2023–jun/2024 y prueba con jul/2024–oct/2026.
10. **Búsqueda de proyectos parecidos con LSA (96 dim) + TF-IDF**, no con un modelo neuronal.
    MiniLM multilingüe no mejoró la predicción (69,0 % contra 70,4 %) y pesa ~600 MB de
    dependencias, inviable en una función de Vercel. La similitud híbrida baja el peso de LSA
    cuando la proyección representa mal el texto (caso "interrupción voluntaria del embarazo").
11. **Los vecinos se pesan por similitud² y por antigüedad** (vida media 4 años): una votación
    del mismo tema de este año dice más de los diputados actuales que una de hace 20 años.
12. **Supuestos del escenario** (postura del oficialismo o de un bloque) como entrada opcional.
    Se aplican con una actualización bayesiana usando la disciplina de cada diputado: quien
    acompaña a su bloque el 95 % de las veces sigue el supuesto; quien se aparta seguido, menos.
    Sin supuestos el modelo no puede anticipar qué proyecto va a dividir a la Cámara; con ellos,
    el error en negativos por votación baja de ~40 a ~6.
13. **Calibración por temperatura** con datos que el modelo no vio. El modelo de producción se
    entrena hasta 6 meses antes del último dato y calibra con esos 6 meses.
14. **Niveles de confianza**: firme ≥ 75 %, probable 50–75 %, dudosa < 50 %. Con menos de 20
    votaciones en dos años la confianza es siempre "dudosa" y la explicación lo dice.
15. **Voto predicho = la opción más probable.** Los totales también se muestran como "votos
    esperados" (suma de probabilidades), que es más realista cuando hay muchas dudosas.

## Explicaciones

16. **Plantilla determinista siempre disponible**, armada solo con los factores guardados
    (votos en proyectos parecidos con título y fecha, porcentajes del bloque, disciplina,
    ausencias, oficialismo). No puede inventar nada.
17. **LLM opcional para redactar** (`ANTHROPIC_API_KEY`, modelo configurable con `LLM_MODELO`,
    por defecto `claude-opus-5-5`). Recibe solo los datos ya redondeados; si cita un número que
    no está en los datos o no tiene 2–4 oraciones, se descarta y queda la plantilla
    (`explicacion_estado = 'error'`, la interfaz avisa). Caché por hash de los datos en
    `explicaciones_cache`: no se regenera si no cambiaron.
18. **Si el LLM falla, igual hay explicación** (la plantilla) con aviso, en vez de dejar el
    campo vacío: es más útil y sigue sin inventar.

## Base de datos y API

19. **`poroteo_votos` sigue siendo el voto final** que usa toda la app (editor, públicos,
    backoffice). Se recalcula en una transacción: último ajuste manual vigente o, si no hay,
    la predicción. Así no se rompió nada de lo existente.
20. **`ajustes_manuales` solo agrega filas** (trigger que impide modificar; sin permiso de
    borrar salvo cascada al borrar el poroteo). `voto = null` = volver a la predicción.
21. **Las RPC nuevas repiten las reglas de `poroteo_mutar`**: membresía y versión bajo bloqueo.
    Un 409 no se reintenta.
22. **El motor corre en el backend Express** (no en Edge Functions): ya hay un backend con
    sesión, CSRF y permisos; duplicarlos en Deno no aporta. El motor carga el artefacto de
    `data/modelo` (~3 MB) una vez por proceso (~0,7 s) y predice los 257 en ~70 ms.
23. **El editor manual registra ajustes** si el poroteo tiene predicción: cada cambio queda en
    el historial aunque se edite desde la vista vieja.
24. **Senado**: las tablas nuevas tienen `camara`; el hemiciclo ya soporta 72 bancas.

## Entorno

25. **Entorno separado = Supabase local (CLI + Docker)** con una réplica del esquema de origen
    (`supabase/local/`) y los datos reales. Supabase Branching requiere plan pago y no hay
    acceso a la base de producción desde acá (solo claves de API).
26. **Rama `feature/poroteo-ia-completo`** en los dos repos, separada de `ML-TESTING`.
