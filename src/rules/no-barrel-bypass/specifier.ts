/**
 * Разбор строки импорта в абсолютный путь цели и форму записи.
 *
 * Строка импорта сама и есть путь: относительная резолвится от директории файла, алиасная —
 * подстановкой якоря. Резолвер не нужен — существование цели проверяет `import/no-unresolved`.
 */

import { isEntryExtension } from '../../entry-extensions.js';
import { relativePath, resolvePath } from '../../path/posix.js';
import type { Alias } from '../../settings/aliases.js';

export type Form = { kind: 'relative' } | { kind: 'alias'; alias: Alias };
export type Target = { path: string; form: Form };

/**
 * `null`, если специфаер не выражает путь внутрь проекта: голый пакет, `@scope/pkg`, абсолютный
 * специфаер, специфаер с `?`/`!`, либо последний сегмент с расширением вне `ENTRY_EXTENSIONS`.
 */
export function parseSpecifier(
    specifier: string,
    fromDir: string,
    aliases: Alias[],
): Target | null {
    if (specifier.includes('?') || specifier.includes('!')) {
        return null;
    }

    if (isRelativeSpecifier(specifier)) {
        return finalize(resolvePath(fromDir, specifier), { kind: 'relative' });
    }

    const alias = matchAlias(specifier, aliases);
    if (alias !== null) {
        const suffix = specifier === alias.prefix ? '' : specifier.slice(alias.prefix.length + 1);
        return finalize(resolvePath(alias.anchor, suffix), { kind: 'alias', alias });
    }

    return null;
}

function isRelativeSpecifier(specifier: string): boolean {
    return (
        specifier === '.' ||
        specifier === '..' ||
        specifier.startsWith('./') ||
        specifier.startsWith('../')
    );
}

/** Самый длинный подходящий префикс; при равных префиксах — первая запись по порядку. */
function matchAlias(specifier: string, aliases: Alias[]): Alias | null {
    let best: Alias | null = null;

    for (const alias of aliases) {
        const matches = specifier === alias.prefix || specifier.startsWith(`${alias.prefix}/`);
        if (!matches) {
            continue;
        }
        if (best === null || alias.prefix.length > best.prefix.length) {
            best = alias;
        }
    }

    return best;
}

function finalize(path: string, form: Form): Target | null {
    return hasDisallowedExtension(path) ? null : { path, form };
}

function hasDisallowedExtension(path: string): boolean {
    const last = path.slice(path.lastIndexOf('/') + 1);
    const match = /\.([^./]+)$/.exec(last);
    if (!match) {
        return false;
    }

    const ext = match[1] as string;
    return !isEntryExtension(ext);
}

/**
 * Обратный рендер: граница `barrier` (директория) в специфаер в форме исходного импорта.
 * Форма выигрывает у пути цели — путь про форму записи ничего не знает.
 */
export function renderSpecifier(
    form: Form,
    fromDir: string,
    barrier: string,
    aliases: Alias[],
): string {
    if (form.kind === 'relative') {
        return renderRelative(fromDir, barrier);
    }

    if (coversDirectory(form.alias.anchor, barrier)) {
        return renderAlias(form.alias, barrier);
    }

    const covering = aliases.filter((alias) => coversDirectory(alias.anchor, barrier));
    if (covering.length === 0) {
        return renderRelative(fromDir, barrier);
    }

    const longest = covering.reduce((best, alias) =>
        alias.anchor.length > best.anchor.length ? alias : best,
    );
    return renderAlias(longest, barrier);
}

function coversDirectory(anchor: string, dir: string): boolean {
    return dir === anchor || dir.startsWith(`${anchor}/`);
}

function renderAlias(alias: Alias, barrier: string): string {
    if (barrier === alias.anchor) {
        return alias.prefix;
    }
    return `${alias.prefix}/${relativePath(alias.anchor, barrier)}`;
}

function renderRelative(fromDir: string, barrier: string): string {
    const rel = relativePath(fromDir, barrier);
    return rel.startsWith('../') ? rel : `./${rel}`;
}
