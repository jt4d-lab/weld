/**
 * Публичный интерфейс слоя: геттер на каждую настройку `settings.weld` и разобранный вид алиаса.
 *
 * Сырая секция `settings.weld`, её валидация и `parseAliases` остаются внутренним делом слоя:
 * формат конфига за границей `src/settings/` не знает никто.
 */

export type { Alias } from './aliases.js';
export { getAliases, getAliasesBaseUrl, getRepoRoot } from './weld.js';
