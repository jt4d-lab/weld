/** Команда `weld inspect`: что за файл и как он записывается в импорте. */

import { resolveForFile } from '@/config/index.js';
import { isEntryFileName } from '@/extensions.js';
import type { AliasPath } from '@/imports/index.js';
import { renderAliasPath } from '@/imports/index.js';
import { basename, dirname, splitExtension } from '@/path/index.js';

import type { LintSettings } from './eslint-config.js';
import { repoPath, repoRootOf, virtualPathOf } from './target.js';

type InspectResult = {
    /** Путь файла от корня репозитория (вне корня — абсолютный). */
    file: string;
    /** Виртуальный путь модуля: `index.<ext>` схлопнут, алиас не подставлен. */
    virtualPath: string;
    /** Путь импорта по алиасу; `null` — ни один алиас файл не покрывает. */
    alias: string | null;
};

/**
 * Данные текстового вывода `weld inspect`. `alias` — уже готовый к печати путь импорта: алиас, а
 * если файл не покрыт ни одним алиасом, то виртуальный путь. Машинная форма собирается отдельно:
 * `alias: null` там отличает «алиаса нет» от «алиас совпал с виртуальным путем».
 */
export type InspectData = {
    file: string;
    alias: string;
};

/** Директория — ошибка: `inspect` спрашивает про конкретный файл. `shownPath` попадает в сообщение. */
export function inspectFile(lint: LintSettings, cwd: string, shownPath: string): InspectResult {
    if (lint.sampleOf !== undefined) {
        throw new Error(`expected a file, got a directory: ${lint.sampleOf}`);
    }

    const target = resolveForFile({
        filename: lint.filePath,
        settings: lint.settings,
        cwd,
        options: lint.options,
    });
    const fromFile = virtualPathOf(target, shownPath);

    const virtualPath = collapseEntryPoint(fromFile);
    const rendered = renderAliasPath(virtualPath, target.getAliases());

    return {
        file: repoPath(repoRootOf(target, shownPath), lint.filePath),
        virtualPath,
        alias: rendered === null ? null : withEntryName(rendered, fromFile),
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
