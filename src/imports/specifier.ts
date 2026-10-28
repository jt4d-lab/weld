/**
 * Соответствие «строка импорта ↔ виртуальный путь»: `parseSpecifier` разбирает специфаер в цель
 * или в причину пропуска, `renderSpecifier` собирает специфаер обратно в той же форме записи. Про
 * барьеры, баррели и любое другое правило слой не знает — это общая инфраструктура импортов.
 *
 * Строка импорта сама и есть путь: относительная резолвится от директории файла, алиасная —
 * подстановкой якоря.
 */

import { entryFileName, isAssetExtension, isModuleExtension } from '@/extensions.js';
import { basename, relativePath, resolvePath, splitExtension } from '@/path/index.js';
import type { Alias } from '@/settings/index.js';

export type Form = { kind: 'relative' } | { kind: 'alias'; alias: Alias };

/**
 * `extension` — расширение, явно записанное в специфаере (без точки), либо `null`. Это факт про
 * форму записи, а не про диск: в TS-проекте под Node-ESM пишут `./x.js`, хотя на диске `x.ts`.
 */
export type Target = { path: string; form: Form; extension: string | null };

export type SpecifierSkip = 'asset' | 'external-dependency' | 'out-of-repo' | 'no-module-found';

/**
 * Итог разбора: `target` — цель для проверки, `skip` — причина, по которой проверять нечего.
 */
export type ParseResult =
    { kind: 'target'; target: Target } | { kind: 'skip'; reason: SpecifierSkip };

/**
 * `resolve` — «виртуальный путь → виртуальный путь модуля»; нужен для специфаера, расширение
 * которого нет ни среди модульных, ни среди ассетных (`./account.entity`). Вернув `null`, резолвер
 * говорит, что модуля по такому пути нет.
 */
export function parseSpecifier(
    specifier: string,
    fromDir: string,
    aliases: Alias[],
    resolve: (path: string) => string | null,
): ParseResult {
    if (specifier.startsWith('/') || specifier.includes('?') || specifier.includes('!')) {
        return skip('asset');
    }

    if (isRelativeSpecifier(specifier)) {
        return finalize(resolvePath(fromDir, specifier), { kind: 'relative' }, resolve);
    }

    const alias = matchAlias(specifier, aliases);
    if (alias !== null) {
        // `matchAlias` уже проверил границу по сегменту, поэтому хвост — либо пустой, либо `/…`;
        // ведущие слэши снимаются, чтобы `resolvePath` не принял хвост за абсолютный путь.
        const suffix = specifier.slice(alias.prefix.length).replace(/^\/+/, '');
        return finalize(resolvePath(alias.anchor, suffix), { kind: 'alias', alias }, resolve);
    }

    return skip('external-dependency');
}

function skip(reason: SpecifierSkip): ParseResult {
    return { kind: 'skip', reason };
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
    return pickLongest(aliases, (alias) =>
        coversPrefix(alias.prefix, specifier) ? alias.prefix : null,
    );
}

function finalize(
    path: string | null,
    form: Form,
    resolve: (path: string) => string | null,
): ParseResult {
    if (path === null) {
        return skip('out-of-repo');
    }

    const { ext } = splitExtension(basename(path));

    if (ext === '') {
        return target(path, form, null);
    }

    if (isModuleExtension(ext)) {
        return target(path, form, ext);
    }

    if (isAssetExtension(ext)) {
        return skip('asset');
    }

    const resolved = resolve(path);
    if (resolved === null) {
        return skip('no-module-found');
    }

    return target(resolved, form, null);
}

function target(path: string, form: Form, extension: string | null): ParseResult {
    return { kind: 'target', target: { path, form, extension } };
}

/**
 * Обратный рендер: директория `barrier` (граница) в специфаер в форме исходного импорта.
 * Форма выигрывает у пути цели — путь про форму записи ничего не знает.
 *
 * `extension` (расширение исходного специфаера) продолжает ту же логику: импорт с явным
 * расширением рендерится в `<barrier>/index.<ext>`, потому что там, где расширения обязательны
 * (Node-ESM), импорт голой директории не резолвится. Расширение берется из исходного импорта, а не
 * с диска: в TS под Node-ESM на диске лежит `index.ts`, а писать полагается `index.js`.
 */
export function renderSpecifier(
    form: Form,
    fromDir: string,
    barrier: string,
    aliases: Alias[],
    extension: string | null = null,
): string {
    const dir = renderDirectory(form, fromDir, barrier, aliases, extension !== null);
    return extension === null ? dir : withEntry(dir, extension);
}

/**
 * Итог обратного подбора алиаса: `specifier` — путь в алиасной форме, `needsFileName` — специфаер
 * неполон, к нему надо дописать имя файла.
 */
export type AliasPath = {
    specifier: string;
    needsFileName: boolean;
};

/**
 * Обратный подбор алиаса по виртуальному пути: `target` → специфаер в алиасной форме. `null` — ни
 * один алиас не подошел; что печатать вместо алиаса, решает вызывающий.
 */
export function renderAliasPath(target: string, aliases: Alias[]): AliasPath | null {
    // `canAddEntry: true` — неполный специфаер здесь годится: имя файла допишет вызывающий.
    const alias = longestCoveringAlias(aliases, target, true);

    if (alias === null) {
        return null;
    }

    return {
        specifier: renderAlias(alias, target),
        needsFileName: needsFileName(alias, target),
    };
}

/**
 * `canAddEntry` — допишется ли к специфаеру имя точки входа (`@/index.ts`): от этого зависит,
 * годится ли звездный алиас, совпавший с якорем.
 */
function renderDirectory(
    form: Form,
    fromDir: string,
    barrier: string,
    aliases: Alias[],
    canAddEntry: boolean,
): string {
    if (form.kind === 'relative') {
        return renderRelative(fromDir, barrier);
    }

    if (usableAsSpecifier(form.alias, barrier, canAddEntry)) {
        return renderAlias(form.alias, barrier);
    }

    const longest = longestCoveringAlias(aliases, barrier, canAddEntry);
    return longest === null ? renderRelative(fromDir, barrier) : renderAlias(longest, barrier);
}

/** Дописывает точку входа к специфаеру директории, не удваивая `/`. */
function withEntry(dir: string, extension: string): string {
    const separator = dir.endsWith('/') ? '' : '/';
    return `${dir}${separator}${entryFileName(extension)}`;
}

/** `value` равен `prefix` или лежит под ним — граница проверяется по сегменту, а не по символам. */
function coversPrefix(prefix: string, value: string): boolean {
    return value === prefix || value.startsWith(`${prefix}/`);
}

/** Якорь `/` (алиас на корень репозитория) покрывает весь виртуальный путь. */
function coversAnchor(anchor: string, value: string): boolean {
    return anchor === '/' || coversPrefix(anchor, value);
}

/** Точный ключ покрывает только свой якорь, звездный — поддерево. */
function coversAsSpecifier(alias: Alias, target: string): boolean {
    return coversAnchor(alias.anchor, target) && (alias.star || alias.anchor === target);
}

function usableAsSpecifier(alias: Alias, target: string, canAddEntry: boolean): boolean {
    if (!coversAsSpecifier(alias, target)) {
        return false;
    }

    return canAddEntry || !needsFileName(alias, target);
}

/** Звездный ключ ровно на своем якоре не резолвится без имени файла (голый `@`). */
function needsFileName(alias: Alias, target: string): boolean {
    return alias.star && alias.anchor === target;
}

function longestCoveringAlias(
    aliases: Alias[],
    target: string,
    canAddEntry: boolean,
): Alias | null {
    return pickLongest(aliases, (alias) =>
        usableAsSpecifier(alias, target, canAddEntry) ? alias.anchor : null,
    );
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
