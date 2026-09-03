import { isEntryPointBasename } from '../entry-extensions.js';
import { dirname, resolvePath } from '../path/posix.js';

export type Alias = { prefix: string; anchor: string };

type WeldSettings = { baseUrl?: unknown; aliases?: unknown };

/**
 * Кэш разбора `settings.weld.aliases` по объекту `settings.weld`. Ключ — объект, а не
 * глобальный singleton: во flat config у разных файлов могут быть разные `settings`.
 */
const cache = new WeakMap<object, Alias[]>();

/**
 * Разбирает `settings.weld` в список алиасов. Формат записи совпадает с `paths` из tsconfig,
 * но нормализация и трактовка отличаются — см. таблицу в Technical Details плана.
 *
 * Отсутствие `settings.weld` даёт `[]` в обход кэша: кэшировать нечего, а `settings` без ключа
 * `weld` — не тот объект, который стоит держать живым в `WeakMap`.
 */
export function readAliases(settings: Record<string, unknown> | undefined, cwd: string): Alias[] {
    const weld = settings?.['weld'];
    if (weld === undefined || weld === null) {
        return [];
    }

    if (typeof weld !== 'object') {
        throw new Error(`weld/settings: "settings.weld" must be an object, got ${typeof weld}`);
    }

    const cached = cache.get(weld);
    if (cached !== undefined) {
        return cached;
    }

    const { baseUrl, aliases } = weld as WeldSettings;
    const base = resolvePath(cwd, typeof baseUrl === 'string' ? baseUrl : '.');
    const parsed = parseAliases(aliases, base);

    cache.set(weld, parsed);
    return parsed;
}

function parseAliases(aliases: unknown, base: string): Alias[] {
    if (aliases === undefined) {
        return [];
    }

    if (typeof aliases !== 'object' || aliases === null || Array.isArray(aliases)) {
        throw new Error(
            `weld/settings: "settings.weld.aliases" must be an object, got ${typeString(aliases)}`,
        );
    }

    const result: Alias[] = [];
    const seen = new Set<string>();

    for (const [key, value] of Object.entries(aliases)) {
        const anchors = normalizeAnchorsValue(key, value);

        for (const rawAnchor of anchors) {
            const entry = normalizeEntry(key, rawAnchor, base);
            if (entry === null) {
                continue;
            }

            const dedupeKey = `${entry.prefix}\u0000${entry.anchor}`;
            if (seen.has(dedupeKey)) {
                continue;
            }
            seen.add(dedupeKey);
            result.push(entry);
        }
    }

    return result;
}

/** Значение записи — строка (принимается как частая опечатка) либо массив строк. */
function normalizeAnchorsValue(key: string, value: unknown): string[] {
    if (typeof value === 'string') {
        return [value];
    }

    if (!Array.isArray(value)) {
        throw new Error(
            `weld/settings: value of "settings.weld.aliases.${key}" must be a string or an array of strings, got ${typeString(value)}`,
        );
    }

    for (const item of value) {
        if (typeof item !== 'string') {
            throw new Error(
                `weld/settings: elements of "settings.weld.aliases.${key}" must be strings, got ${typeString(item)}`,
            );
        }
    }

    return value as string[];
}

/**
 * Нормализует одну пару ключ/якорь в `Alias`. Возвращает `null`, если запись валидна, но
 * невыразима директорией (обычный файл в якоре) или отброшена сознательно (`'*'`, звёздочка
 * в середине).
 */
function normalizeEntry(key: string, rawAnchor: string, base: string): Alias | null {
    const prefix = stripStarSuffix(key);
    if (prefix === null) {
        return null;
    }

    // пустой префикс ('*') совпал бы с чем угодно, включая имена npm-пакетов — отсев
    // пакетов сломается молча, поэтому запись отбрасывается принудительно
    if (prefix === '') {
        return null;
    }

    const anchorTail = stripStarSuffix(rawAnchor);
    if (anchorTail === null) {
        return null;
    }

    const anchorPath = resolvePath(base, anchorTail);
    const anchor = toEntryPointDirectory(anchorPath);
    if (anchor === null) {
        return null;
    }

    return { prefix, anchor };
}

/**
 * Снимает хвост `/*` со строки. `null`, если звёздочка есть, но не в этой позиции —
 * такие формы (звёздочка в середине ключа или якоря) подстановкой префикса не выражаются.
 */
function stripStarSuffix(value: string): string | null {
    if (!value.includes('*')) {
        return value;
    }

    if (value.endsWith('/*') && !value.slice(0, -2).includes('*')) {
        return value.slice(0, -2);
    }

    return null;
}

/**
 * Якорь-файл вида `.../index.<ext>` выражает ту же директорию, что и якорь-директория —
 * базовое имя `index` с известным расширением сводится к `dirname`. Обычный файл (`config.ts`)
 * директорией не выражается: запись отбрасывается.
 */
function toEntryPointDirectory(path: string): string | null {
    const lastSlash = path.lastIndexOf('/');
    const basename = lastSlash === -1 ? path : path.slice(lastSlash + 1);

    if (!basename.includes('.')) {
        // нет расширения — трактуем как директорию как есть
        return path;
    }

    return isEntryPointBasename(basename) ? dirname(path) : null;
}

function typeString(value: unknown): string {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}
