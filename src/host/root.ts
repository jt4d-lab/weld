import { createLogger } from '@/debug.js';
import { toPosix } from '@/path/index.js';

import { joinReal, parentOf } from '@/host/real-path.js';

const debug = createLogger('root');

/**
 * Подъём от `startDir` вверх, запоминает последнюю (самую верхнюю) директорию с `package.json`.
 * Останавливается на первой директории с `.git` (включительно — её `package.json` ещё учитывается)
 * или, если `.git` не встретился, на корне файловой системы. Ничего не нашли → `null`.
 *
 * Принимает реальный путь и реальный `exists` — работает до создания `FsHost`.
 */
export function findRepoRoot(startDir: string, exists: (path: string) => boolean): string | null {
    let current = toPosix(startDir);
    let found: string | null = null;

    debug('searching repo root from %s', current);

    for (;;) {
        if (exists(joinReal(current, 'package.json'))) {
            found = current;
            debug('found package.json at %s', current);
        }

        if (exists(joinReal(current, '.git'))) {
            debug('found .git at %s, stopping', current);
            break;
        }

        const parent = parentOf(current);
        if (parent === current) {
            debug('reached filesystem root at %s', current);
            break;
        }
        current = parent;
    }

    debug('resolved repo root: %o', found);
    return found;
}
