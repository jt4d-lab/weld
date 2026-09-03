import { ENTRY_EXTENSIONS } from '../../entry-extensions.js';
import type { Alias } from '../../settings/aliases.js';
import { resolvePath } from '../../path/posix.js';

export type Form = { kind: 'relative' } | { kind: 'alias'; alias: Alias };
export type Target = { path: string; form: Form };

/**
 * Разбирает строку импорта в абсолютный путь цели и форму записи. Возвращает `null` для
 * специфаеров, по которым `findBarrier`/`renderSpecifier` не могут дать осмысленный результат —
 * см. раздел «Что отсекается на входе» плана.
 */
export function parseSpecifier(
    specifier: string,
    fromDir: string,
    aliases: Alias[],
): Target | null {
    if (specifier.includes('?') || specifier.includes('!')) {
        return null;
    }

    if (!hasAllowedLastSegmentExtension(specifier)) {
        return null;
    }

    if (isRelativeSpecifier(specifier)) {
        return { path: resolvePath(fromDir, specifier), form: { kind: 'relative' } };
    }

    if (isAbsoluteSpecifier(specifier)) {
        return null;
    }

    const alias = matchAlias(specifier, aliases);
    if (alias === null) {
        // ни относительный, ни абсолютный, ни один алиас не подошёл — голый пакет или
        // @scope/pkg: node_modules этим правилом не резолвится
        return null;
    }

    const tail = specifier.slice(alias.prefix.length);
    const path = alias.anchor + tail;
    return { path, form: { kind: 'alias', alias } };
}

function isRelativeSpecifier(specifier: string): boolean {
    return (
        specifier === '.' ||
        specifier === '..' ||
        specifier.startsWith('./') ||
        specifier.startsWith('../')
    );
}

/**
 * Абсолютный специфаер (`/foo`) — форма вывода для него не определена, поэтому он отсекается
 * до сопоставления с алиасами: без этой проверки он мог бы случайно попасть под алиас с пустым
 * префиксом, если бы такие не отбрасывались `readAliases` отдельно.
 */
function isAbsoluteSpecifier(specifier: string): boolean {
    return specifier.startsWith('/');
}

/** Самый длинный подходящий префикс; при равных длинах — первая запись по порядку объявления. */
function matchAlias(specifier: string, aliases: Alias[]): Alias | null {
    let best: Alias | null = null;

    for (const alias of aliases) {
        if (!matchesPrefix(specifier, alias.prefix)) {
            continue;
        }

        if (best === null || alias.prefix.length > best.prefix.length) {
            best = alias;
        }
    }

    return best;
}

/** Специфаер подходит под запись, если равен префиксу или начинается с `prefix + '/'`. */
function matchesPrefix(specifier: string, prefix: string): boolean {
    return specifier === prefix || specifier.startsWith(`${prefix}/`);
}

/**
 * Последний сегмент пути с расширением вне `ENTRY_EXTENSIONS` (`.css`, `.svg`, …) отсекается:
 * баррель не может реэкспортировать не-JS ресурс, поэтому правка была бы невыполнимой. Сегмент
 * без расширения вовсе (`./x`) не отсекается — расширение неизвестно до резолва, которым это
 * правило сознательно не занимается.
 */
function hasAllowedLastSegmentExtension(specifier: string): boolean {
    const lastSlash = specifier.lastIndexOf('/');
    const lastSegment = lastSlash === -1 ? specifier : specifier.slice(lastSlash + 1);

    if (lastSegment === '.' || lastSegment === '..') {
        // сегменты навигации, не имена файлов — расширению взяться неоткуда
        return true;
    }

    const dotIndex = lastSegment.lastIndexOf('.');
    if (dotIndex <= 0) {
        // нет расширения, либо точка — первый символ сегмента (например ".storybook"
        // как последний сегмент): такой сегмент не рассматривается как файл с расширением
        return true;
    }

    const extension = lastSegment.slice(dotIndex + 1);
    return (ENTRY_EXTENSIONS as readonly string[]).includes(extension);
}
