import type { Rule } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeFsHost, resetFsHostCaches } from '@/host/index.js';
import { WELD_OPTION_PROPERTIES, resolveWeldContext } from '@/rules/context.js';

/** Минимальный `Rule.RuleContext`: `resolveWeldContext` читает из него ровно эти четыре поля. */
function fakeContext(fields: {
    settings?: unknown;
    cwd?: string;
    filename: string;
    options?: unknown[];
}): Rule.RuleContext {
    return {
        settings: fields.settings ?? {},
        cwd: fields.cwd ?? '/cwd',
        filename: fields.filename,
        options: fields.options ?? [],
    } as unknown as Rule.RuleContext;
}

describe('WELD_OPTION_PROPERTIES', () => {
    it('объявляет три общие настройки — правило подмешивает их к своим', () => {
        expect(WELD_OPTION_PROPERTIES).toEqual({
            root: { type: 'string' },
            baseUrl: { type: 'string' },
            aliases: { type: 'object' },
        });
    });
});

describe('resolveWeldContext', () => {
    afterEach(() => {
        resetFsHostCaches();
    });

    it('файл внутри root → виртуальный путь, алиасы и та же файловая система', () => {
        const fsHost = createFakeFsHost(['/src/other/index.ts']);

        const weld = resolveWeldContext(
            fakeContext({
                filename: '/src/feature/file.ts',
                settings: { weld: { baseUrl: '/', aliases: { '@other/*': ['src/other/*'] } } },
            }),
            fsHost,
        );

        expect(weld).not.toBeNull();
        expect(weld?.fromFile).toBe('/src/feature/file.ts');
        expect(weld?.aliases).toEqual([{ prefix: '@other', anchor: '/src/other' }]);
        expect(weld?.fsHost).toBe(fsHost);
    });

    it('файл вне root → null', () => {
        const weld = resolveWeldContext(
            fakeContext({ filename: 'relative/file.ts' }),
            createFakeFsHost([]),
        );

        expect(weld).toBeNull();
    });

    it('нет settings.weld → алиасов нет', () => {
        const weld = resolveWeldContext(
            fakeContext({ filename: '/src/feature/file.ts' }),
            createFakeFsHost([]),
        );

        expect(weld?.aliases).toEqual([]);
    });

    it('options.aliases и options.baseUrl перекрывают settings.weld', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/src/feature/file.ts',
                settings: { weld: { baseUrl: '/nowhere', aliases: { '@a/*': ['nowhere/*'] } } },
                options: [{ baseUrl: '/', aliases: { '@a/*': ['src/a/*'] } }],
            }),
            createFakeFsHost([]),
        );

        expect(weld?.aliases).toEqual([{ prefix: '@a', anchor: '/src/a' }]);
    });

    it('без инъекции файловая система собирается из settings.weld.root', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/repo/src/feature/file.ts',
                settings: { weld: { root: '/repo' } },
            }),
        );

        expect(weld?.fromFile).toBe('/src/feature/file.ts');
    });

    it('options.root выигрывает у settings.weld.root', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/repo/src/feature/file.ts',
                settings: { weld: { root: '/nowhere' } },
                options: [{ root: '/repo' }],
            }),
        );

        expect(weld?.fromFile).toBe('/src/feature/file.ts');
    });

    it('при инъекции fsHost опция root ни на что не влияет', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/src/feature/file.ts',
                options: [{ root: '/nowhere' }],
            }),
            createFakeFsHost([]),
        );

        expect(weld?.fromFile).toBe('/src/feature/file.ts');
    });

    it('сломанный settings.weld доходит исключением из слоя настроек', () => {
        expect(() =>
            resolveWeldContext(
                fakeContext({
                    filename: '/src/feature/file.ts',
                    settings: { weld: { aliases: 'nope' } },
                }),
                createFakeFsHost([]),
            ),
        ).toThrow('settings.weld.aliases must be an object');
    });
});
