/**
 * Команда `weld inspect`: что за файл и как он записывается в импорте. Резолв эффективной
 * конфигурации — тот же, что у правил (`src/config/`), поэтому алиасы здесь ровно те, которые
 * увидит линтер, а не похожий на них разбор.
 *
 * Модуль не знает ни про ESLint (настройки приходят готовыми), ни про вывод: он отдает данные в
 * двух формах — для текста и для `--json`, — а печатает их `program.ts`. Формы различаются: в тексте
 * при отсутствии алиаса печатается виртуальный путь, в JSON — `null`, чтобы машинный потребитель
 * отличал «алиаса нет» от «алиас совпал с виртуальным путем».
 */

import { resolveForFile } from '@/config/index.js';
import { isEntryFileName } from '@/extensions.js';
import { renderAliasPath } from '@/imports/index.js';
import { basename, dirname, splitExtension } from '@/path/index.js';

import type { LintSettings } from './eslint-config.js';
import type { InspectData } from './render.js';

export type InspectResult = {
    /** Текстовая форма: `alias` — алиас, а если файл не покрыт ни одним, то виртуальный путь. */
    data: InspectData;
    /** Машинная форма: `null` — алиаса нет. */
    alias: string | null;
};

/**
 * Путь файла и путь импорта по алиасу. Директория — ошибка: `inspect` спрашивает про конкретный
 * файл, а `loadLintSettings` для директории отдает сэмпл, который к вопросу отношения не имеет.
 */
export function inspectFile(lint: LintSettings, cwd: string): InspectResult {
    if (lint.sampleOf !== undefined) {
        throw new Error(`expected a file, got a directory: ${lint.sampleOf}`);
    }

    const target = resolveForFile({ filename: lint.filePath, settings: lint.settings, cwd });
    const fromFile = target.getFromFile();

    if (fromFile === null) {
        throw new Error(`${lint.filePath} is outside the repository root`);
    }

    // `index.<ext>` — это и есть модуль директории: в импорте он записывается ею самой.
    const modulePath = collapseEntryPoint(fromFile);
    const alias = renderAliasPath(modulePath, target.getAliases());

    return {
        data: { file: lint.filePath, alias: alias ?? modulePath },
        alias,
    };
}

/** `…/feature/index.ts` → `…/feature`; всё остальное — как есть. */
function collapseEntryPoint(path: string): string {
    const { name, ext } = splitExtension(basename(path));
    return isEntryFileName(name, ext) ? dirname(path) : path;
}
