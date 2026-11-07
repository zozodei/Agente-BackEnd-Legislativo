import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const instances = [];
const live = new Set();
const pending = [];
let peak = 0;
let failConstruction = false;
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    constructor() {
      super();
      if (failConstruction) throw new Error('Fallo de constructor simulado');
      this.termination = new Promise((resolve, reject) => {
        this.resolveTermination = resolve;
        this.rejectTermination = reject;
      });
      this.terminate = vi.fn(() => this.termination);
      this.on('exit', () => live.delete(this));
      instances.push(this);
      live.add(this);
      peak = Math.max(peak, live.size);
    }
    exit() {
      this.emit('exit', 0);
      this.resolveTermination(0);
    }
  },
}));
const { extractPdfText } = await import('../src/services/pdf.service.js');
const pdf = Buffer.from('%PDF-1.4');
function extract() {
  const operation = extractPdfText(pdf);
  pending.push(operation);
  // Las pruebas provocan errores antes de esperar la respuesta HTTP simulada.
  void operation.catch(() => {});
  return operation;
}
beforeEach(() => {
  vi.useFakeTimers();
  peak = 0;
  failConstruction = false;
});
afterEach(async () => {
  for (const worker of instances) worker.exit();
  await Promise.allSettled(pending);
  vi.useRealTimers();
  instances.length = 0;
  pending.length = 0;
  live.clear();
});

it.each(['timeout', 'message', 'invalid-message', 'error'])(
  '%s no libera el cupo mientras terminate sigue pendiente, ni ante eventos tardíos',
  async (event) => {
    const first = extract();
    extract();
    const [worker, other] = instances;
    if (event === 'timeout') await vi.advanceTimersByTimeAsync(8000);
    else if (event === 'message') worker.emit('message', { text: 'Ley válida' });
    else if (event === 'invalid-message') worker.emit('message', { error: true });
    else worker.emit('error', new Error('Fallo simulado'));
    if (event === 'message') await expect(first).resolves.toBe('Ley válida');
    else await expect(first).rejects.toMatchObject({ status: 400 });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(live.size).toBe(2);
    await expect(extract()).rejects.toMatchObject({ status: 503 });

    worker.emit('error', new Error('Evento tardío'));
    worker.emit('message', { text: 'Otro mensaje' });
    await vi.advanceTimersByTimeAsync(8000);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(extract()).rejects.toMatchObject({ status: 503 });

    worker.exit();
    const third = extract();
    expect(instances).toHaveLength(3);
    expect(live.size).toBe(2);
    worker.emit('exit', 1); // no descontar una segunda vez por el mismo worker
    await expect(extract()).rejects.toMatchObject({ status: 503 });
    other.exit();
    extract();
    expect(live.size).toBe(2);
    expect(peak).toBe(2);
    instances[2].emit('message', { text: 'Proyecto nuevo' });
    await expect(third).resolves.toBe('Proyecto nuevo');
    await expect(extract()).rejects.toMatchObject({ status: 503 });
  },
);

it('ni resolve ni reject de terminate liberan cupos antes del evento exit', async () => {
  const first = extract();
  const second = extract();
  instances[0].emit('message', { text: 'Uno' });
  instances[1].emit('message', { text: 'Dos' });
  await Promise.all([first, second]);
  instances[0].resolveTermination(0);
  instances[1].rejectTermination(new Error('No pudo terminarse'));
  await Promise.resolve();
  await expect(extract()).rejects.toMatchObject({ status: 503 });
  expect(live.size).toBe(2);
  expect(peak).toBe(2);
});

it('exit sin mensaje rechaza y libera exactamente un cupo', async () => {
  const first = extract();
  extract();
  instances[0].exit();
  await expect(first).rejects.toMatchObject({ status: 400 });
  extract();
  await expect(extract()).rejects.toMatchObject({ status: 503 });
  expect(peak).toBe(2);
});

it('si el constructor falla no queda reservado un cupo inexistente', async () => {
  failConstruction = true;
  await expect(extract()).rejects.toThrow('Fallo de constructor simulado');
  failConstruction = false;
  extract();
  extract();
  await expect(extract()).rejects.toMatchObject({ status: 503 });
  expect(live.size).toBe(2);
  expect(peak).toBe(2);
});
