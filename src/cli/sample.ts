/**
 * Работа с диском в CLI: `stat` без исключения и поиск сэмпла в директории — единственное место
 * слоя, которое само ходит по файловой системе. Обход не знает ни про ESLint, ни про WELD: предикат
 * для файла приходит от вызывающего, и вызывающий же получает ответ, — поэтому сэмплом может стать
 * что угодно (сейчас это конфиг ESLint).
 *
 * Отдельный модуль, потому что у `eslint-config.ts` другая работа — загрузка `eslint` из проекта и
 * чтение его конфига; обход директории с бюджетом и фильтрами к ней не относится.
 */

import type { Dirent, Stats } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { isModuleExtension } from '@/extensions.js';

/**
 * Предел обхода директории: `weld config <директория>` ищет сэмпл, а не просматривает весь
 * монорепозиторий. Дойдя до предела, команда говорит об этом прямо, а не выдает «нет файлов».
 */
const MAX_VISITED_ENTRIES = 5000;

/** Текст ошибки для сообщения пользователю: что бы ни бросили, в строку. */
export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** `ENOENT`/`ENOTDIR` — обычный ответ «пути нет»; остальные ошибки ФС молча глотать нельзя. */
function isMissingPathError(error: unknown): boolean {
    const code = (error as { code?: unknown }).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}

/** `stat` без исключения для отсутствующего пути: «его нет» — обычный ответ, а не падение. */
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

/** Директории, в которые обход не заходит: `node_modules` и всё скрытое (`.git` и прочее). */
function isSkippedDir(name: string): boolean {
    return name === 'node_modules' || name.startsWith('.');
}

/** Сравнение по имени — обход обязан быть алфавитным, а не в порядке, в котором отдаст ФС. */
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
 * Файл, о котором стоит спросить вызывающего. `Dirent.isFile()` не считает файлом симлинк, поэтому
 * ссылка проверяется по `stat` (он за ссылку переходит), как и явный аргумент команды: иначе проект,
 * где исходники лежат на диске ссылками, получал бы «нет линтуемых файлов», хотя `weld inspect` тот
 * же файл принимает. Ссылки на директории обход по-прежнему не разворачивает.
 */
function isLintableFile(entry: Dirent, full: string): boolean {
    if (!isModuleExtension(extname(entry.name).slice(1))) {
        return false;
    }

    return entry.isFile() || (entry.isSymbolicLink() && statOf(full)?.isFile() === true);
}

/** Найденный сэмпл: путь файла и ответ предиката на него. */
type Sample<T> = {
    filePath: string;
    result: T;
};

/**
 * Первый в алфавитном порядке файл директории, для которого `lookup` вернул значение. Файлы, на
 * которые `lookup` ответил `undefined`, пропускаются: сэмплом должен быть файл, который вызывающий
 * действительно обрабатывает.
 */
export async function findSample<T>(
    dir: string,
    shownPath: string,
    lookup: (filePath: string) => Promise<T | undefined>,
): Promise<Sample<T> | null> {
    return findSampleWithin(dir, shownPath, lookup, { left: MAX_VISITED_ENTRIES });
}

/** Сколько записей директории еще можно посмотреть — общий бюджет на весь обход. */
type Budget = { left: number };

async function findSampleWithin<T>(
    dir: string,
    shownPath: string,
    lookup: (filePath: string) => Promise<T | undefined>,
    budget: Budget,
): Promise<Sample<T> | null> {
    for (const entry of readEntries(dir)) {
        budget.left -= 1;

        if (budget.left < 0) {
            throw new Error(
                `no lintable files in ${shownPath} (stopped after ${MAX_VISITED_ENTRIES} entries)`,
            );
        }

        const full = join(dir, entry.name);

        if (entry.isDirectory()) {
            if (isSkippedDir(entry.name)) {
                continue;
            }

            const nested = await findSampleWithin(full, shownPath, lookup, budget);
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
