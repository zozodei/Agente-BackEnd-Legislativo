"""Tema del proyecto por reglas sobre el TÍTULO (lista cerrada, primera regla que coincide).

Disponibilidad: el título (`proyectos_de_ley.TITULO`) se fija al presentar el expediente y no
cambia con el trámite. Las reglas se escribieron mirando SOLO títulos de ENTRENAMIENTO y se
aplican igual a un proyecto nuevo de la app (`titulo` del poroteo). No usan LLM ni ninguna
información de postura o resultado.

El orden importa: reglas más específicas primero (p. ej. "contrato de trabajo" antes que
"código"; "aprobación del convenio" internacional antes que temas sectoriales).
"""

from __future__ import annotations

import re

from .texto import normalizar

OTROS = "OTROS"

# (tema, regex sobre el título normalizado: mayúsculas, sin tildes)
REGLAS: list[tuple[str, str]] = [
    ("PRESUPUESTO_CUENTAS", r"\bPRESUPUESTO GENERAL\b|\bCUENTAS? DE INVERSION\b"),
    ("CONMEMORATIVO_SIMBOLICO", r"\bDIA (NACIONAL )?DE(L| LA| LOS| LAS)?\b|\"DIA\b|\bCAPITAL NACIONAL\b|\bFIESTA NACIONAL\b|\bLUGAR HISTORICO\b|\bFERIADO\b"
     r"|\bDENOMINA(R|SE)\b|\bMONUMENTO\b|\bHOMENAJE\b|\bSIMBOLO NACIONAL\b|\bRESTOS MORTALES\b|\bBICENTENARIO\b"),
    ("RELACIONES_EXTERIORES_DEFENSA", r"^APROBACION DE(L| LA| LAS| LOS| LO)? (ACUERDO|CONVENIO|CONVENCION|TRATADO|PROTOCOLO|ENMIENDA|MEMORANDUM|II PROTOCOLO)"
     r"|\bTROPAS\b|\bFUERZAS NACIONALES\b|\bFUERZAS ARMADAS\b|\bEJERCITO\b|\bARMADA\b|\bDEFENSA NACIONAL\b|\bMISION DE ESTABILIZACION\b"
     r"|\bMALVINAS\b|\bANTARTID|\bATLANTICO SUR\b|\bSUBMARINO\b|\bMILITAR\b|\bREGIMIENTO\b|\bCONSULES\b|\bNACIONES UNIDAS\b"),
    ("TRABAJO_PREVISION", r"\bCONTRATO DE TRABAJO\b|\bTRABAJADOR|\bLABORA|\bEMPLEO\b|\bJUBILA|\bPENSION|\bPREVISIONAL\b"
     r"|\bSEGURIDAD SOCIAL\b|\bASIGNACIONES FAMILIARES\b|\bACCIDENTES DE TRABAJO\b|\bCASAS PARTICULARES\b|\bTRABAJO AGRARIO\b"
     r"|\bOCUPACIONAL\b|\bRIESGOS DE TRABAJO\b|\bSINDICA|\bCONVENCIONES COLECTIVAS\b"),
    ("ECONOMIA_IMPUESTOS_FINANZAS", r"\bIMPUEST|\bTRIBUT|\bGANANCIAS\b|\bVALOR AGREGADO\b|\bFISCAL\b|\bDEUDA\b|\bFONDO MONETARIO\b"
     r"|\bBANCO CENTRAL\b|\bBANCO (INTERAMERICANO|INTERNACIONAL|MUNDIAL)\b|\bFINANCI|\bMERCADO DE CAPITALES\b|\bEMERGENCIA ECONOMICA\b"
     r"|\bADUAN|\bMONETARI|\bPRESUPUEST|\bCAMBIARI|\bBLANQUEO\b|\bEXTERIORIZACION\b"),
    ("JUSTICIA_SEGURIDAD", r"\bCODIGO PENAL\b|\bPROCESAL\b|\bPENA\b|\bPENAL\b|\bDELITO|\bJUDICIAL|\bTRIBUNAL|\bJUZGADO|\bCAMARA FEDERAL\b"
     r"|\bCASACION\b|\bCORTE SUPREMA\b|\bMAGISTRATURA\b|\bMINISTERIO PUBLICO\b|\bNARCOTRAFIC|\bESTUPEFACIENTE|\bLAVADO\b"
     r"|\bTERRORIS|\bSEGURIDAD (INTERIOR|CIUDADANA)\b|\bFUERZAS DE SEGURIDAD\b|\bMEDIDAS CAUTELARES\b|\bEXTINCION DE DOMINIO\b"
     r"|\bINTELIGENCIA\b|\bARMAS\b|\bMATERIALES CONTROLADOS\b|\bPENITENCIARI"),
    ("DERECHOS_HUMANOS_GENERO", r"\bLESA HUMANIDAD\b|\bDICTADURA\b|\bDESAPARICION FORZADA\b|\bMEMORIA\b|\bGENERO\b|\bMUJER|\bTRATA\b"
     r"|\bVICTIMAS\b|\bDERECHOS HUMANOS\b|\bIDENTIDAD\b|\bEMBARAZO\b|\bDIVERSIDAD\b|\bIGUALDAD\b|\bPARIDAD\b|\bVIOLENCIA\b"),
    ("EDUCACION_CIENCIA", r"\bUNIVERSI|\bEDUCA|\bESCUEL|\bESCOLAR|\bCIENCIA|\bTECNOLOGI|\bESTUDIANT|\bCURRICUL|\bDOCENTE|\bINVESTIGACION CIENTIFICA\b"),
    ("SALUD_DESARROLLO_SOCIAL", r"\bSALUD\b|\bMEDICAMENT|\bDISCAPACIDAD\b|\bADICCION|\bOBESIDAD\b|\bALIMENTA|\bVACUNA|\bFERTILIZACION\b"
     r"|\bSUICIDIO\b|\bSANGRE\b|\bSODIO\b|\bENFERMEDAD|\bHOSPITAL|\bTABACO\b|\bPROCREACION\b|\bNINEZ\b|\bNINOS\b|\bADOLESCEN|\bVIVIENDA"
     r"|\bPOBREZA\b|\bEMERGENCIA ALIMENTARIA\b|\bBARRIOS POPULARES\b|\bONCOLOG|\bCANNABIS\b|\bAUTISMO\b|\bDIABETES\b|\bTRASPLANTE|\bEMERGENCIA SOCIAL\b|\bSOCIO URBANA\b|\bINDIGENA"),
    ("ENERGIA_AMBIENTE_TRANSPORTE", r"\bHIDROCARBUR|\bENERGI|\bELECTRIC|\bMINERI|\bMINERO|\bAMBIENT|\bCAMBIO CLIMATICO\b|\bRENOVABLE|\bGAS\b|\bPETROL"
     r"|\bNUCLEAR\b|\bBOSQUES\b|\bGLACIAR|\bHUMEDAL|\bRESIDUOS\b|\bMARITIMA PROTEGIDA\b|\bAREAS? MARINAS?\b|\bFERROCARRIL|\bNAVEGACION\b|\bMARINA MERCANTE\b|\bTRANSITO\b|\bTRANSPORTE\b|\bINFRAESTRUCTURA\b|\bPARQUE NACIONAL\b|\bFITOSANITARIO|\bCARBON\b"),
    ("PRODUCCION_COMERCIO_CONSUMO", r"\bINDUSTRI|\bPROMOCION DE\b|\bFOMENTO\b|\bPYMES?\b|\bPEQUENAS Y MEDIANAS\b|\bAGRO|\bGANADER|\bYERBA\b|\bOLIVI"
     r"|\bPESCA|\bECONOMIA DEL CONOCIMIENTO\b|\bSOFTWARE\b|\bAUTOPART|\bINVERSION(ES)?\b|\bCONSUM|\bPRECIO|\bABASTECIMIENTO\b|\bCOMERCI"
     r"|\bEXPORTACION|\bIMPORTACION|\bTURIS|\bCOOPERATIVA|\bEMPRESA|\bPRODUCCION\b|\bREGIMEN DE INCENTIVO\b"),
    ("INSTITUCIONAL_ELECTORAL", r"\bELECTORAL\b|\bELECCION|\bPARTIDOS POLITICOS\b|\bCOMISION BICAMERAL\b|\bINFORMACION PUBLICA\b|\bDECLARACIONES JURADAS\b"
     r"|\bMINISTERIOS\b|\bETICA PUBLICA\b|\bCIUDADANIA\b|\bCODIGO CIVIL\b|\bCOMUNICACION|\bDIGITAL\b|\bMEDIOS\b|\bTELECOMUNIC|\bDECRETO(S)? DE NECESIDAD"
     r"|\bDNU\b|\bREFORMA DEL ESTADO\b|\bDELEGACION DE FACULTADES\b|\bEMERGENCIA PUBLICA\b|\bBASES Y PUNTOS DE PARTIDA\b|\bCOPARTICIPACION\b|\bREFORMA POLITICA\b|\bRESPONSABILIDAD DEL ESTADO\b|\bADMINISTRACION PUBLICA\b"
     r"|PRESIDENTE DE LA NACION|PREELECTORAL|TRANSICION DEL GOBIERNO|DESBUROCRATIZACION|DIGESTO"),
    ("EXPROPIACION_INMUEBLES_TERRITORIO", r"\bUTILIDAD PUBLICA\b|\bEXPROPIA|\bINMUEBLE|\bCESION(ES)?\b|\bTRANSFERENCIA\b|\bTIERRAS\b|\bLIMITES\b"),
    ("DEPORTE_CULTURA", r"\bDEPORT|\bCULTURA|\bARTE|\bACTORAL\b|\bCLUBES\b|\bMUSEO\b|\bMUSICA|\bCINE|\bTEATRO|\bFOLKLORE\b|\bPATRIMONIO\b|\bLIBRO"),
]
_COMPILADAS = [(t, re.compile(r)) for t, r in REGLAS]
TEMAS = [t for t, _ in REGLAS] + [OTROS]


def asignar_tema(titulo: str) -> str:
    """Primer tema cuya regla coincide con el título normalizado; si ninguna, OTROS."""
    t = normalizar(titulo or "")
    for tema, rx in _COMPILADAS:
        if rx.search(t):
            return tema
    return OTROS


# ---------------------------------------------------------------- uso en la app (etapa 4)

_PREFIJOS = re.compile(
    r"^\W*(H\.?\s*)?(HONORABLE\s+)?(CAMARA DE DIPUTADOS( DE LA NACION)?|SENADO( DE LA NACION)?)?\W*"
    r"(PROYECTO DE (LEY|RESOLUCION|DECLARACION)|MENSAJE( Y PROYECTO DE LEY)?)?\W*"
)


def limpiar_titulo(titulo: str) -> str:
    """Saca encabezados y prefijos que la app puede traer y el dataset no ('Proyecto de ley:',
    'H. Cámara de Diputados de la Nación', 'Mensaje y proyecto de ley'). Ningún título del
    dataset empieza así, así que en los datos de entrenamiento no cambia el tema."""
    t = normalizar(titulo or "")
    for _ in range(2):
        t = _PREFIJOS.sub("", t, count=1).strip()
    return t


def asignar_tema_app(titulo: str, texto: str | None = None, n_texto: int = 500) -> tuple[str, str]:
    """Tema para un poroteo nuevo: reglas sobre el título limpio; si da OTROS y hay texto del
    proyecto, reglas sobre sus primeros `n_texto` caracteres (limpios). Devuelve (tema, fuente)."""
    tema = asignar_tema(limpiar_titulo(titulo))
    if tema != OTROS or not texto:
        return tema, "titulo"
    tema_t = asignar_tema(limpiar_titulo(texto[:n_texto]))
    return (tema_t, "texto_500") if tema_t != OTROS else (OTROS, "ninguna")
