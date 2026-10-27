/**
 * Команда `weld inspect`: что за файл и как он записывается в импорте. Резолв эффективной
 * конфигурации — тот же, что у правил (`src/config/`), поэтому алиасы здесь ровно те, которые
 * увидит линтер, а не похожий на них разбор.
 *
 * Модуль не знает ни про ESLint (настройки приходят готовыми), ни про вывод: он отдает данные в
 * одной форме, а `program.ts` печатает их текстом или JSON. Разница форм — только в отсутствующем
 * алиасе: в тексте на его месте печатается виртуальный путь, в JSON — `null`, чтобы машинный
 * потребитель отличал «алиаса нет» от «алиас совпал с виртуальным путем».
 */

import { resolveForFile } from '@/config/index.js';
import { isEntryFileName } from '@/extensions.js';
import type { AliasPath } from '@/imports/index.js';
import { renderAliasPath } from '@/imports/index.js';
import { basename, dirname, splitExtension } from '@/path/index.js';

import type { LintSettings } from './eslint-config.js';
import { virtualPathOf } from './target.js';

type InspectResult = {
    /** Реальный путь файла. */
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

/**
 * Путь файла и путь импорта по алиасу. Директория — ошибка: `inspect` спрашивает про конкретный
 * файл, а `loadLintSettings` для директории отдает сэмпл, который к вопросу отношения не имеет.
 */
export function inspectFile(lint: LintSettings, cwd: string): InspectResult {
    if (lint.sampleOf !== undefined) {
        throw new Error(`expected a file, got a directory: ${lint.sampleOf}`);
    }

    const target = resolveForFile({
        filename: lint.filePath,
        settings: lint.settings,
        cwd,
        options: lint.options,
    });
    const fromFile = virtualPathOf(target, lint.filePath);

    // `index.<ext>` — это и есть модуль директории: в импорте он записывается ею самой.
    const virtualPath = collapseEntryPoint(fromFile);
    const rendered = renderAliasPath(virtualPath, target.getAliases());

    return {
        file: lint.filePath,
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
 * Специфаер, который действительно резолвится. Алиас, совпавший с самим якорем, — еще не специфаер,
 * если ключ записи звездный: у `@/feature/*` → `src/feature/*` звездочке нечего подставить, поэтому
 * хвостом становится имя самого файла (`@/feature/index.ts`) — ровно то, чем модуль записывается в
 * импорте. У точного ключа (`@/config` → `src/config`) все наоборот: специфаером становится сам
 * префикс, и дописывать к нему ничего нельзя — `@/config/index.ts` такой записью уже не покрывается
 * (TypeScript резолвит `@/config`, а `@/config/index.ts` — нет). Различие знает `src/settings/`
 * (признак `star` в `Alias`), а готовым ответом его отдает `renderAliasPath` (`needsFileName`),
 * поэтому здесь не надо гадать по строке.
 *
 * Имя берется из виртуального пути (`fromFile`), а не из `lint.filePath`: `basename` в `@/path` —
 * posix-функция над виртуальными путями, а реальный путь на Windows пришел бы с `\` и попал в
 * специфаер целиком (`@/C:\repo\src\index.ts`).
 */
function withEntryName(rendered: AliasPath, virtualPath: string): string {
    if (!rendered.needsFileName) {
        return rendered.specifier;
    }

    const separator = rendered.specifier.endsWith('/') ? '' : '/';
    return `${rendered.specifier}${separator}${basename(virtualPath)}`;
}
