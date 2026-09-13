/**
 * Публичный интерфейс слоя: геттер на каждую настройку `settings.weld` и разобранный вид алиаса.
 *
 * Сырая секция `settings.weld` и её валидация остаются внутренним делом слоя: формат конфига за
 * границей `src/settings/` не знает никто. Сам разбор алиасов наружу выходит только под именем
 * `getAliasesFromPaths` — для разбора уже добытых кем-то `paths` tsconfig-формата.
 */

export type { Alias } from './aliases.js';
/**
 * Форма записи `paths`/`aliases`, которую примет разбор (`hasValidStarShape`: без `*` либо с
 * хвостом `/*`), и снятие этого хвоста (`stripStarSuffix`). Наружу выходят для потребителей,
 * которым нужно предсказать решение разбора, не запуская его, — например, расчёту root в
 * `src/tsconfig/` нельзя поднимать root ради якоря записи, которую разбор потом отбросит.
 */
export { hasValidStarShape, stripStarSuffix } from './aliases.js';
export {
    getAliases,
    getAliasesBaseUrl,
    getAliasesFromPaths,
    getRepoRoot,
    hasAliases,
} from './weld.js';
