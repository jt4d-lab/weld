import { ENTRY_EXTENSIONS, entryFileName } from '@/extensions.js';

import type { FsHost } from '@/host/fs.js';

/**
 * Фейковый `FsHost` над списком виртуальных путей — без обращения к диску. `toVirtual` — identity
 * для путей, начинающихся с `/` (уже виртуальные), иначе `null`. Кэш не нужен: список путей
 * неизменен, а обращений к диску нет.
 */
export function createFakeFsHost(files: string[]): FsHost {
    const set = new Set(files);

    return {
        hasEntryPoint: (dir) =>
            ENTRY_EXTENSIONS.some((ext) => set.has(`${dir}/${entryFileName(ext)}`)),
        toVirtual: (realPath) => (realPath.startsWith('/') ? realPath : null),
    };
}

/** `hasEntryPoint` фейкового `FsHost` отдельно — тестам ядра остального от `FsHost` не нужно. */
export function fakeHasEntryPoint(files: string[]): (dir: string) => boolean {
    return createFakeFsHost(files).hasEntryPoint;
}
