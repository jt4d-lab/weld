/**
 * Единственная точка чтения `settings.weld`. Наружу слой отдаёт не сырую секцию, а геттер на каждую
 * настройку — `getRoot` / `getBaseUrl` / `getAliases`; формат конфига за пределами `src/settings/`
 * не знает никто.
 *
 * Каждый геттер принимает необязательный `override` — значение этой настройки, подставляемое вместо
 * конфига. Оно тоже приходит из пользовательского конфига (опции правила), поэтому проверяется теми
 * же правилами, что и `settings.weld`; в сообщении об ошибке называется источник — `options.<имя>`
 * вместо `settings.weld.<имя>`.
 */

import type { Alias } from '@/settings/aliases.js';
import { parseAliases } from '@/settings/aliases.js';

/** `baseUrl` по умолчанию — сам корень репозитория. */
const DEFAULT_BASE_URL = '.';

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
 * `settings.weld.root` как он записан в конфиге — реальный путь, не виртуальный. Резолв
 * относительного значения и всё прочее знание о реальной ФС — за границей `src/host/`.
 * `undefined` — root не задан, вызывающий ищет его сам.
 */
export function getRoot(settings: unknown, override?: unknown): string | undefined {
    if (override !== undefined) {
        return requireString(override, 'options.root');
    }

    const root = getWeldSettings(settings)?.root;
    if (root === undefined) {
        return undefined;
    }

    return requireString(root, 'settings.weld.root');
}

/** `settings.weld.baseUrl`; не задан — `'.'` (сам root). */
export function getBaseUrl(settings: unknown, override?: unknown): string {
    if (override !== undefined) {
        return requireString(override, 'options.baseUrl');
    }

    const baseUrl = getWeldSettings(settings)?.baseUrl;
    if (baseUrl === undefined) {
        return DEFAULT_BASE_URL;
    }

    return requireString(baseUrl, 'settings.weld.baseUrl');
}

/**
 * Алиасы из `settings.weld`. Нет `aliases` — `[]`.
 *
 * `baseUrlOverride` — override той настройки, от которой отсчитываются якоря: алиасы без `baseUrl`
 * переопределить нельзя, эти два значения имеют смысл только в паре.
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
    return parseAliases(rawAliases, getBaseUrl(settings, baseUrlOverride), source);
}
