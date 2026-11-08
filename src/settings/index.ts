/**
 * Слой читает, валидирует и предоставляет типизированный доступ к одному источнику настроек WELD —
 * `settings.weld`, скрывая его формат от остальных частей приложения. Он не собирает эффективную
 * конфигурацию из разных источников: это задача `src/config/`.
 *
 * Задачи:
 * - получать настройки корня репозитория, базы алиасов и имени tsconfig;
 * - отдавать схему слоев одним разобранным объектом: пять ее полей проверяются только вместе;
 * - разбирать и валидировать алиасы из `settings.weld` и внешних `paths`;
 * - различать явно заданные алиасы, включая пустой объект;
 * - кэшировать успешный разбор алиасов и схемы.
 */

export type { Alias } from './aliases.js';
export { checkAliasesFormat, hasValidStarShape, stripStarSuffix } from './aliases.js';
export {
    getAliases,
    getAliasesBaseUrl,
    getAliasesFromPaths,
    getAliasesRaw,
    getRepoRoot,
    getScheme,
    getSchemeRaw,
    getSectionError,
    getTsconfigName,
    hasAliases,
    resetSettingsCaches,
    schemeSourceOf,
} from './weld.js';
export type { SchemeOverrides } from './weld.js';
export type { RawScheme, Scheme, SchemeField, SchemeReport } from './layers.js';
export { parseSchemeReport, SCHEME_FIELDS, UNKNOWN_MARKER } from './layers.js';
export type { SettingState } from './state.js';
