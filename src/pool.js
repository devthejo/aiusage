import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

/**
 * Répartit `items` sur N workers et concatène leurs messages de retour.
 * Un worker qui échoue ne fait pas tomber la collecte : sa part est perdue et
 * signalée dans `errors`, plutôt que d'annuler un scan de plusieurs minutes.
 */
export async function runPool(workerUrl, items, extra = {}, { onProgress, concurrency } = {}) {
  if (!items.length) return { results: [], errors: [] };
  const n = Math.max(1, Math.min(concurrency || availableParallelism() - 1, items.length, 32));
  const chunks = Array.from({ length: n }, () => []);
  items.forEach((it, i) => chunks[i % n].push(it));

  let done = 0;
  const results = [];
  const errors = [];
  await Promise.all(chunks.filter((c) => c.length).map((chunk) => new Promise((resolve) => {
    const w = new Worker(workerUrl, { workerData: { ...extra, files: chunk } });
    w.on('message', (msg) => {
      results.push(msg);
      done += chunk.length;
      onProgress?.(done, items.length);
    });
    w.on('error', (e) => {
      errors.push({ error: e.message, files: chunk.length });
      done += chunk.length;
      onProgress?.(done, items.length);
      resolve();
    });
    w.on('exit', () => resolve());
  })));
  return { results, errors };
}
