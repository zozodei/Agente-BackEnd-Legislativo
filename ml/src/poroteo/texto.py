"""Normalización de texto: sin tildes, mayúsculas, espacios colapsados."""

import re
import unicodedata


def normalizar(s: str) -> str:
    if s is None:
        return ""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().upper()
