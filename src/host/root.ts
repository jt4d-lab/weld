import { createLogger } from '@/debug.js';
import { toPosix } from '@/path/index.js';

const debug = createLogger('root');

/** Соединяет директорию (в т.ч. корень `/` или `C:/`) с именем файла, не удваивая `/`. */
function join(dir: string, name: string): string {
    return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

/**
 * Директория выше `dir`. У корня ФС (`/`, `C:/`) родителя нет — возвращает сам корень, по чему
 * вызывающий код и определяет достижение верха.
 */
function parentOf(dir: string): string {
    const idx = dir.lastIndexOf('/');
    if (idx === -1) {
        return dir;
    }

    const head = dir.slice(0, idx);
    if (head === '') {
        return '/';
    }
    if (/^[A-Za-z]:$/.test(head)) {
        return `${head}/`;
    }

    return head;
}

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
        if (exists(join(current, 'package.json'))) {
            found = current;
            debug('found package.json at %s', current);
        }

        if (exists(join(current, '.git'))) {
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
