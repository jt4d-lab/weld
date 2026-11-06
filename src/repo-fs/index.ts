/**
 * Каркас доступа к файловой системе: единственное место в пакете, знающее реальные пути (буквы
 * дисков, `\`, относительность к `cwd`) и корень репозитория. Наружу отдает `FsHost` — работу только
 * с виртуальными posix-путями от корня (`/src/feature/x.ts`).
 *
 * `createFakeFsHost` в барреле намеренно: подделка нужна тестам других слоев. В бандл она не
 * попадает — `src/index.ts` ее не импортирует.
 */

export type { FsHost } from './fs.js';
export { createFsHost, getFsHost, resetFsHostCaches, resolveRoot } from './fs.js';
export { createFakeFsHost } from './fs.testing.js';
export { findRepoRoot } from './root.js';
