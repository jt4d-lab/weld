/**
 * Соответствие «строка импорта ↔ виртуальный путь»: `parseSpecifier` разбирает специфаер в цель,
 * `renderSpecifier` собирает специфаер обратно в той же форме записи. Про барьеры, баррели и любое
 * другое правило слой не знает — это общая инфраструктура импортов.
 *
 * Строка импорта сама и есть путь: относительная резолвится от директории файла, алиасная —
 * подстановкой якоря. Резолвер не нужен — существование цели проверяет `import/no-unresolved`.
 */

import { entryFileName, isModuleExtension } from '@/extensions.js';
import { basename, relativePath, resolvePath, splitExtension } from '@/path/index.js';
import type { Alias } from '@/settings/index.js';

export type Form = { kind: 'relative' } | { kind: 'alias'; alias: Alias };

/**
 * `extension` — расширение, явно записанное в специфаере (без точки), либо `null`. Это факт про
 * форму записи, а не про диск: в TS-проекте под Node-ESM пишут `./x.js`, хотя на диске `x.ts`.
 */
export type Target = { path: string; form: Form; extension: string | null };

/**
 * `null`, если специфаер не выражает путь внутрь репозитория: голый пакет, `@scope/pkg`,
 * абсолютный специфаер, специфаер с `?`/`!`, последний сегмент с расширением вне
 * `MODULE_EXTENSIONS`, либо относительный подъём `..` выше виртуального корня.
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
        // `matchAlias` уже проверил границу по сегменту, поэтому хвост — либо пустой, либо `/…`;
        // ведущие слэши снимаются, чтобы `resolvePath` не принял хвост за абсолютный путь.
        const suffix = specifier.slice(alias.prefix.length).replace(/^\/+/, '');
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

/**
 * Самый длинный алиас, подходящий по `key`; `key` возвращает `null`, если алиас не подходит. При
 * равной длине побеждает первая запись по порядку объявления.
 */
function pickLongest(aliases: Alias[], key: (alias: Alias) => string | null): Alias | null {
    let best: Alias | null = null;
    let bestLength = -1;

    for (const alias of aliases) {
        const matched = key(alias);
        if (matched === null || matched.length <= bestLength) {
            continue;
        }
        best = alias;
        bestLength = matched.length;
    }

    return best;
}

/** Самый длинный подходящий префикс; при равных префиксах — первая запись по порядку. */
function matchAlias(specifier: string, aliases: Alias[]): Alias | null {
    return pickLongest(aliases, (alias) => (covers(alias.prefix, specifier) ? alias.prefix : null));
}

function finalize(path: string | null, form: Form): Target | null {
    if (path === null) {
        return null;
    }

    const { ext } = splitExtension(basename(path));
    if (ext !== '' && !isModuleExtension(ext)) {
        return null;
    }

    return { path, form, extension: ext === '' ? null : ext };
}

/**
 * Обратный рендер: директория `barrier` (граница) в специфаер в форме исходного импорта.
 * Форма выигрывает у пути цели — путь про форму записи ничего не знает.
 *
 * `extension` (расширение исходного специфаера) продолжает ту же логику: импорт с явным
 * расширением рендерится в `<barrier>/index.<ext>`, потому что там, где расширения обязательны
 * (Node-ESM), импорт голой директории не резолвится. Расширение берётся из исходного импорта, а не
 * с диска: в TS под Node-ESM на диске лежит `index.ts`, а писать полагается `index.js`.
 */
export function renderSpecifier(
    form: Form,
    fromDir: string,
    barrier: string,
    aliases: Alias[],
    extension: string | null = null,
): string {
    const dir = renderDirectory(form, fromDir, barrier, aliases);
    return extension === null ? dir : withEntry(dir, extension);
}

function renderDirectory(form: Form, fromDir: string, barrier: string, aliases: Alias[]): string {
    if (form.kind === 'relative') {
        return renderRelative(fromDir, barrier);
    }

    if (covers(form.alias.anchor, barrier)) {
        return renderAlias(form.alias, barrier);
    }

    const longest = longestCoveringAlias(aliases, barrier);
    return longest === null ? renderRelative(fromDir, barrier) : renderAlias(longest, barrier);
}

/** Дописывает точку входа к специфаеру директории, не удваивая `/`. */
function withEntry(dir: string, extension: string): string {
    const separator = dir.endsWith('/') ? '' : '/';
    return `${dir}${separator}${entryFileName(extension)}`;
}

/**
 * `value` равен `prefix` или лежит под ним — граница проверяется по сегменту, а не по символам
 * (`@/features` не покрывает `@/features-old`). Один вопрос на обе стороны алиаса: слева от него
 * так сопоставляется префикс со специфаером, справа — якорь с директорией.
 */
function covers(prefix: string, value: string): boolean {
    return value === prefix || value.startsWith(`${prefix}/`);
}

/** Самый длинный якорь, покрывающий `dir`; `null`, если ни один не покрывает. */
function longestCoveringAlias(aliases: Alias[], dir: string): Alias | null {
    return pickLongest(aliases, (alias) => (covers(alias.anchor, dir) ? alias.anchor : null));
}

function renderAlias(alias: Alias, barrier: string): string {
    if (barrier === alias.anchor) {
        return alias.prefix;
    }
    return `${alias.prefix}/${relativePath(alias.anchor, barrier)}`;
}

function renderRelative(fromDir: string, barrier: string): string {
    const rel = relativePath(fromDir, barrier);
    return rel.startsWith('./') || rel.startsWith('../') ? rel : `./${rel}`;
}
