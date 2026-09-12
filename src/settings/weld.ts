/**
 * Единственная точка чтения `settings.weld`. Наружу слой отдаёт не сырую секцию, а геттер на каждую
 * настройку — `getRepoRoot` / `getAliasesBaseUrl` / `getAliases`; формат конфига за пределами
 * `src/settings/` не знает никто.
 *
 * Каждый геттер принимает необязательный `override` — значение этой настройки, подставляемое вместо
 * конфига. Оно тоже приходит из пользовательского конфига (опции правила), поэтому проверяется теми
 * же правилами, что и `settings.weld`; в сообщении об ошибке называется источник — `options.<имя>`
 * вместо `settings.weld.<имя>`.
 */

import type { Alias } from '@/settings/aliases.js';
import { parseAliases } from '@/settings/aliases.js';

/** `aliasesBaseUrl` по умолчанию — сам корень репозитория. */
const DEFAULT_ALIASES_BASE_URL = '.';

/** `settings.weld`, если задан. `undefined` без ошибки — секция необязательна. */
function getWeldSettings(settings: unknown): Record<string, unknown> | undefined {
    if (typeof settings !== 'object' || settings === null) {
        return undefined;
    }

    const weld = (settings as Record<string, unknown>).weld;
    if (weld === undefined) {
        return undefined;
    }

    if (typeof weld !== 'object' || weld === null) {
        throw new Error('settings.weld must be an object');
    }

    return weld as Record<string, unknown>;
}

function requireString(value: unknown, source: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${source} must be a string, got ${typeof value}`);
    }

    return value;
}

/**
 * `settings.weld.repoRoot` как он записан в конфиге — реальный путь, не виртуальный. Резолв
 * относительного значения и всё прочее знание о реальной ФС — за границей `src/host/`.
 * `undefined` — корень не задан, вызывающий ищет его сам.
 */
export function getRepoRoot(settings: unknown, override?: unknown): string | undefined {
    if (override !== undefined) {
        return requireString(override, 'options.repoRoot');
    }

    const repoRoot = getWeldSettings(settings)?.repoRoot;
    if (repoRoot === undefined) {
        return undefined;
    }

    return requireString(repoRoot, 'settings.weld.repoRoot');
}

/** `settings.weld.aliasesBaseUrl`; не задан — `'.'` (сам корень репозитория). */
export function getAliasesBaseUrl(settings: unknown, override?: unknown): string {
    if (override !== undefined) {
        return requireString(override, 'options.aliasesBaseUrl');
    }

    const aliasesBaseUrl = getWeldSettings(settings)?.aliasesBaseUrl;
    if (aliasesBaseUrl === undefined) {
        return DEFAULT_ALIASES_BASE_URL;
    }

    return requireString(aliasesBaseUrl, 'settings.weld.aliasesBaseUrl');
}

/**
 * Алиасы из `settings.weld`. Нет `aliases` — `[]`.
 *
 * `baseUrlOverride` — override той настройки, от которой отсчитываются якоря: алиасы без
 * `aliasesBaseUrl` переопределить нельзя, эти два значения имеют смысл только в паре.
 */
export function getAliases(
    settings: unknown,
    override?: unknown,
    baseUrlOverride?: unknown,
): Alias[] {
    const fromOverride = override !== undefined;
    const rawAliases = fromOverride ? override : getWeldSettings(settings)?.aliases;
    if (rawAliases === undefined) {
        return [];
    }

    const source = fromOverride ? 'options.aliases' : 'settings.weld.aliases';
    return parseAliases(rawAliases, getAliasesBaseUrl(settings, baseUrlOverride), source);
}
