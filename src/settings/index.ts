/**
 * Слой читает, валидирует и предоставляет типизированный доступ к одному источнику настроек WELD —
 * `settings.weld`, скрывая его формат от остальных частей приложения. Он не собирает эффективную
 * конфигурацию из разных источников: это задача `src/config/`.
 *
 * Задачи:
 * - получать настройки корня репозитория, базы алиасов и имени tsconfig;
 * - разбирать и валидировать алиасы из `settings.weld` и внешних `paths`;
 * - различать явно заданные алиасы, включая пустой объект;
 * - кэшировать успешный разбор алиасов и публиковать его результат;
 * - отдавать небросающие точки доступа для диагностического отчета `weld config`.
 */

export type { Alias } from './aliases.js';
/**
 * Форма записи `paths`/`aliases`, которую примет разбор (`hasValidStarShape`: без `*` либо с
 * хвостом `/*`), и снятие этого хвоста (`stripStarSuffix`). Наружу выходят для потребителей,
 * которым нужно предсказать решение разбора, не запуская его, — например, расчету root в
 * `src/tsconfig/` нельзя поднимать root ради якоря записи, которую разбор потом отбросит.
 */
export { checkAliasesFormat, hasValidStarShape, stripStarSuffix } from './aliases.js';
export {
    getAliases,
    getAliasesBaseUrl,
    getAliasesFromPaths,
    getAliasesRaw,
    getRepoRoot,
    getSectionError,
    getTsconfigName,
    hasAliases,
    resetSettingsCaches,
} from './weld.js';
/** Состояние значения в небросающих диагностических разборах слоя: `checkAliasesFormat` и отчет `src/config/`. */
export type { SettingState } from './state.js';
