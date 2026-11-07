import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const instances = [];
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    constructor() {
      super();
      this.terminate = vi.fn();
      instances.push(this);
    }
  },
}));
const { extractPdfText } = await import('../src/services/pdf.service.js');
afterEach(() => {
  vi.useRealTimers();
  instances.length = 0;
});

it('limita concurrencia a dos extracciones y termina workers a los 8 segundos', async () => {
  vi.useFakeTimers();
  const pdf = Buffer.from('%PDF-1.4');
  const one = extractPdfText(pdf);
  const two = extractPdfText(pdf);
  const failures = Promise.all([
    expect(one).rejects.toMatchObject({ status: 400 }),
    expect(two).rejects.toMatchObject({ status: 400 }),
  ]);
  await expect(extractPdfText(pdf)).rejects.toMatchObject({ status: 503 });
  await vi.advanceTimersByTimeAsync(8000);
  await failures;
  expect(instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  const next = extractPdfText(pdf);
  instances.at(-1).emit('message', { text: 'Ley válida' });
  await expect(next).resolves.toBe('Ley válida');
});
