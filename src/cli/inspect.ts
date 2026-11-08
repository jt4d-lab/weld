/** Команда `weld inspect`: что за файл, как он записывается в импорте и где он в схеме слоев. */

import { resolveForFile } from '@/config/index.js';
import { isEntryFileName } from '@/extensions.js';
import type { AliasPath } from '@/imports/index.js';
import { renderAliasPath } from '@/imports/index.js';
import { locateFile, renderModuleName } from '@/layers/index.js';
import { basename, dirname, splitExtension } from '@/path/index.js';

import type { LintSettings } from './eslint-config.js';
import { repoPath, repoRootOf, virtualPathOf } from './target.js';

export class InspectConfigError extends Error {
    constructor(cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause), { cause });
    }
}

function readConfig<T>(read: () => T): T {
    try {
        return read();
    } catch (error) {
        throw new InspectConfigError(error);
    }
}

/** Метаданные файла в схеме слоев: общая часть текстового вывода и JSON. */
type MetaFields = {
    /** Имя модуля: `@root` либо цепочка через `::`. */
    module: string;
    /** Имя слоя либо `@unknown`. */
    layer: string;
    /** Путь от корня слоя, а при `@unknown` — от корня модуля. */
    innerPath: string;
};

/**
 * Данные `weld inspect`.
 *
 * `alias: null` — алиаса нет, и тогда текстовая форма печатает `virtualPath`, а JSON оставляет
 * `null`. Машинная форма — тот же объект без `virtualPath` (`inspectJson`).
 */
export type InspectData = MetaFields & {
    file: string;
    alias: string | null;
    /** Виртуальный путь модуля — для текстовой формы при `alias: null`. */
    virtualPath: string;
};

/** Машинная форма `weld inspect`: `InspectData` без `virtualPath`, который нужен только тексту. */
export function inspectJson(data: InspectData): Record<string, unknown> {
    return {
        file: data.file,
        alias: data.alias,
        module: data.module,
        layer: data.layer,
        innerPath: data.innerPath,
    };
}

/**
 * Данные `weld inspect` для одного файла.
 *
 * Директория — ошибка: `inspect` спрашивает про конкретный файл. Схема слоев запрашивается здесь,
 * поэтому без нее (или с кривой) `inspect` завершается ошибкой, а потребители, которым схема не
 * нужна, ее не читают. Метаданные считаются по исходному виртуальному пути: схлопывание точки
 * входа нужно только для алиаса.
 *
 * @param cwd База для относительных аргументов.
 * @param shownPath Аргумент в том виде, как его ввели: попадает в текст ошибки.
 */
export function inspectFile(lint: LintSettings, cwd: string, shownPath: string): InspectData {
    if (lint.sampleOf !== undefined) {
        throw new Error(`expected a file, got a directory: ${lint.sampleOf}`);
    }

    const target = resolveForFile({
        filename: lint.filePath,
        settings: lint.settings,
        cwd,
        options: lint.options,
    });
    const fromFile = virtualPathOf(
        readConfig(() => target.getFromFile()),
        shownPath,
    );
    const located = locateFile(
        fromFile,
        readConfig(() => target.getScheme()),
        shownPath,
    );

    const virtualPath = collapseEntryPoint(fromFile);
    const rendered = renderAliasPath(
        virtualPath,
        readConfig(() => target.getAliases()),
    );

    return {
        file: repoPath(
            readConfig(() => repoRootOf(target, shownPath)),
            lint.filePath,
        ),
        // `null` — алиаса нет: текстовая форма подставит `virtualPath`, JSON оставит `null`.
        alias: rendered === null ? null : withEntryName(rendered, fromFile),
        virtualPath,
        module: renderModuleName(located.module),
        layer: located.layer,
        innerPath: located.innerPath,
    };
}

/** `…/feature/index.ts` → `…/feature`; всё остальное — как есть. */
function collapseEntryPoint(path: string): string {
    const { name, ext } = splitExtension(basename(path));
    if (!isEntryFileName(name, ext)) {
        return path;
    }

    // Корень репозитория — не модуль: `/` специфаером не бывает, поэтому `index.<ext>` у корня
    // остается собой.
    const dir = dirname(path);
    return dir === '/' ? path : dir;
}

/**
 * Специфаер, который действительно резолвится: у звездного ключа на самом якоре хвостом становится
 * имя файла, у точного ключа специфаером становится сам префикс.
 *
 * Имя берется из виртуального пути (`fromFile`), а не из `lint.filePath`: `basename` в `@/path` —
 * posix-функция, а реальный путь на Windows пришел бы с `\`.
 */
function withEntryName(rendered: AliasPath, virtualPath: string): string {
    if (!rendered.needsFileName) {
        return rendered.specifier;
    }

    const separator = rendered.specifier.endsWith('/') ? '' : '/';
    return `${rendered.specifier}${separator}${basename(virtualPath)}`;
}
