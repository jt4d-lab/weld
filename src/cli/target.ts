/**
 * Общее у команд: части резолва, которые нужны обеим, форма путей в выводе и единый текст отказа.
 * Внутренняя часть слоя — команды берут части отсюда, а `program.ts` про этот модуль не знает.
 *
 * `weld inspect` и `weld config` спрашивают у резолва разное, но файл вне корня репозитория — один и
 * тот же отказ, и сообщение о нем должно быть одно: это одна причина, а не две похожие.
 */

import { isAbsolute, relative, sep } from 'node:path';

import type { WeldTarget } from '@/config/index.js';

/**
 * Виртуальный путь файла — то, от чего `inspect` считает путь модуля. Заодно это проверка «файл
 * внутри корня»: `null` у резолва означает, что виртуального пути нет, и показывать нечего.
 */
export function virtualPathOf(target: WeldTarget, filePath: string): string {
    const fromFile = target.getFromFile();

    if (fromFile === null) {
        throw new Error(`${filePath} is outside the repository root`);
    }

    return fromFile;
}

/**
 * Тот же отказ, но без виртуального пути: `weld config` его не печатает, а проверка «файл внутри
 * корня» нужна ему так же, как `inspect`.
 */
export function assertInsideRoot(target: WeldTarget, filePath: string): void {
    virtualPathOf(target, filePath);
}

/**
 * Реальный корень репозитория. `null` резолв отдает только поддельному `FsHost` — шов, которым CLI не
 * пользуется; проверка нужна, чтобы сузить тип, и на бою недостижима.
 */
export function repoRootOf(target: WeldTarget, filePath: string): string {
    const root = target.getRoot();

    if (root === null) {
        throw new Error(`repository root could not be resolved for ${filePath}`);
    }

    return root;
}

/**
 * Путь от корня репозитория — то, что печатают `file:`/`config:` и что уходит в `--json`: корень
 * зависит от места запуска, и абсолютный префикс в выводе делал бы его непереносимым. Вне корня путь
 * остается абсолютным (ESLint-конфиг из `--config` или найденный выше `.git`): относительный путь к
 * файлу, которого под корнем нет, ничего не адресует.
 */
export function repoPath(root: string, absolutePath: string): string {
    // Обратные слэши Windows в выводе разошлись бы с виртуальными путями (`/src/…`), которые печатает
    // тот же CLI, и с posix-формой, в которой примеры записаны в документации. Касается это и пути
    // вне корня: он тоже выводится в posix-форме, хотя и остается абсолютным.
    return (insidePath(root, absolutePath) ?? absolutePath).split(sep).join('/');
}

/**
 * Лежит ли путь внутри директории включительно — тот же вопрос, что у `repoPath`, но без вывода:
 * по нему `eslint-config.ts` отличает файл вне области действия `--config` от игнорируемого файла.
 */
export function isInside(dir: string, absolutePath: string): boolean {
    return absolutePath === dir || insidePath(dir, absolutePath) !== null;
}

/**
 * Относительный путь внутри `dir`; `null` — путь ей не принадлежит. Реальная арифметика, поэтому не
 * `src/path/` (та работает над виртуальными путями): первый сегмент `..` — путь выше директории,
 * `isAbsolute` — другой диск на Windows, пустая строка — сама директория, у которой относительного
 * пути нет.
 */
function insidePath(dir: string, absolutePath: string): string | null {
    const fromDir = relative(dir, absolutePath);

    if (fromDir === '' || isAbsolute(fromDir) || fromDir.split(sep)[0] === '..') {
        return null;
    }

    return fromDir;
}
