// Utilidades compartidas por los scripts de dataset y modelo (lectura de data/, CSV, texto).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';

export const RAIZ = join(import.meta.dirname, '..', '..');
export const DIR_RAW = join(RAIZ, 'data', 'raw');
export const DIR_DATASET = join(RAIZ, 'data', 'dataset');
export const DIR_MODELO = join(RAIZ, 'data', 'modelo');

export function leerRaw(tabla) {
  return JSON.parse(gunzipSync(readFileSync(join(DIR_RAW, `${tabla}.json.gz`))));
}

export function leerJsonGz(ruta) {
  return JSON.parse(gunzipSync(readFileSync(ruta)));
}

export function escribirJsonGz(ruta, valor) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, gzipSync(JSON.stringify(valor)));
}

export function existe(ruta) {
  return existsSync(ruta);
}

/** Minúsculas, sin tildes, sin puntuación, espacios colapsados. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function celdaCsv(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Escribe un CSV (UTF-8 con BOM para que Excel muestre bien las tildes). */
export function escribirCsv(ruta, filas, columnas) {
  mkdirSync(dirname(ruta), { recursive: true });
  const cols = columnas ?? Object.keys(filas[0] ?? {});
  const lineas = [cols.join(',')];
  for (const f of filas) lineas.push(cols.map((c) => celdaCsv(f[c])).join(','));
  const contenido = '﻿' + lineas.join('\n') + '\n';
  writeFileSync(ruta, ruta.endsWith('.gz') ? gzipSync(contenido) : contenido);
}

export const VOTOS = ['AFIRMATIVO', 'NEGATIVO', 'ABSTENCION', 'AUSENTE'];
