/**
 * Арифметика границ модулей: находит первую точку входа (`index`), которую пробивает импорт из
 * `fromDir` в `targetPath`, поднимаясь от их общей директории вниз к цели.
 */

import { isEntryBasename } from '@/extensions.js';
import {
    basename,
    commonDirectory,
    dirname,
    joinSegments,
    segments,
    splitExtension,
} from '@/path/index.js';

function isIndexFile(targetPath: string): boolean {
    return isEntryBasename(splitExtension(basename(targetPath)).name);
}

/**
 * Возвращает виртуальный путь границы, которую пробивает импорт, либо `null`, если нарушения нет.
 * `hasEntryPoint` вызывается только для директорий строго между общим предком `fromDir`/`targetPath`
 * и `targetPath` — границы, внутри которых уже находится `fromDir`, не проверяются.
 */
export function findBarrier(
    fromDir: string,
    targetPath: string,
    hasEntryPoint: (dir: string) => boolean,
): string | null {
    const targetDir = dirname(targetPath);
    const targetDirSegments = segments(targetDir);

    // Глубина общей директории — она же индекс первого сегмента ниже неё.
    const depth = segments(commonDirectory(fromDir, targetDir)).length;

    // Спуск от общей директории вниз к цели.
    for (let i = depth; i < targetDirSegments.length; i += 1) {
        const dir = joinSegments(targetDirSegments.slice(0, i + 1));
        if (hasEntryPoint(dir)) {
            const atTargetDir = i === targetDirSegments.length - 1;
            return atTargetDir && isIndexFile(targetPath) ? null : dir;
        }
    }

    return null;
}
