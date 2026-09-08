import { ENTRY_FILE_NAMES } from '@/extensions.js';

import type { FsHost } from '@/host/fs.js';

/**
 * Фейковый `FsHost` над списком виртуальных путей — без обращения к диску. `toVirtual` — identity
 * для путей, начинающихся с `/` (уже виртуальные), иначе `null`. Кэш не нужен: список путей
 * неизменен, а обращений к диску нет.
 */
export function createFakeFsHost(files: string[]): FsHost {
    const set = new Set(files);

    return {
        hasEntryPoint: (dir) => ENTRY_FILE_NAMES.some((name) => set.has(`${dir}/${name}`)),
        toVirtual: (realPath) => (realPath.startsWith('/') ? realPath : null),
    };
}

/**
 * Фейковый предикат `exists` над списком реальных путей: существует ровно то, что в списке. Его
 * спрашивают и `createFsHost` (опция `exists`), и `findRepoRoot` — форма вопроса одна, поэтому и
 * фейк один, а не по копии на тест каждого из них. Через баррель наружу не выходит: подделывать
 * диск помимо `FsHost` нужно только самому слою.
 */
export function createFakeExists(realPaths: string[]): (realPath: string) => boolean {
    const set = new Set(realPaths);
    return (realPath) => set.has(realPath);
}
