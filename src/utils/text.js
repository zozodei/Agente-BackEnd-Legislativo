/** Normaliza texto para búsquedas: minúsculas y sin tildes ("Córdoba" → "cordoba"). */
export function normalize(text = '') {
  return String(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}
