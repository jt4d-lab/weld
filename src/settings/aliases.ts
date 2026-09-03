import { isEntryExtension } from '../entry-extensions.js';
import { resolvePath } from '../path/posix.js';

export type Alias = { prefix: string; anchor: string };

const cache = new WeakMap<object, Alias[]>();

/**
 * Разбирает `settings.weld` (формат `paths` из tsconfig) в список алиасов, готовых для
 * `parseSpecifier`/`renderSpecifier`. Нет `settings.weld` — сразу `[]`, минуя кэш.
 */
export function readAliases(settings: unknown, cwd: string): Alias[] {
    const weld = getWeldSettings(settings);
    if (weld === undefined) {
        return [];
    }

    const cached = cache.get(weld);
    if (cached !== undefined) {
        return cached;
    }

    const result = parseAliases(weld, cwd);
    cache.set(weld, result);
    return result;
}

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

function parseAliases(weld: Record<string, unknown>, cwd: string): Alias[] {
    const rawAliases = weld.aliases;
    if (rawAliases === undefined) {
        return [];
    }
    if (typeof rawAliases !== 'object' || rawAliases === null || Array.isArray(rawAliases)) {
        throw new Error('settings.weld.aliases must be an object');
    }

    const baseUrl = weld.baseUrl;
    const base = resolvePath(cwd, typeof baseUrl === 'string' ? baseUrl : '.');

    const result: Alias[] = [];
    const seen = new Set<string>();

    for (const [key, rawValue] of Object.entries(rawAliases)) {
        const anchorsRaw = toAnchorList(key, rawValue);
        if (!hasValidStarShape(key)) {
            continue;
        }
        const prefix = stripStarSuffix(key);

        for (const anchorRaw of anchorsRaw) {
            if (!hasValidStarShape(anchorRaw)) {
                continue;
            }
            const anchor = normalizeAnchor(anchorRaw, base);
            if (anchor === null) {
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

    return result;
}

function toAnchorList(key: string, value: unknown): string[] {
    if (typeof value === 'string') {
        return [value];
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            if (typeof item !== 'string') {
                throw new Error(`settings.weld.aliases['${key}'] must contain only strings`);
            }
        }
        return value as string[];
    }

    throw new Error(`settings.weld.aliases['${key}'] must be a string or an array of strings`);
}

/** Принимаются только записи без `*` или оканчивающиеся на `/*`; звёздочка в середине — отбрасывается. */
function hasValidStarShape(value: string): boolean {
    const starCount = value.split('*').length - 1;
    if (starCount === 0) {
        return true;
    }

    return starCount === 1 && value.endsWith('/*');
}

function stripStarSuffix(value: string): string {
    return value.endsWith('/*') ? value.slice(0, -2) : value;
}

/**
 * Директория, которую обозначает запись `paths`. `null`, если запись — обычный файл
 * (не `index.<известное расширение>`) и директорией не выражается.
 */
function normalizeAnchor(anchorRaw: string, base: string): string | null {
    if (anchorRaw.endsWith('/*')) {
        return resolvePath(base, anchorRaw.slice(0, -2));
    }

    const segments = anchorRaw.split('/');
    const last = segments[segments.length - 1] ?? '';
    const extMatch = /\.([^./]+)$/.exec(last);

    if (!extMatch) {
        return resolvePath(base, anchorRaw);
    }

    const ext = extMatch[1] as string;
    const name = last.slice(0, -(ext.length + 1));
    if (name !== 'index' || !isEntryExtension(ext)) {
        return null;
    }

    return resolvePath(base, segments.slice(0, -1).join('/'));
}
