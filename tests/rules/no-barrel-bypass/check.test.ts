import { describe, expect, it } from 'vitest';

import type { Alias } from '../../../src/settings/aliases.js';
import { checkImport } from '../../../src/rules/no-barrel-bypass/check.js';

function hasEntryPointIn(dirs: Iterable<string>): (dir: string) => boolean {
    const set = new Set(dirs);
    return (dir: string) => set.has(dir);
}

describe('checkImport: сквозная связка', () => {
    it('нарушение с относительным импортом даёт исправленный относительный путь', () => {
        const env = { hasEntryPoint: hasEntryPointIn(['/repo/feature']) };

        const result = checkImport(
            {
                specifier: '../feature/internal/thing.ts',
                fromFile: '/repo/other/file.ts',
                aliases: [],
            },
            env,
        );

        expect(result).toBe('../feature');
    });

    it('тот же барьер с алиасом даёт исправленный путь с алиасом, а не относительный', () => {
        const aliases: Alias[] = [{ prefix: '@feature', anchor: '/repo/feature' }];
        const env = { hasEntryPoint: hasEntryPointIn(['/repo/feature']) };

        const result = checkImport(
            {
                specifier: '@feature/internal/thing.ts',
                fromFile: '/repo/other/file.ts',
                aliases,
            },
            env,
        );

        expect(result).toBe('@feature');
    });
});

describe('checkImport: ранние выходы', () => {
    it('отсечённый specifier (голый пакет) даёт null', () => {
        const env = { hasEntryPoint: hasEntryPointIn(['/repo/feature']) };

        const result = checkImport(
            { specifier: 'lodash', fromFile: '/repo/other/file.ts', aliases: [] },
            env,
        );

        expect(result).toBeNull();
    });

    it('отсечённый specifier (не-JS ресурс) даёт null', () => {
        const env = { hasEntryPoint: hasEntryPointIn(['/repo/feature']) };

        const result = checkImport(
            {
                specifier: '../feature/internal/styles.css',
                fromFile: '/repo/other/file.ts',
                aliases: [],
            },
            env,
        );

        expect(result).toBeNull();
    });

    it('отсутствие границы (нет точек входа на пути) даёт null', () => {
        const env = { hasEntryPoint: hasEntryPointIn([]) };

        const result = checkImport(
            {
                specifier: '../feature/internal/thing.ts',
                fromFile: '/repo/other/file.ts',
                aliases: [],
            },
            env,
        );

        expect(result).toBeNull();
    });

    it('импорт барреля напрямую (T — index границы) даёт null', () => {
        const env = { hasEntryPoint: hasEntryPointIn(['/repo/feature']) };

        const result = checkImport(
            { specifier: '../feature/index.ts', fromFile: '/repo/other/file.ts', aliases: [] },
            env,
        );

        expect(result).toBeNull();
    });
});
