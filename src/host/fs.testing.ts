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
