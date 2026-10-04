/**
 * `resetTsconfigCache` выходит наружу для чужих тестов, задевающих автопоиск (по образцу
 * `resetFsHostCaches` из `src/host/`). Швы `now`/`read` — нет: они только для тестов самого слоя.
 */

export type { TsconfigPaths } from './load.js';
export { loadTsconfigPaths, resetTsconfigCache } from './load.js';
