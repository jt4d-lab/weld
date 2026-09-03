import { isEntryPointBasename } from '../../entry-extensions.js';
import { commonDirectory, dirname } from '../../path/posix.js';

/**
 * Ищет ближайшую к корню (верхнюю) директорию с точкой входа, которую пробивает импорт из
 * `fromDir` в `targetPath`. Алгоритм — см. раздел «Алгоритм findBarrier» плана: общий префикс
 * `fromDir` и `dirname(targetPath)`, затем спуск по сегментам между общим префиксом и целью,
 * пока не встретится первая директория с точкой входа.
 *
 * Возвращает `null`, если нарушения нет: общего корня нет, точек входа на пути нет, либо цель —
 * сама точка входа найденной границы (`D/index` или `D/index.<ext>`).
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

    const segments = segmentsBelow(commonRoot, targetDir);

    let current = commonRoot;
    for (const segment of segments) {
        current = current === '/' ? `/${segment}` : `${current}/${segment}`;

        if (hasEntryPoint(current)) {
            return isEntryPointOf(current, targetPath) ? null : current;
        }
    }

    return null;
}

/** Сегменты `to` начиная сразу за `base`. `base` — всегда префикс `to` (общий корень + путь вниз). */
function segmentsBelow(base: string, to: string): string[] {
    const tail = base === '/' ? to.slice(1) : to.slice(base.length + 1);
    return tail === '' ? [] : tail.split('/');
}

/** Является ли `targetPath` точкой входа директории `dir` — `dir/index` или `dir/index.<ext>`. */
function isEntryPointOf(dir: string, targetPath: string): boolean {
    const lastSlash = targetPath.lastIndexOf('/');
    const targetDir = lastSlash === -1 ? '' : targetPath.slice(0, lastSlash);
    if (targetDir !== dir) {
        return false;
    }

    const basename = lastSlash === -1 ? targetPath : targetPath.slice(lastSlash + 1);
    return basename === 'index' || isEntryPointBasename(basename);
}
