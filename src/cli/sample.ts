/** Работа с диском в CLI: `stat` без исключения и обход директории за сэмплом. */

import type { Dirent, Stats } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { isModuleExtension } from '@/extensions.js';

/** Предел обхода директории: `weld config <директория>` ищет сэмпл, а не весь монорепозиторий. */
const MAX_VISITED_ENTRIES = 5000;

export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** `ENOENT`/`ENOTDIR` — обычный ответ «пути нет»; остальные ошибки ФС молча глотать нельзя. */
function isMissingPathError(error: unknown): boolean {
    const code = (error as { code?: unknown }).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

/** `stat` без исключения для отсутствующего пути. */
export function statOf(path: string): Stats | null {
    try {
        return statSync(path);
    } catch (error) {
        if (isMissingPathError(error)) {
            return null;
        }

        throw new Error(`cannot read ${path}: ${messageOf(error)}`, { cause: error });
    }
}

function isSkippedDir(name: string): boolean {
    return name === 'node_modules' || name.startsWith('.');
}

function byName(a: { name: string }, b: { name: string }): number {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Записи директории по алфавиту; нечитаемая директория — ошибка, а не «файлов нет». */
function readEntries(dir: string): Dirent[] {
    try {
        return readdirSync(dir, { withFileTypes: true }).sort(byName);
    } catch (error) {
        throw new Error(`cannot read directory ${dir}: ${messageOf(error)}`, { cause: error });
    }
}

/**
 * Файл, о котором стоит спросить вызывающего: `Dirent.isFile()` не считает файлом симлинк, поэтому
 * ссылка проверяется по `stat`.
 */
function isLintableFile(entry: Dirent, full: string): boolean {
    if (!isModuleExtension(extname(entry.name).slice(1))) {
        return false;
    }

    return entry.isFile() || (entry.isSymbolicLink() && statOf(full)?.isFile() === true);
}

/** Найденный сэмпл: путь файла и ответ предиката на него. */
export type Sample<T> = {
    filePath: string;
    result: T;
};

/**
 * Первый в алфавитном порядке файл директории, для которого `lookup` вернул значение.
 *
 * `remembered` — годный, но не лучший кандидат: если обход уперся в предел записей, отвечаем им, а не
 * ошибкой. Параметр обязателен: пустой ответ по умолчанию отключал бы это правило молча.
 */
export async function findSample<T>(
    dir: string,
    shownPath: string,
    lookup: (filePath: string) => Promise<T | undefined>,
    remembered: () => Sample<T> | null,
): Promise<Sample<T> | null> {
    return findSampleWithin(dir, shownPath, lookup, remembered, { left: MAX_VISITED_ENTRIES });
}

/** Сколько записей директории еще можно посмотреть — общий бюджет на весь обход. */
type Budget = { left: number };

async function findSampleWithin<T>(
    dir: string,
    shownPath: string,
    lookup: (filePath: string) => Promise<T | undefined>,
    remembered: () => Sample<T> | null,
    budget: Budget,
): Promise<Sample<T> | null> {
    for (const entry of readEntries(dir)) {
        budget.left -= 1;

        if (budget.left < 0) {
            const sample = remembered();

            if (sample !== null) {
                return sample;
            }

            throw new Error(
                `no lintable files in ${shownPath} (stopped after ${MAX_VISITED_ENTRIES} entries)`,
            );
        }

        const full = join(dir, entry.name);

        if (entry.isDirectory()) {
            if (isSkippedDir(entry.name)) {
                continue;
            }

            const nested = await findSampleWithin(full, shownPath, lookup, remembered, budget);
            if (nested !== null) {
                return nested;
            }

            continue;
        }

        if (!isLintableFile(entry, full)) {
            continue;
        }

        const result = await lookup(full);
        if (result !== undefined) {
            return { filePath: full, result };
        }
    }

    return null;
}
