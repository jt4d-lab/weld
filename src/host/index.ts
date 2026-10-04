/**
 * Фейки из `fs.testing.ts` выходят наружу через баррель осознанно: подделка `FsHost` нужна
 * именно чужим тестам (правила, `src/rules/context.ts`), то есть внешним потребителям слоя, а
 * приватность в WELD закрывает как раз от них. Прятать фейк за `_` значило бы, что до него никто
 * не дотянется. В бандл он не попадает: `src/index.ts` его не импортирует.
 */

export type { FsHost } from './fs.js';
export { createFsHost, getFsHost, resetFsHostCaches } from './fs.js';
export { createFakeFsHost } from './fs.testing.js';
export { findRepoRoot } from './root.js';
