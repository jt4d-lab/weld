/**
 * fs-реализация порта `CheckEnv`: проверяет наличие `index.<ext>` в директории на диске.
 *
 * Результат кэшируется в `Map` внутри замыкания с TTL 30 секунд (значение по умолчанию у
 * `import/cache`) — без этого ESLint-сервер в IDE не увидит только что созданный `index.ts` до
 * перезапуска. Часы и `existsSync` инжектируются, чтобы TTL проверялся тестами без ожидания.
 */

import { existsSync } from 'node:fs';

import { ENTRY_EXTENSIONS } from '../entry-extensions.js';
import type { CheckEnv } from '../rules/no-barrel-bypass/check.js';

const TTL_MS = 30_000;

export type EntryPointEnvOptions = {
    now?: () => number;
    exists?: (path: string) => boolean;
};

export function createEntryPointEnv({
    now = Date.now,
    exists = existsSync,
}: EntryPointEnvOptions = {}): CheckEnv {
    const cache = new Map<string, { value: boolean; expiresAt: number }>();

    function hasEntryPoint(dir: string): boolean {
        const cached = cache.get(dir);
        const currentTime = now();
        if (cached && cached.expiresAt > currentTime) {
            return cached.value;
        }

        const value = ENTRY_EXTENSIONS.some((ext) => exists(`${dir}/index.${ext}`));
        cache.set(dir, { value, expiresAt: currentTime + TTL_MS });
        return value;
    }

    return { hasEntryPoint };
}
