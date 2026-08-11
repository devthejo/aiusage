import { listDirs } from '../util.js';
import { clineLikeRoots } from '../paths.js';
import { runPool } from '../pool.js';

/** Roo Code, Kilo Code et Cline partagent l'arborescence de tâches de Cline. */
export async function collectClineLike({ onProgress } = {}) {
  const groups = [];
  for (const { tool, editor, dir } of clineLikeRoots()) {
    const dirs = listDirs(dir);
    if (!dirs.length) continue;
    const { results, errors } = await runPool(
      new URL('../workers/cline.js', import.meta.url),
      dirs,
      { tool, editor },
      { onProgress: onProgress && ((d, t) => onProgress(`${tool} (${editor})`, d, t)) },
    );
    const tasks = results.flatMap((r) => r.records);
    groups.push({ tool, editor, dir, tasks, errors });
  }
  return groups;
}
