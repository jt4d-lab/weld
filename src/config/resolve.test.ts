import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeFsHost, resetFsHostCaches } from '@/host/index.js';
import {
    cleanupTmpProjects,
    makeTmpProject,
    repoRoot,
    tsconfigBasicFixture,
} from '@/testing/index.js';
import { loadTsconfigPaths, resetTsconfigCache } from '@/tsconfig/index.js';
import type * as TsconfigLayer from '@/tsconfig/index.js';

import { resolveForFile } from './resolve.js';

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

describe('resolveForFile', () => {
    it('базовый резолв: виртуальный путь, алиасы и та же файловая система', () => {
        const fsHost = createFakeFsHost([]);

        const target = resolveForFile(
            {
                filename: '/src/feature/file.ts',
                cwd: '/cwd',
                settings: {
                    weld: { aliasesBaseUrl: '/', aliases: { '@other/*': ['src/other/*'] } },
                },
            },
            fsHost,
        );

        expect(target.getFromFile()).toBe('/src/feature/file.ts');
        expect(target.getAliases()).toEqual([
            { prefix: '@other', anchor: '/src/other', star: true },
        ]);
        expect(target.getFsHost()).toBe(fsHost);
    });

    it('getFromFile() вне корня репозитория → null', () => {
        const target = resolveForFile(
            { filename: 'relative/file.ts', cwd: '/cwd', settings: {} },
            createFakeFsHost([]),
        );

        expect(target.getFromFile()).toBeNull();
    });

    it('getRoot() в поддельной файловой системе → null: реального корня у нее нет', () => {
        const target = resolveForFile(
            { filename: '/src/feature/file.ts', cwd: '/cwd', settings: {} },
            createFakeFsHost([]),
        );

        expect(target.getRoot()).toBeNull();
    });

    it('options.aliases и options.aliasesBaseUrl перекрывают settings.weld', () => {
        const target = resolveForFile(
            {
                filename: '/src/feature/file.ts',
                cwd: '/cwd',
                settings: {
                    weld: { aliasesBaseUrl: '/nowhere', aliases: { '@a/*': ['nowhere/*'] } },
                },
                options: { aliasesBaseUrl: '/', aliases: { '@a/*': ['src/a/*'] } },
            },
            createFakeFsHost([]),
        );

        expect(target.getAliases()).toEqual([{ prefix: '@a', anchor: '/src/a', star: true }]);
    });

    it('алиасы приходят из tsconfig внутри явного root', () => {
        const target = resolveForFile({
            filename: `${tsconfigBasicFixture}/src/consumer.ts`,
            cwd: tsconfigBasicFixture,
            settings: { weld: { repoRoot: tsconfigBasicFixture } },
        });

        expect(target.getFromFile()).toBe('/src/consumer.ts');
        expect(target.getRoot()).toBe(tsconfigBasicFixture);
        expect(target.getAliases()).toEqual([
            { prefix: '@', anchor: '/src', star: true },
            { prefix: '#lib', anchor: '/src/lib', star: false },
        ]);
    });

    it('getRoot() поднимается до якорей tsconfig, когда root не задан явно', () => {
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

        const target = resolveForFile({
            filename: `${proj}/packages/app/src/consumer.ts`,
            cwd: `${proj}/packages/app`,
            settings: {},
        });

        expect(target.getRoot()).toBe(proj);
        expect(target.getFromFile()).toBe('/packages/app/src/consumer.ts');
        expect(target.getAliases()).toEqual([{ prefix: '@shared', anchor: '/shared', star: true }]);
    });

    it('пустой {} в settings.weld.aliases выключает автопоиск', () => {
        const target = resolveForFile({
            filename: `${tsconfigBasicFixture}/src/consumer.ts`,
            cwd: tsconfigBasicFixture,
            settings: { weld: { repoRoot: tsconfigBasicFixture, aliases: {} } },
        });

        expect(target.getAliases()).toEqual([]);
        expect(loadTsconfigPathsMock).not.toHaveBeenCalled();
    });

    it('при инъекции fsHost tsconfig не читается: алиасов нет', () => {
        const file = `${tsconfigBasicFixture}/src/consumer.ts`;
        const target = resolveForFile(
            { filename: file, cwd: tsconfigBasicFixture, settings: {} },
            createFakeFsHost([file]),
        );

        expect(target.getAliases()).toEqual([]);
        expect(loadTsconfigPathsMock).not.toHaveBeenCalled();
    });

    it('tsconfig выше явного root отбрасывается целиком', () => {
        const target = resolveForFile({
            filename: `${tsconfigBasicFixture}/src/consumer.ts`,
            cwd: tsconfigBasicFixture,
            settings: { weld: { repoRoot: `${tsconfigBasicFixture}/src` } },
        });

        expect(target.getFromFile()).toBe('/consumer.ts');
        expect(target.getAliases()).toEqual([]);
    });

    it('кривые paths в tsconfig не бросают: алиасов нет, остальное живо', () => {
        const proj = makeTmpProject({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { baseUrl: '.', paths: { '@a/*': 42 } },
            }),
            'src/consumer.ts': 'export {};\n',
        });

        const target = resolveForFile({
            filename: `${proj}/src/consumer.ts`,
            cwd: proj,
            settings: { weld: { repoRoot: proj } },
        });

        expect(target.getFromFile()).toBe('/src/consumer.ts');
        expect(target.getAliases()).toEqual([]);
    });

    it('settings.weld.tsconfig выбирает имя конфигурации для автопоиска', () => {
        const proj = makeTmpProject({
            'tsconfig.app.json': JSON.stringify({
                compilerOptions: { baseUrl: '.', paths: { '@app/*': ['app/*'] } },
            }),
            'src/consumer.ts': 'export {};\n',
        });

        const target = resolveForFile({
            filename: `${proj}/src/consumer.ts`,
            cwd: proj,
            settings: { weld: { repoRoot: proj, tsconfig: 'tsconfig.app.json' } },
        });

        expect(target.getAliases()).toEqual([{ prefix: '@app', anchor: '/app', star: true }]);
    });
});

describe('resolveForFile: ленивость', () => {
    it('resolveForFile и части, которым алиасы не нужны, не бросают на кривых aliases', () => {
        const target = resolveForFile({
            filename: `${repoRoot}/src/config/resolve.ts`,
            cwd: repoRoot,
            settings: { weld: { repoRoot, aliases: 'nope' } },
        });

        expect(() => target.getFromFile()).not.toThrow();
        expect(() => target.getRoot()).not.toThrow();
        expect(target.getRoot()).toBe(repoRoot);
        expect(() => target.getAliases()).toThrow('settings.weld.aliases must be an object');
    });

    it('исключение не запоминается: кривые aliases бросают на каждом обращении', () => {
        const target = resolveForFile(
            {
                filename: '/src/feature/file.ts',
                cwd: '/cwd',
                settings: { weld: { aliases: 'nope' } },
            },
            createFakeFsHost([]),
        );

        expect(() => target.getAliases()).toThrow();
        expect(() => target.getAliases()).toThrow();
    });

    it('tsconfig читается один раз на все части', () => {
        const target = resolveForFile({
            filename: `${tsconfigBasicFixture}/src/consumer.ts`,
            cwd: tsconfigBasicFixture,
            settings: { weld: { repoRoot: tsconfigBasicFixture } },
        });

        expect(loadTsconfigPathsMock).not.toHaveBeenCalled();

        target.getRoot();
        expect(loadTsconfigPathsMock).toHaveBeenCalledTimes(1);

        target.getFsHost();
        target.getFromFile();
        target.getAliases();
        target.getAliases();
        expect(loadTsconfigPathsMock).toHaveBeenCalledTimes(1);
    });

    it('при явных алиасах getRoot() не разбирает settings.weld.tsconfig', () => {
        const target = resolveForFile({
            filename: `${repoRoot}/src/config/resolve.ts`,
            cwd: repoRoot,
            settings: {
                weld: { repoRoot, tsconfig: 42, aliases: { '@a/*': ['src/a/*'] } },
            },
        });

        expect(() => target.getRoot()).not.toThrow();
        expect(target.getRoot()).toBe(repoRoot);
        expect(target.getAliases()).toEqual([{ prefix: '@a', anchor: '/src/a', star: true }]);
        expect(loadTsconfigPathsMock).not.toHaveBeenCalled();
    });

    it('без явных алиасов кривой тип settings.weld.tsconfig доходит исключением', () => {
        const target = resolveForFile({
            filename: `${repoRoot}/src/config/resolve.ts`,
            cwd: repoRoot,
            settings: { weld: { repoRoot, tsconfig: 42 } },
        });

        expect(() => target.getRoot()).toThrow('settings.weld.tsconfig must be a string');
    });
});
