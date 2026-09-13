/**
 * Публичный интерфейс слоя: `loadTsconfigPaths` и тип его результата, плюс кэш-сброс
 * (`resetTsconfigCache`) — он нужен чужим тестам, задевающим автопоиск (по образцу
 * `resetFsHostCaches` из `src/host/`). Швы `now`/`read` наружу не выходят — они только для тестов
 * самого слоя.
 */

export type { TsconfigPaths } from './load.js';
export { loadTsconfigPaths, resetTsconfigCache } from './load.js';
