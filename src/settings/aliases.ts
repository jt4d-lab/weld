import { createLogger } from '@/debug.js';
import { isEntryFileName } from '@/extensions.js';
import { basename, resolvePath, splitExtension } from '@/path/index.js';

const debug = createLogger('aliases');

export type Alias = { prefix: string; anchor: string };

/**
 * Разбирает значение `settings.weld.aliases` (формат `paths` из tsconfig) в список алиасов, готовых
 * для `parseSpecifier`/`renderSpecifier`. Обе настройки приходят уже добытыми — читает их
 * `src/settings/weld.ts`; он же решает, что делать с отсутствующей настройкой, поэтому `undefined`
 * сюда не доходит. `<base>` — виртуальный путь от корня репозитория, не от `cwd`: `baseUrl`
 * отсчитывается от root. `source` называет место значения в конфиге в сообщениях об ошибках.
 */
export function parseAliases(rawAliases: unknown, baseUrl: string, source: string): Alias[] {
    if (typeof rawAliases !== 'object' || rawAliases === null || Array.isArray(rawAliases)) {
        throw new Error(`${source} must be an object`);
    }

    const base = resolvePath('/', baseUrl) ?? '/';

    const result: Alias[] = [];
    const seen = new Set<string>();

    for (const [key, rawValue] of Object.entries(rawAliases)) {
        if (!hasValidStarShape(key)) {
            debug('%s: dropped %s — key must have no "*" or end with "/*"', source, key);
            continue;
        }
        const anchorsRaw = toAnchorList(key, rawValue, source);
        const prefix = stripStarSuffix(key);

        for (const anchorRaw of anchorsRaw) {
            if (!hasValidStarShape(anchorRaw)) {
                debug(
                    '%s: dropped %s -> %s — target must have no "*" or end with "/*"',
                    source,
                    key,
                    anchorRaw,
                );
                continue;
            }
            const anchor = normalizeAnchor(anchorRaw, base);
            if (anchor === null) {
                debug(
                    '%s: dropped %s -> %s — not a directory (only index.<ext> stands for one) or above the repository root',
                    source,
                    key,
                    anchorRaw,
                );
                continue;
            }

            const dedupeKey = `${prefix}\0${anchor}`;
            if (seen.has(dedupeKey)) {
                continue;
            }
            seen.add(dedupeKey);
            result.push({ prefix, anchor });
        }
    }

    if (debug.enabled) {
        debug(`${source} (baseUrl ${baseUrl}) resolved to:\n${formatAliases(result)}`);
    }
    return result;
}

/** Для debug: по строке на алиас, `<префикс> - <якорь>`. Пустой список — явным словом. */
function formatAliases(aliases: Alias[]): string {
    if (aliases.length === 0) {
        return '(none)';
    }

    return aliases.map(({ prefix, anchor }) => `${prefix} - ${anchor}`).join('\n');
}

/** Значение записи `paths`: строка (частая опечатка) или массив строк. */
function toAnchorList(key: string, value: unknown, source: string): string[] {
    if (typeof value === 'string') {
        return [value];
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            if (typeof item !== 'string') {
                throw new Error(`${source}['${key}'] must contain only strings`);
            }
        }
        return value as string[];
    }

    throw new Error(`${source}['${key}'] must be a string or an array of strings`);
}

/**
 * Принимаются только записи без `*` или оканчивающиеся на `/*`; звёздочка в середине —
 * отбрасывается. `/*` тоже отбрасывается: `stripStarSuffix` дал бы пустой префикс/якорь, а пустая
 * строка — префикс любого абсолютного специфайера (`''` + `/` — начало любого `/foo`), из-за чего
 * запись стала бы вести себя как алиас на абсолютные пути, которые правило не обрабатывает.
 */
function hasValidStarShape(value: string): boolean {
    const starCount = value.split('*').length - 1;
    if (starCount > 1 || (starCount === 1 && !value.endsWith('/*'))) {
        return false;
    }

    return stripStarSuffix(value) !== '';
}

function stripStarSuffix(value: string): string {
    return value.endsWith('/*') ? value.slice(0, -2) : value;
}

/**
 * Директория, которую обозначает запись `paths`. `null`, если запись — обычный файл
 * (не `index.<известное расширение>`) и директорией не выражается, либо якорь уходит `..`-подъёмом
 * выше виртуального корня.
 */
function normalizeAnchor(anchorRaw: string, base: string): string | null {
    if (anchorRaw.endsWith('/*')) {
        return resolvePath(base, anchorRaw.slice(0, -2));
    }

    const lastSegment = basename(anchorRaw);
    const { name, ext } = splitExtension(lastSegment);

    if (ext === '') {
        return resolvePath(base, anchorRaw);
    }

    if (!isEntryFileName(name, ext)) {
        return null;
    }

    // Директория записи — сам `anchorRaw` без последнего сегмента; хвостовой `/` `resolvePath` съедает.
    return resolvePath(base, anchorRaw.slice(0, -lastSegment.length));
}
