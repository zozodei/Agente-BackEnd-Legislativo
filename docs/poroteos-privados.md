# Poroteos privados: modelo anterior reemplazado

El modelo de autorización por user_id fue reemplazado por membresías explícitas.
No asignar permisos modificando el creador: usar la RPC y participantes.
Ver [contrato vigente](poroteos-colaborativos.md). La migración user_id se conserva
como prerrequisito histórico; la migración siguiente cambia su FK a SET NULL.
