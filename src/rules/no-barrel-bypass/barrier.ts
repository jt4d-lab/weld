/**
 * Арифметика границ модулей: находит первую точку входа (`index`), которую пробивает импорт из
 * `fromDir` в `targetPath`, поднимаясь от их общей директории вниз к цели.
 */

import { commonDirectory, dirname, relativePath, resolvePath } from '../../path/posix.js';

function isIndexFile(targetPath: string): boolean {
    const base = targetPath.slice(targetPath.lastIndexOf('/') + 1);
    const dotIndex = base.lastIndexOf('.');
    const name = dotIndex === -1 ? base : base.slice(0, dotIndex);
    return name === 'index';
}

/**
 * Возвращает абсолютный путь границы, которую пробивает импорт, либо `null`, если нарушения нет.
 * `hasEntryPoint` вызывается только для директорий строго между общим предком `fromDir`/`targetPath`
 * и `targetPath` — границы, внутри которых уже находится `fromDir`, не проверяются.
 */
export function findBarrier(
    fromDir: string,
    targetPath: string,
    hasEntryPoint: (dir: string) => boolean,
): string | null {
    const targetDir = dirname(targetPath);
    const commonRoot = commonDirectory(fromDir, targetDir);
    if (commonRoot === null) {
        return null;
    }

    const segments = relativePath(commonRoot, targetPath).split('/').filter(Boolean);
    const dirSegments = segments.slice(0, -1);

    let current = commonRoot;
    for (const segment of dirSegments) {
        current = resolvePath(current, segment);
        if (hasEntryPoint(current)) {
            return current === targetDir && isIndexFile(targetPath) ? null : current;
        }
    }

    return null;
}
