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
    // Имя точки входа дописывается только при известном расширении: без него звездный алиас,
    // совпавший с якорем, дал бы нерезолвимый специфаер (голый `@`), и от такого алиаса лучше
    // отказаться в пользу относительного пути.
    const dir = renderDirectory(form, fromDir, barrier, aliases, extension !== null);
    return extension === null ? dir : withEntry(dir, extension);
}

/**
 * Итог обратного подбора алиаса: `specifier` — путь в алиасной форме, `needsFileName` — специфаер
 * неполон, к нему надо дописать имя файла.
 *
 * Дописать имя файла должен тот, кто файл знает, — поэтому решение выходит наружу готовым ответом, а
 * не парой низкоуровневых признаков, которые вызывающий складывал бы сам (см. `needsFileName`).
 */
export type AliasPath = {
    specifier: string;
    needsFileName: boolean;
};

/**
 * Обратный подбор алиаса по виртуальному пути: `target` → специфаер в алиасной форме. Нужен тем,
 * кто путь уже имеет и спрашивает, как он записывается в импорте (`weld inspect`), — в отличие от
 * `renderSpecifier`, где форму записи задает исходный импорт.
 *
 * Выигрывает самый длинный якорь, из которого получается резолвимый специфаер: точный ключ годится
 * только на самом якоре (см. `coversAsSpecifier`), поэтому путь ниже него достается более широкому
 * звездному алиасу. `null`, если не подошел ни один, — решение «что печатать вместо алиаса»
 * остается за вызывающим (виртуальный путь или относительный).
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

/**
 * `value` равен `prefix` или лежит под ним — граница проверяется по сегменту, а не по символам
 * (`@/features` не покрывает `@/features-old`).
 */
function coversPrefix(prefix: string, value: string): boolean {
    return value === prefix || value.startsWith(`${prefix}/`);
}

/**
 * Тот же вопрос, но про якорь, у которого есть случай, небывалый у префикса: якорь `/` (алиас на
 * корень репозитория) покрывает весь виртуальный путь. Без этого обратный рендер не находил бы такой
 * алиас никогда.
 *
 * Префиксу `/` это право не достается: специфаер с ведущим слэшем отсекается как `asset` еще до
 * сопоставления, поэтому единственное, что покрыл бы такой префикс, — чужой пакет (`react`), который
 * обязан остаться внешней зависимостью. Одно правило на обе стороны сделало бы его универсальным.
 */
function coversAnchor(anchor: string, value: string): boolean {
    return anchor === '/' || coversPrefix(anchor, value);
}

/**
 * Годится ли запись как источник специфаера — вопрос строже, чем `coversAnchor`, и общее правило
 * годности во всем обратном направлении: `renderAliasPath`, `renderSpecifier` и обе ветки
 * `renderDirectory`.
 *
 * Точный ключ (`paths: { '@/config': ['src/config'] }`) резолвит `@/config` и ничего ниже него:
 * `@/config/other.ts` TypeScript не находит (TS2307), хотя прямое сопоставление WELD читает любой
 * ключ префиксом. Поэтому в обратном рендере такая запись покрывает только свой якорь, а для пути
 * ниже поиск продолжается — более широкий звездный ключ (`@/*` → `src/*`) дает для него резолвимый
 * `@/config/other.ts`. Беззвездочный алиас на корень (`'@root': ['.']`) иначе покрывал бы весь
 * репозиторий и подменял резолвимый относительный путь нерезолвимым `@root/src/...`.
 *
 * Звездный ключ хвост подставляет, поэтому его якорь покрывает поддерево как обычно; неполноту
 * специфаера на самом якоре по-прежнему называет `needsFileName`.
 */
function coversAsSpecifier(alias: Alias, target: string): boolean {
    return coversAnchor(alias.anchor, target) && (alias.star || alias.anchor === target);
}

/**
 * То же, но с учетом того, допишется ли к результату имя файла. Звездный ключ ровно на своем якоре
 * без имени файла дает неспецифаер (см. `needsFileName`), поэтому такой якорь уступает более
 * широкому алиасу или относительному пути — как в `renderSpecifier` без расширения.
 */
function usableAsSpecifier(alias: Alias, target: string, canAddEntry: boolean): boolean {
    if (!coversAsSpecifier(alias, target)) {
        return false;
    }

    return canAddEntry || !needsFileName(alias, target);
}

/**
 * Неполон ли специфаер, который дает запись на этом пути: звездный ключ ровно на своем якоре не
 * резолвится без имени файла (голый `@`), и такая запись годится только там, где имя допишут.
 *
 * Признак считается здесь, а не на месте вызова: нужны оба факта сразу — путь совпал с якорем и ключ
 * звездный. У точного ключа (`@/config` → `src/config`) сам префикс — уже готовый специфаер.
 */
function needsFileName(alias: Alias, target: string): boolean {
    return alias.star && alias.anchor === target;
}

/** Самый длинный якорь, из которого получается резолвимый специфаер; `null`, если ни один. */
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
