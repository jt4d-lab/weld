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
 * - кэшировать успешный разбор алиасов и схемы;
 * - отдавать небросающие точки доступа для диагностического отчета `weld config`.
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
} from './weld.js';
/**
 * Схема слоев проекта: `srcDir`, `modulesDir`, `layers`, `moduleLayers` — уже проверенными и
 * разобранными. Метки `@modules` и `@unknown` описывают позиции в схеме, а не директории. Значением
 * слоя бывает только `UNKNOWN_MARKER`: это имя слоя, которого нет в схеме, и единственная метка,
 * которую потребителю есть с чем сравнивать. `@modules` в `layers` — метка места, а не слой.
 */
export type { RawScheme, Scheme, SchemeField, SchemeReport } from './layers.js';
export { parseSchemeReport, SCHEME_FIELDS, UNKNOWN_MARKER } from './layers.js';
/** Состояние значения в небросающих диагностических разборах слоя: `checkAliasesFormat`, `parseSchemeReport`. */
export type { SettingState } from './state.js';
