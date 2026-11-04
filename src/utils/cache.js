/**
 * Caché en memoria con TTL. Suficiente para datos que cambian poco (los 257 diputados).
 * Comparte la promesa en vuelo para no duplicar consultas concurrentes.
 */
export function createCache(ttlMs) {
  const store = new Map();

  return {
    async getOrSet(key, loader) {
      const hit = store.get(key);
      if (hit && hit.expires > Date.now()) return hit.value;

      const promise = loader();
      store.set(key, { value: promise, expires: Date.now() + ttlMs });
      try {
        return await promise;
      } catch (err) {
        store.delete(key);
        throw err;
      }
    },
    clear() {
      store.clear();
    },
  };
}
