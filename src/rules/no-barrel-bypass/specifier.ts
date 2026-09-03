import { ENTRY_EXTENSIONS } from '../../entry-extensions.js';
import type { Alias } from '../../settings/aliases.js';
import { relativePath, resolvePath } from '../../path/posix.js';

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

/**
 * Формирует исправленный путь для найденной границы `barrier`, сохраняя форму записи
 * исходного импорта — см. раздел «Формирование исправленного пути» плана.
 *
 * Ветви (в порядке приоритета):
 * 1. `form.kind === 'relative'` → относительный путь от `fromDir` до `barrier`;
 * 2. алиас исходной формы покрывает `barrier` → тот же алиас;
 * 3. не покрывает → алиас с самым длинным якорем среди покрывающих `barrier`,
 *    выбранный из полного списка `aliases`, а не только из исходного;
 * 4. ни один алиас `barrier` не покрывает → откат на ветвь 1.
 */
export function renderSpecifier(
    form: Form,
    fromDir: string,
    barrier: string,
    aliases: Alias[],
): string {
    if (form.kind === 'alias' && coversDirectory(form.alias.anchor, barrier)) {
        return renderWithAlias(form.alias, barrier);
    }

    const covering = bestCoveringAlias(aliases, barrier);
    if (covering !== null) {
        return renderWithAlias(covering, barrier);
    }

    return renderRelative(fromDir, barrier);
}

/** Директория `anchor` покрывает `dir`, если они равны или `dir` лежит внутри `anchor`. */
function coversDirectory(anchor: string, dir: string): boolean {
    return dir === anchor || dir.startsWith(`${anchor}/`);
}

/** Среди покрывающих `dir` алиасов — тот, у которого самый длинный якорь. */
function bestCoveringAlias(aliases: Alias[], dir: string): Alias | null {
    let best: Alias | null = null;

    for (const alias of aliases) {
        if (!coversDirectory(alias.anchor, dir)) {
            continue;
        }

        if (best === null || alias.anchor.length > best.anchor.length) {
            best = alias;
        }
    }

    return best;
}

/** При `dir === anchor` — голый префикс без завершающего слэша. */
function renderWithAlias(alias: Alias, dir: string): string {
    const tail = dir.slice(alias.anchor.length);
    return alias.prefix + tail;
}

/**
 * Относительный путь с префиксом `./`, если результат `relativePath` сам по себе с точки
 * зрения синтаксиса импорта относительным специфаером не является. Директории вида
 * `.storybook` дают путь, начинающийся с точки, но это не префикс `./`/`../` — им нужен
 * свой добавленный `./` так же, как обычному имени.
 */
function renderRelative(fromDir: string, barrier: string): string {
    const path = relativePath(fromDir, barrier);
    if (path.startsWith('./') || path.startsWith('../')) {
        return path;
    }
    return `./${path}`;
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
