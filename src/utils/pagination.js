/** Convierte page/pageSize (1-indexado) en el rango inclusivo de PostgREST. */
export function toRange(page, pageSize) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/** Formato estándar de respuesta paginada: { data, meta }. */
export function paginated(items, { page, pageSize, total }) {
  return {
    data: items,
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/** Pagina un array que ya está en memoria. */
export function paginateArray(items, page, pageSize) {
  const { from } = toRange(page, pageSize);
  return paginated(items.slice(from, from + pageSize), { page, pageSize, total: items.length });
}
