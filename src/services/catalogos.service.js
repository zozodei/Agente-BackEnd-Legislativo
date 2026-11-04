import { getAllDiputados } from './diputados.service.js';

/** Bloques actuales con cantidad de bancas, ordenados de mayor a menor. */
export async function listBloques() {
  const diputados = await getAllDiputados();
  const counts = new Map();
  for (const d of diputados) counts.set(d.bloque, (counts.get(d.bloque) ?? 0) + 1);
  return [...counts.entries()]
    .map(([nombre, bancas]) => ({ nombre, bancas }))
    .sort((a, b) => b.bancas - a.bancas || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Distritos (provincias) con cantidad de bancas. */
export async function listDistritos() {
  const diputados = await getAllDiputados();
  const counts = new Map();
  for (const d of diputados) counts.set(d.distrito, (counts.get(d.distrito) ?? 0) + 1);
  return [...counts.entries()]
    .map(([nombre, bancas]) => ({ nombre, bancas }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
