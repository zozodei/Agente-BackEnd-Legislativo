"""Rutas del proyecto. Todo se resuelve relativo a la raíz del repo."""

from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
DATOS = RAIZ / "datos" / "Poroteo_Diputados"
TABLAS = DATOS / "01_datos"
CALIDAD = DATOS / "03_calidad"
ML = DATOS / "04_machine_learning"
SQLITE = DATOS / "05_base_datos" / "poroteo_diputados.sqlite"
REPORTES = RAIZ / "reports"
MODELOS = RAIZ / "modelos"

DATASETS_ML = {
    "general": ML / "dataset_intencion_general.csv",
    "texto_digital": ML / "dataset_texto_digital_experimental.csv",
    "ocr_spa_pendiente": ML / "dataset_texto_ocr_spa_pendiente.csv",
    "presencia": ML / "dataset_presencia_registrada.csv",
}
PROTOCOLO = ML / "protocolo_evaluacion.json"
