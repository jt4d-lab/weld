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
    const fromRoot = relative(root, absolutePath);

    // Первый сегмент `..` — путь выше корня, `isAbsolute` — другой диск на Windows; пустая строка —
    // сам корень, у которого относительного пути нет.
    if (fromRoot === '' || isAbsolute(fromRoot) || fromRoot.split(sep)[0] === '..') {
        return absolutePath;
    }

    return fromRoot;
}
