import { parentPort, workerData } from 'node:worker_threads';
import { getDocumentProxy } from 'unpdf';

let pdf;
try {
  pdf = await getDocumentProxy(new Uint8Array(workerData), {
    isEvalSupported: false,
    useWorkerFetch: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  if (pdf.numPages > 300) throw new Error('PAGE_LIMIT');
  let text = '';
  for (let page = 1; page <= pdf.numPages && text.length < 500_000; page += 1) {
    const documentPage = await pdf.getPage(page);
    const content = await documentPage.getTextContent();
    text +=
      content.items.map((item) => (typeof item.str === 'string' ? item.str : '')).join(' ') + '\n';
    documentPage.cleanup();
  }
  parentPort.postMessage({ text: text.trim().slice(0, 500_000) });
} catch {
  parentPort.postMessage({ error: true });
} finally {
  await pdf?.destroy();
}
