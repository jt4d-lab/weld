/**
 * Единственная точка чтения `settings.weld`. Наружу слой отдает не сырую секцию, а геттер на каждую
 * настройку — `getRepoRoot` / `getAliasesBaseUrl` / `getAliases` / `getTsconfigName` / `getScheme`;
 * формат конфига за пределами `src/settings/` не знает никто.
 *
 * Схема слоев — исключение из правила «геттер на настройку»: поля проверяются вместе (метка
 * `@modules` и `moduleLayers` задаются парой, имена не повторяются между списками), поэтому она
 * отдается одним разобранным объектом.
 *
 * Каждый геттер принимает необязательный `override` — значение этой настройки, подставляемое вместо
 * конфига. Оно тоже приходит из пользовательского конфига (опции правила), поэтому проверяется теми
 * же правилами, что и `settings.weld`; в сообщении об ошибке называется источник — `options.<имя>`
 * вместо `settings.weld.<имя>`.
 *
 * Здесь же живет кэш разобранных настроек, поэтому и второй вход в разбор алиасов — `paths` из
 * tsconfig (`getAliasesFromPaths`) — идет отсюда: решение «алиасы разбираются один раз на конфиг»
 * должно быть одно на оба источника.
 */

import type { Alias } from '@/settings/aliases.js';
import { parseAliases } from '@/settings/aliases.js';
import type { RawScheme, Scheme, SchemeField } from '@/settings/layers.js';
import { SCHEME_FIELDS, parseScheme } from '@/settings/layers.js';

/** `aliasesBaseUrl` по умолчанию — сам корень репозитория. */
const DEFAULT_ALIASES_BASE_URL = '.';
const DEFAULT_TSCONFIG_NAME = 'tsconfig.json';

/** Значения по умолчанию полей схемы: у списков нет дефолта, `flatModules` — `false`. */
const SCHEME_DEFAULTS: Partial<Record<SchemeField, string | boolean>> = {
    srcDir: 'src',
    modulesDir: 'modules',
    flatModules: false,
};

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

/** `settings.weld.tsconfig`; не задан — `'tsconfig.json'`. */
export function getTsconfigName(settings: unknown, override?: unknown): string {
    if (override !== undefined) {
        return requireString(override, 'options.tsconfig');
    }

    const tsconfig = getWeldSettings(settings)?.tsconfig;
    if (tsconfig === undefined) {
        return DEFAULT_TSCONFIG_NAME;
    }

    return requireString(tsconfig, 'settings.weld.tsconfig');
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
 * TTL записи кэша настроек. Минута: сравнение по ссылке само по себе корректно (конфиг ESLint в
 * рамках прогона неизменен), поэтому TTL здесь не про свежесть ответа, а про то, чтобы записи не
 * жили вечно — иначе перечитанный конфиг языкового сервера навсегда оставлял бы в кэше и старый
 * объект `settings`, и разобранные по нему значения. Протухание посреди прогона ничего не стоит:
 * цена промаха — один разбор, десятки микросекунд.
 */
const TTL_MS = 60_000;

/** Запись кэша: ключ — аргументы разбора, сравниваемые по ссылке. */
type CacheEntry<T> = { key: readonly unknown[]; result: T; expiresAt: number };

function sameKey(left: readonly unknown[], right: readonly unknown[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Фабрика кэша разборов настроек: правило спрашивает их на каждый линтуемый файл, а аргументы
 * приходят те же — в flat config объект `settings` у всех файлов одного конфиг-блока один и тот же,
 * опции правила тоже, а `paths` tsconfig отдает по ссылке кэш `src/tsconfig/`. Попадание избавляет
 * от повторного разбора и от повторного `debug`-лога о нем.
 *
 * Список с линейным поиском, а не `Map`: ключ здесь — набор ссылок, строкового ключа у него нет, а
 * собирать его пришлось бы обходом тех же значений. Записей при этом единицы — по одной на
 * конфиг-блок ESLint.
 *
 * Запоминается только успешный разбор: на сломанном конфиге ESLint должен ругаться на каждом
 * файле, а не на первом. Протухшие записи выбрасываются на промахе, а не по таймеру: кэш растет
 * только на промахах, на промахе же и чистится.
 */
function createParseCache<T>(): (key: readonly unknown[], parse: () => T) => T {
    let entries: CacheEntry<T>[] = [];

    return (key, parse) => {
        const time = Date.now();
        for (const entry of entries) {
            if (entry.expiresAt > time && sameKey(entry.key, key)) {
                return entry.result;
            }
        }

        const result = parse();
        entries = entries.filter((entry) => entry.expiresAt > time && !sameKey(entry.key, key));
        entries.push({ key, result, expiresAt: time + TTL_MS });
        return result;
    };
}

/** Кэш алиасов, общий на оба источника: `settings.weld.aliases` и `paths` tsconfig. */
let cachedAliases = createParseCache<Alias[]>();

/** Кэш схем слоев. */
let cachedScheme = createParseCache<Scheme>();

/** Сброс кэшей — шов для тестов. */
export function resetSettingsCaches(): void {
    cachedAliases = createParseCache<Alias[]>();
    cachedScheme = createParseCache<Scheme>();
}

/**
 * Алиасы из `settings.weld`. Нет `aliases` — `[]`.
 *
 * `baseUrlOverride` — override той настройки, от которой отсчитываются якоря: алиасы без
 * `aliasesBaseUrl` переопределить нельзя, эти два значения имеют смысл только в паре.
 *
 * Результат берется из кэша (см. {@link createParseCache}), поэтому при попадании возвращается тот
 * же массив, что и в прошлый раз — считается он неизменяемым, потребители его только читают.
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
 * (реальный путь tsconfig). На кривых значениях завершается ошибкой так же, как разбор
 * `settings.weld.aliases`, — решение обрабатывать ошибку или прерывать выполнение принадлежит
 * вызывающему.
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

/** Поля схемы, заданные опциями правила: каждое целиком перекрывает одноименную настройку. */
export type SchemeOverrides = { [Field in SchemeField]?: unknown };

/**
 * Схема слоев: `settings.weld` с подстановкой опций правила.
 *
 * Отсутствующая или кривая схема — исключение, а не пустой результат: спрашивающий схему не может
 * без нее работать. Проверка происходит именно здесь, по запросу, — потребители, которым схема не
 * нужна (алиасы, корень), ее не читают и на сломанной схеме не падают.
 *
 * Результат берется из кэша (см. {@link createParseCache}), поэтому при попадании возвращается тот
 * же объект, что и в прошлый раз — считается он неизменяемым, потребители его только читают.
 */
export function getScheme(settings: unknown, overrides: SchemeOverrides = {}): Scheme {
    return cachedScheme([settings, ...SCHEME_FIELDS.map((field) => overrides[field])], () =>
        readScheme(settings, overrides),
    );
}

function readScheme(settings: unknown, overrides: SchemeOverrides): Scheme {
    // Секция читается, пока хоть одно поле схемы может быть взято из нее; при полном
    // перекрытии опциями секция не читается.
    const section = SCHEME_FIELDS.some((field) => overrides[field] === undefined)
        ? getWeldSettings(settings)
        : undefined;

    return parseScheme(
        Object.fromEntries(
            SCHEME_FIELDS.map((field) => [
                field,
                overrides[field] !== undefined
                    ? overrides[field]
                    : pickSchemeValue(section, field, SCHEME_DEFAULTS[field]),
            ]),
        ) as RawScheme,
        schemeSourceOf(overrides),
    );
}

/**
 * Источник значения поля схемы в сообщениях об ошибках: опция правила или секция `settings.weld`.
 * Один источник формулировки на оба пути — `getScheme` и отчет `report.ts`.
 */
export function schemeSourceOf(overrides: SchemeOverrides) {
    return (field: SchemeField) =>
        overrides[field] !== undefined ? `options.${field}` : `settings.weld.${field}`;
}

/** Значение поля секции с дефолтом: одно правило на оба пути — `readScheme` и `getSchemeRaw`. */
function pickSchemeValue(
    section: Record<string, unknown> | undefined,
    field: SchemeField,
    fallback?: string | boolean,
): unknown {
    const configured = section?.[field];
    return configured === undefined ? fallback : configured;
}

export function getSectionError(settings: unknown): string | null {
    try {
        getWeldSettings(settings);
        return null;
    } catch (error) {
        return (error as Error).message;
    }
}

/**
 * Сырые значения полей схемы из `settings.weld` с подстановкой дефолтов (`srcDir`, `modulesDir`)
 * — диагностическая точка доступа для отчета `report.ts`. `null` — секция невалидна и поля без
 * override прочитать нельзя: отчет помечает их `unresolved`, а опции разбирает самостоятельно.
 */
export function getSchemeRaw(settings: unknown): RawScheme | null {
    if (getSectionError(settings) !== null) {
        return null;
    }

    const section = getWeldSettings(settings);

    // Дефолты — из `SCHEME_DEFAULTS`: то же правило, что в `readScheme`.
    return Object.fromEntries(
        SCHEME_FIELDS.map((field) => [
            field,
            pickSchemeValue(section, field, SCHEME_DEFAULTS[field]),
        ]),
    ) as RawScheme;
}

/** Зовется только когда `getSectionError` вернул `null`. */
export function getAliasesRaw(settings: unknown): unknown {
    return getWeldSettings(settings)?.aliases;
}
