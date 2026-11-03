import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeFsHost, resetFsHostCaches } from '@/host/index.js';
import { cleanupTmpProjects, makeTmpProject, tsconfigBasicFixture } from '@/testing/index.js';
import type * as TsconfigLayer from '@/tsconfig/index.js';
import { loadTsconfigPaths, resetTsconfigCache } from '@/tsconfig/index.js';

import { reportForFile } from './report.js';
import type { WeldResolveInput, WeldResolveOptions } from './resolve.js';

vi.mock('../tsconfig/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof TsconfigLayer>();

    return { ...actual, loadTsconfigPaths: vi.fn(actual.loadTsconfigPaths) };
});

const loadTsconfigPathsMock = vi.mocked(loadTsconfigPaths);

afterEach(() => {
    resetFsHostCaches();
    resetTsconfigCache();
    cleanupTmpProjects();
    loadTsconfigPathsMock.mockClear();
});

/**
 * Герметичный вход: несуществующая директория — настоящий автопоиск tsconfig вернет `null`
 * без обращения к фикстурам; реальный поиск проверяют отдельные тесты на фикстурах.
 */
function input(settings: unknown, options?: WeldResolveOptions): WeldResolveInput {
    return {
        filename: '/nonexistent-weld-test/src/feature/file.ts',
        cwd: '/nonexistent-weld-test',
        settings,
        options,
    };
}

describe('reportForFile — ошибка секции', () => {
    it('кривая секция: одна собственная проблема, настройки секции — unresolved: settings.weld', () => {
        const report = reportForFile(input({ weld: 'nope' }));

        expect(report.sectionError).toBe('settings.weld must be an object');
        expect(report.settings.repoRoot).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(report.settings.aliasesBaseUrl).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(report.settings.tsconfig).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(report.settings.aliases).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(report.settings.srcDir).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(report.settings.modulesDir).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(report.settings.layers).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(report.settings.moduleLayers).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(loadTsconfigPathsMock).not.toHaveBeenCalled();
    });

    it('опции проверяются независимо от кривой секции', () => {
        const report = reportForFile(
            input(
                { weld: 'nope' },
                {
                    repoRoot: '/some/root',
                    aliases: { '@a/*': ['a/*'] },
                    srcDir: 'app',
                    modulesDir: 'blocks',
                    layers: ['app', '@modules'],
                    moduleLayers: ['ui'],
                },
            ),
        );

        expect(report.sectionError).toBe('settings.weld must be an object');
        expect(report.settings.repoRoot).toEqual({ status: 'value', value: '/some/root' });
        expect(report.settings.srcDir).toEqual({ status: 'value', value: '/app' });
        expect(report.settings.modulesDir).toEqual({ status: 'value', value: 'blocks' });
        expect(report.settings.layers).toEqual({ status: 'value', value: ['app', '@modules'] });
        expect(report.settings.moduleLayers).toEqual({ status: 'value', value: ['ui'] });
        // База читается только из секции: алиасы без нее не разбираются, фиктивной базы нет.
        expect(report.settings.aliasesBaseUrl).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(report.settings.aliases).toEqual({
            status: 'unresolved',
            dependency: 'aliasesBaseUrl',
        });
        expect(report.settings.tsconfig).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
    });

    it('кривые опции над кривой секцией: собственные ошибки называют options.*', () => {
        const report = reportForFile(
            input({ weld: 42 }, { repoRoot: 42 as unknown as string, layers: 'x' }),
        );

        expect(report.sectionError).toBe('settings.weld must be an object');
        expect(report.settings.repoRoot).toEqual({
            status: 'invalid',
            message: 'options.repoRoot must be a string, got number',
        });
        expect(report.settings.layers).toEqual({
            status: 'invalid',
            message: 'options.layers must be an array of strings, got string',
        });
        expect(report.settings.srcDir).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(report.settings.moduleLayers).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
        expect(report.settings.aliases).toEqual({
            status: 'unresolved',
            dependency: 'settings.weld',
        });
    });
});

describe('reportForFile — собственные значения repoRoot и tsconfig', () => {
    it('кривой repoRoot в секции: собственная ошибка, авто-алиасы указывают на корень', () => {
        const report = reportForFile(input({ weld: { repoRoot: 42 } }));

        expect(report.sectionError).toBeNull();
        expect(report.settings.repoRoot).toEqual({
            status: 'invalid',
            message: 'settings.weld.repoRoot must be a string, got number',
        });
        expect(report.settings.tsconfig).toEqual({ status: 'value', value: 'tsconfig.json' });
        expect(report.settings.aliasesBaseUrl).toEqual({ status: 'value', value: '.' });
        expect(report.settings.aliases).toEqual({ status: 'unresolved', dependency: 'repoRoot' });
    });

    it('кривой repoRoot в опциях: сообщение называет options.repoRoot', () => {
        const report = reportForFile(input({}, { repoRoot: 42 as unknown as string }));

        expect(report.settings.repoRoot).toEqual({
            status: 'invalid',
            message: 'options.repoRoot must be a string, got number',
        });
    });

    it('кривое имя tsconfig: эффективный корень и авто-алиасы — unresolved: tsconfig', () => {
        const report = reportForFile(input({ weld: { tsconfig: 42 } }));

        expect(report.settings.tsconfig).toEqual({
            status: 'invalid',
            message: 'settings.weld.tsconfig must be a string, got number',
        });
        expect(report.settings.repoRoot).toEqual({ status: 'unresolved', dependency: 'tsconfig' });
        expect(report.settings.aliases).toEqual({ status: 'unresolved', dependency: 'tsconfig' });
    });

    it('невалидны и repoRoot, и tsconfig одновременно: две собственные ошибки, корень не подставляется', () => {
        const report = reportForFile(input({ weld: { repoRoot: 42, tsconfig: 42 } }));

        expect(report.settings.repoRoot).toEqual({
            status: 'invalid',
            message: 'settings.weld.repoRoot must be a string, got number',
        });
        expect(report.settings.tsconfig).toEqual({
            status: 'invalid',
            message: 'settings.weld.tsconfig must be a string, got number',
        });
        // Авто-алиасы называют первую по порядку оценки зависимость — имя tsconfig.
        expect(report.settings.aliases).toEqual({ status: 'unresolved', dependency: 'tsconfig' });
    });
});

describe('reportForFile — независимость от ошибки корня', () => {
    it('схема, база, tsconfig и явные алиасы не зависят от кривого корня', () => {
        const report = reportForFile(
            input({
                weld: {
                    repoRoot: 42,
                    aliases: { '@a/*': ['a/*'] },
                    layers: ['app', '@modules'],
                    moduleLayers: ['ui'],
                },
            }),
        );

        expect(report.settings.repoRoot).toEqual({
            status: 'invalid',
            message: 'settings.weld.repoRoot must be a string, got number',
        });
        expect(report.settings.aliasesBaseUrl).toEqual({ status: 'value', value: '.' });
        expect(report.settings.aliases).toEqual({
            status: 'value',
            value: [{ prefix: '@a', anchor: '/a', star: true }],
        });
        expect(report.settings.srcDir).toEqual({ status: 'value', value: '/src' });
        expect(report.settings.modulesDir).toEqual({ status: 'value', value: 'modules' });
        expect(report.settings.layers).toEqual({ status: 'value', value: ['app', '@modules'] });
        expect(report.settings.moduleLayers).toEqual({ status: 'value', value: ['ui'] });
    });

    it('одновременные ошибки базы и формата алиасов: каждая получает собственную', () => {
        const report = reportForFile(
            input({ weld: { aliasesBaseUrl: 42, aliases: { '@a': 42 } } }),
        );

        expect(report.settings.aliasesBaseUrl).toEqual({
            status: 'invalid',
            message: 'settings.weld.aliasesBaseUrl must be a string, got number',
        });
        expect(report.settings.aliases).toEqual({
            status: 'invalid',
            message: "settings.weld.aliases['@a'] must be a string or an array of strings",
        });
    });

    it('база кривая, формат верный: unresolved: aliasesBaseUrl, фиктивная база не подставляется', () => {
        const report = reportForFile(
            input({ weld: { aliasesBaseUrl: 42, aliases: { '@a/*': ['a/*'] } } }),
        );

        expect(report.settings.aliasesBaseUrl).toEqual({
            status: 'invalid',
            message: 'settings.weld.aliasesBaseUrl must be a string, got number',
        });
        expect(report.settings.aliases).toEqual({
            status: 'unresolved',
            dependency: 'aliasesBaseUrl',
        });
    });
});

describe('reportForFile — явные алиасы', () => {
    it('пустой {} — явные алиасы: автопоиск не читается, результат пуст', () => {
        const report = reportForFile(input({ weld: { repoRoot: '/r', aliases: {} } }));

        expect(report.settings.aliases).toEqual({ status: 'value', value: [] });
        expect(loadTsconfigPathsMock).not.toHaveBeenCalled();
    });

    it('опции перекрывают секцию: сообщение об ошибке называет options.aliases', () => {
        const report = reportForFile(
            input({ weld: { aliases: { '@ok/*': ['ok/*'] } } }, { aliases: { '@bad': [42] } }),
        );

        expect(report.settings.aliases).toEqual({
            status: 'invalid',
            message: "options.aliases['@bad'] must contain only strings",
        });
    });

    it('опции разбираются с базой из секции', () => {
        const report = reportForFile(
            input({ weld: { aliasesBaseUrl: 'src' } }, { aliases: { '@a/*': ['a/*'] } }),
        );

        expect(report.settings.aliases).toEqual({
            status: 'value',
            value: [{ prefix: '@a', anchor: '/src/a', star: true }],
        });
    });
});

describe('reportForFile — автоматические алиасы', () => {
    it('tsconfig не найден: пустой результат, а не ошибка', () => {
        const report = reportForFile(input({ weld: { repoRoot: '/nonexistent-weld-test' } }));

        expect(report.settings.repoRoot).toEqual({
            status: 'value',
            value: '/nonexistent-weld-test',
        });
        expect(report.settings.aliases).toEqual({ status: 'value', value: [] });
        expect(loadTsconfigPathsMock).toHaveBeenCalledTimes(1);
    });

    it('реальный автопоиск: алиасы из tsconfig фикстуры', () => {
        const report = reportForFile({
            filename: `${tsconfigBasicFixture}/src/consumer.ts`,
            cwd: tsconfigBasicFixture,
            settings: { weld: { repoRoot: tsconfigBasicFixture } },
        });

        expect(report.settings.repoRoot).toEqual({ status: 'value', value: tsconfigBasicFixture });
        expect(report.settings.aliases).toEqual({
            status: 'value',
            value: [
                { prefix: '@', anchor: '/src', star: true },
                { prefix: '#lib', anchor: '/src/lib', star: false },
            ],
        });
    });

    it('монорепа: корень поднимается до якорей, алиасы разбираются', () => {
        const proj = makeTmpProject({
            'tsconfig.base.json': JSON.stringify({
                compilerOptions: { baseUrl: '.', paths: { '@shared/*': ['shared/*'] } },
            }),
            'packages/app/tsconfig.json': JSON.stringify({
                extends: '../../tsconfig.base.json',
            }),
            'packages/app/src/consumer.ts': 'export {};\n',
            'shared/index.ts': 'export {};\n',
        });

        const report = reportForFile({
            filename: `${proj}/packages/app/src/consumer.ts`,
            cwd: `${proj}/packages/app`,
            settings: {},
        });

        expect(report.settings.repoRoot).toEqual({ status: 'value', value: proj });
        expect(report.settings.aliases).toEqual({
            status: 'value',
            value: [{ prefix: '@shared', anchor: '/shared', star: true }],
        });
    });
});

describe('reportForFile — схема', () => {
    it('схемы нет: дефолты и not-set для списков', () => {
        const report = reportForFile(input({ weld: { repoRoot: '/r' } }));

        expect(report.settings.srcDir).toEqual({ status: 'value', value: '/src' });
        expect(report.settings.modulesDir).toEqual({ status: 'value', value: 'modules' });
        expect(report.settings.layers).toEqual({ status: 'not-set' });
        expect(report.settings.moduleLayers).toEqual({ status: 'not-set' });
    });

    it('ошибка поля независима от кривого корня и от соседнего списка', () => {
        const report = reportForFile(input({ weld: { repoRoot: 42, layers: 'x' } }));

        expect(report.settings.repoRoot).toEqual({
            status: 'invalid',
            message: 'settings.weld.repoRoot must be a string, got number',
        });
        expect(report.settings.layers).toEqual({
            status: 'invalid',
            message: 'settings.weld.layers must be an array of strings, got string',
        });
        expect(report.settings.moduleLayers).toEqual({ status: 'not-set' });
        expect(report.settings.srcDir).toEqual({ status: 'value', value: '/src' });
    });

    it('кривой modulesDir: корректные списки — unresolved: modulesDir', () => {
        const report = reportForFile(
            input({
                weld: {
                    repoRoot: 42,
                    modulesDir: 'a/b',
                    layers: ['app', '@modules'],
                    moduleLayers: ['ui'],
                },
            }),
        );

        expect(report.settings.modulesDir).toEqual({
            status: 'invalid',
            message: expect.stringContaining('settings.weld.modulesDir'),
        });
        expect(report.settings.layers).toEqual({ status: 'unresolved', dependency: 'modulesDir' });
        expect(report.settings.moduleLayers).toEqual({
            status: 'unresolved',
            dependency: 'modulesDir',
        });
    });

    it('собственная ошибка списка показывается, даже если зависимость кривая', () => {
        const report = reportForFile(
            input({
                weld: {
                    repoRoot: '/r',
                    modulesDir: 'a/b',
                    layers: ['app', 42],
                    moduleLayers: ['ui'],
                },
            }),
        );

        expect(report.settings.layers).toEqual({
            status: 'invalid',
            message: 'settings.weld.layers[1] must be a string, got number',
        });
        expect(report.settings.modulesDir).toEqual({
            status: 'invalid',
            message: expect.stringContaining('settings.weld.modulesDir'),
        });
        expect(report.settings.moduleLayers).toEqual({
            status: 'unresolved',
            dependency: 'modulesDir',
        });
    });

    it('общее имя: ошибка прикрепляется к moduleLayers, layers остается валидным', () => {
        const report = reportForFile(
            input({
                weld: {
                    repoRoot: '/r',
                    layers: ['app', '@modules'],
                    moduleLayers: ['app'],
                },
            }),
        );

        expect(report.settings.layers).toEqual({ status: 'value', value: ['app', '@modules'] });
        expect(report.settings.moduleLayers).toEqual({
            status: 'invalid',
            message: 'settings.weld.moduleLayers[0]: "app" is also listed in settings.weld.layers',
        });
    });

    it('layers без @modules: ошибка в layers, moduleLayers валиден', () => {
        const report = reportForFile(
            input({
                weld: {
                    repoRoot: '/r',
                    layers: ['app'],
                    moduleLayers: ['ui'],
                },
            }),
        );

        expect(report.settings.layers).toEqual({
            status: 'invalid',
            message: 'settings.weld.layers must contain the "@modules" marker',
        });
        expect(report.settings.moduleLayers).toEqual({ status: 'value', value: ['ui'] });
    });

    it('опция перекрывает секцию: сообщение называет options.*', () => {
        const report = reportForFile(
            input(
                { weld: { repoRoot: '/r', layers: ['app', '@modules'], moduleLayers: ['ui'] } },
                { layers: 'x' },
            ),
        );

        expect(report.settings.layers).toEqual({
            status: 'invalid',
            message: 'options.layers must be an array of strings, got string',
        });
        expect(report.settings.moduleLayers).toEqual({ status: 'value', value: ['ui'] });
    });
});

describe('reportForFile — поддельный хост', () => {
    it('реального корня нет: unresolved: fsHost, авто-алиасы — пустой результат', () => {
        const report = reportForFile(input({}), createFakeFsHost([]));

        expect(report.settings.repoRoot).toEqual({ status: 'unresolved', dependency: 'fsHost' });
        expect(report.settings.aliases).toEqual({ status: 'value', value: [] });
        expect(loadTsconfigPathsMock).not.toHaveBeenCalled();
    });

    it('явные алиасы разбираются без рабочего корня', () => {
        const report = reportForFile(
            input({ weld: { aliases: { '@a/*': ['a/*'] } } }),
            createFakeFsHost([]),
        );

        expect(report.settings.repoRoot).toEqual({ status: 'unresolved', dependency: 'fsHost' });
        expect(report.settings.aliases).toEqual({
            status: 'value',
            value: [{ prefix: '@a', anchor: '/a', star: true }],
        });
    });

    it('кривое имя tsconfig под поддельным хостом: алиасы остаются пустыми, tsconfig не читается', () => {
        const report = reportForFile(input({ weld: { tsconfig: 42 } }), createFakeFsHost([]));

        expect(report.settings.tsconfig).toEqual({
            status: 'invalid',
            message: 'settings.weld.tsconfig must be a string, got number',
        });
        expect(report.settings.repoRoot).toEqual({ status: 'unresolved', dependency: 'fsHost' });
        expect(report.settings.aliases).toEqual({ status: 'value', value: [] });
        expect(loadTsconfigPathsMock).not.toHaveBeenCalled();
    });
});
