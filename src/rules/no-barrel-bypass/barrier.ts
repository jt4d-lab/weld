/**
 * Арифметика границ модулей: находит первую точку входа (`index`), которую пробивает импорт из
 * `fromDir` в `targetPath`, поднимаясь от их общей директории вниз к цели.
 */

import {
    basename,
    commonDirectory,
    dirname,
    relativePath,
    resolvePath,
    splitExtension,
} from '../../path/posix.js';

function isIndexFile(targetPath: string): boolean {
    return splitExtension(basename(targetPath)).name === 'index';
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
