/** Общее у команд: части резолва и форма путей в выводе. */

import { isAbsolute, relative, sep } from 'node:path';

import type { WeldTarget } from '@/config/index.js';

export function virtualPathOf(target: WeldTarget, shownPath: string): string {
    const fromFile = target.getFromFile();

    if (fromFile === null) {
        throw outsideRoot(shownPath);
    }

    return fromFile;
}

export function assertInsideRoot(target: WeldTarget, shownPath: string): void {
    if (target.getFromFile() === null) {
        throw outsideRoot(shownPath);
    }
}

/** `shownPath` — аргумент в том виде, как его ввели: по нему пользователь и находит файл. */
function outsideRoot(shownPath: string): Error {
    return new Error(`${shownPath} is outside the repository root`);
}

/**
 * Реальный корень репозитория. `null` резолв отдает только поддельному `FsHost` — шов, которым CLI не
 * пользуется; проверка нужна, чтобы сузить тип.
 */
export function repoRootOf(target: WeldTarget, shownPath: string): string {
    const root = target.getRoot();

    if (root === null) {
        throw new Error(`repository root could not be resolved for ${shownPath}`);
    }

    return root;
}

/** Путь от корня репозитория в posix-форме; вне корня — абсолютным. */
export function repoPath(root: string, absolutePath: string): string {
    return (insidePath(root, absolutePath) ?? absolutePath).split(sep).join('/');
}

/** Лежит ли путь внутри директории включительно. */
export function isInside(dir: string, absolutePath: string): boolean {
    return absolutePath === dir || insidePath(dir, absolutePath) !== null;
}

/** Относительный путь внутри `dir`; `null` — путь ей не принадлежит. */
function insidePath(dir: string, absolutePath: string): string | null {
    const fromDir = relative(dir, absolutePath);

    if (fromDir === '' || isAbsolute(fromDir) || fromDir.split(sep)[0] === '..') {
        return null;
    }

    return fromDir;
}
