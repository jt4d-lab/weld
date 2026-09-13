/**
 * Единственная точка чтения `settings.weld`. Наружу слой отдаёт не сырую секцию, а геттер на каждую
 * настройку — `getRepoRoot` / `getAliasesBaseUrl` / `getAliases`; формат конфига за пределами
 * `src/settings/` не знает никто.
 *
 * Каждый геттер принимает необязательный `override` — значение этой настройки, подставляемое вместо
 * конфига. Оно тоже приходит из пользовательского конфига (опции правила), поэтому проверяется теми
 * же правилами, что и `settings.weld`; в сообщении об ошибке называется источник — `options.<имя>`
 * вместо `settings.weld.<имя>`.
 *
 * Здесь же живёт кэш разобранных алиасов, поэтому и второй вход в тот же разбор — `paths` из
 * tsconfig (`getAliasesFromPaths`) — идёт отсюда: решение «алиасы разбираются один раз на конфиг»
 * должно быть одно на оба источника.
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

function readAliases(settings: unknown, override: unknown, baseUrlOverride: unknown): Alias[] {
    const fromOverride = override !== undefined;
    const rawAliases = fromOverride ? override : getWeldSettings(settings)?.aliases;
    if (rawAliases === undefined) {
        return [];
    }

    const source = fromOverride ? 'options.aliases' : 'settings.weld.aliases';
    return parseAliases(rawAliases, getAliasesBaseUrl(settings, baseUrlOverride), source);
}

/**
 * TTL записи кэша алиасов. Минута: сравнение по ссылке само по себе корректно (конфиг ESLint в
 * рамках прогона неизменен), поэтому TTL здесь не про свежесть ответа, а про то, чтобы записи не
 * жили вечно — иначе перечитанный конфиг языкового сервера навсегда оставлял бы в кэше и старый
 * объект `settings`, и разобранные по нему алиасы. Протухание посреди прогона ничего не стоит:
 * цена промаха — один разбор `paths`, десятки микросекунд.
 */
const TTL_MS = 60_000;

/** Ключ записи — тройка аргументов разбора, сравниваемых по ссылке. */
type AliasesCacheKey = readonly [unknown, unknown, unknown];

type AliasesCacheEntry = { key: AliasesCacheKey; result: Alias[]; expiresAt: number };

/**
 * Кэш разобранных алиасов, общий на оба источника (`settings.weld.aliases` и `paths` tsconfig):
 * правило спрашивает алиасы на каждый линтуемый файл, а аргументы приходят те же — в flat config
 * объект `settings` у всех файлов одного конфиг-блока один и тот же, опции правила тоже, а `paths`
 * отдаёт по ссылке кэш `src/tsconfig/`. Попадание избавляет от повторного разбора `paths` и от
 * повторного `debug`-лога о нём.
 *
 * Список с линейным поиском, а не `Map`: ключ здесь — тройка ссылок, строкового ключа у неё нет, а
 * собирать его пришлось бы обходом тех же `paths`. Записей при этом единицы — по одной на
 * конфиг-блок ESLint.
 */
let aliasesCache: AliasesCacheEntry[] = [];

function sameKey(left: AliasesCacheKey, right: AliasesCacheKey): boolean {
    return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

/**
 * Разбор через кэш. Запоминается только успешный разбор: на сломанном конфиге ESLint должен
 * ругаться на каждом файле, а не на первом. Протухшие записи выбрасываются здесь, а не по таймеру:
 * кэш растёт только на промахах, на промахе же и чистится.
 */
function cachedAliases(key: AliasesCacheKey, parse: () => Alias[]): Alias[] {
    const time = Date.now();
    for (const entry of aliasesCache) {
        if (entry.expiresAt > time && sameKey(entry.key, key)) {
            return entry.result;
        }
    }

    const result = parse();
    aliasesCache = aliasesCache.filter(
        (entry) => entry.expiresAt > time && !sameKey(entry.key, key),
    );
    aliasesCache.push({ key, result, expiresAt: time + TTL_MS });
    return result;
}

/**
 * Алиасы из `settings.weld`. Нет `aliases` — `[]`.
 *
 * `baseUrlOverride` — override той настройки, от которой отсчитываются якоря: алиасы без
 * `aliasesBaseUrl` переопределить нельзя, эти два значения имеют смысл только в паре.
 *
 * Результат берётся из кэша (см. {@link aliasesCache}), поэтому при попадании возвращается тот же
 * массив, что и в прошлый раз — считается он неизменяемым, потребители его только читают.
 */
export function getAliases(
    settings: unknown,
    override?: unknown,
    baseUrlOverride?: unknown,
): Alias[] {
    return cachedAliases([settings, override, baseUrlOverride], () =>
        readAliases(settings, override, baseUrlOverride),
    );
}

/**
 * Разбор внешних `paths` (формат `compilerOptions.paths` из tsconfig) в `Alias[]` — те же правила и
 * тот же кэш, что у `settings.weld.aliases`. Параметры: сами `paths`, виртуальная директория, от
 * которой отсчитываются записи, и `source` — имя источника значения в сообщениях об ошибках
 * (реальный путь tsconfig). На кривых значениях бросает так же, как разбор `settings.weld.aliases`,
 * — решение «глотать или падать» принадлежит вызывающему.
 */
export function getAliasesFromPaths(paths: unknown, virtualBase: string, source: string): Alias[] {
    return cachedAliases([paths, virtualBase, source], () =>
        parseAliases(paths, virtualBase, source),
    );
}

/**
 * Заданы ли алиасы явно — в `options.aliases` (`override`) или в `settings.weld.aliases`.
 * «Заданы» — это присутствие ключа: пустой `{}` тоже считается (и выключает автопоиск tsconfig).
 * При заданном `override` секция `settings` не читается — как в геттерах.
 */
export function hasAliases(settings: unknown, override?: unknown): boolean {
    if (override !== undefined) {
        return true;
    }

    return getWeldSettings(settings)?.aliases !== undefined;
}
