import { describe, expect, it } from 'vitest';

import { checkImport } from './check.js';
import type { CheckEnv } from './check.js';
import type { Alias } from '../../settings/aliases.js';

function fakeEnv(dirs: string[]): CheckEnv {
    const set = new Set(dirs);
    return { hasEntryPoint: (dir) => set.has(dir) };
}

describe('checkImport — сквозная связка', () => {
    it('нарушение с относительным импортом даёт исправленный относительный путь', () => {
        const env = fakeEnv(['/repo/src/other']);
        const result = checkImport(
            {
                specifier: '../other/internal.ts',
                fromFile: '/repo/src/feature/file.ts',
                aliases: [],
            },
            env,
        );
        expect(result).toBe('../other');
    });

    it('тот же импорт с алиасом, покрывающим границу, даёт тот же результат по границе, но путь с алиасом', () => {
        const env = fakeEnv(['/repo/src/other']);
        const aliases: Alias[] = [{ prefix: '@src', anchor: '/repo/src' }];
        const result = checkImport(
            {
                specifier: '@src/other/internal.ts',
                fromFile: '/repo/src/feature/file.ts',
                aliases,
            },
            env,
        );
        expect(result).toBe('@src/other');
    });
});

describe('checkImport — ранние выходы', () => {
    it('отсечённый специфаер (голый пакет) даёт null', () => {
        const env = fakeEnv(['/repo/src/other']);
        const result = checkImport(
            { specifier: 'lodash', fromFile: '/repo/src/feature/file.ts', aliases: [] },
            env,
        );
        expect(result).toBeNull();
    });

    it('отсутствие границы на пути даёт null', () => {
        const env = fakeEnv([]);
        const result = checkImport(
            {
                specifier: '../other/internal.ts',
                fromFile: '/repo/src/feature/file.ts',
                aliases: [],
            },
            env,
        );
        expect(result).toBeNull();
    });
});
