import { existsSync } from 'node:fs';

import { ENTRY_EXTENSIONS } from '../entry-extensions.js';
import type { CheckEnv } from '../rules/no-barrel-bypass/check.js';

/** TTL записи кэша — совпадает со значением по умолчанию у `import/cache`. */
const CACHE_TTL_MS = 30_000;

type EntryPointDeps = { now: () => number; exists: (path: string) => boolean };

/**
 * fs-реализация {@link CheckEnv}: `hasEntryPoint(dir)` истинен, если в `dir` есть файл
 * `index.<ext>` для любого расширения из `ENTRY_EXTENSIONS`.
 *
 * Результат кэшируется в `Map` внутри замыкания с TTL 30 секунд — без инвалидации ESLint-сервер
 * в IDE не увидит только что созданный `index.ts`. `Map`, а не модульная переменная: каждый вызов
 * `createEntryPointEnv()` получает свой чистый кэш и не делит состояние с другими вызовами (тестами
 * в первую очередь). `now` и `exists` инжектируются, чтобы TTL был тестируем без реального ожидания.
 */
export function createEntryPointEnv(deps: Partial<EntryPointDeps> = {}): CheckEnv {
    const now = deps.now ?? Date.now;
    const exists = deps.exists ?? existsSync;

    const cache = new Map<string, { hasEntryPoint: boolean; expiresAt: number }>();

    function hasEntryPoint(dir: string): boolean {
        const cached = cache.get(dir);
        const timestamp = now();
        if (cached !== undefined && cached.expiresAt > timestamp) {
            return cached.hasEntryPoint;
        }

        const found = ENTRY_EXTENSIONS.some((extension) => exists(`${dir}/index.${extension}`));
        cache.set(dir, { hasEntryPoint: found, expiresAt: timestamp + CACHE_TTL_MS });
        return found;
    }

    return { hasEntryPoint };
}
