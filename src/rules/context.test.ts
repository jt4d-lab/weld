import type { Rule } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeFsHost, resetFsHostCaches } from '@/host/index.js';
import { WELD_OPTION_PROPERTIES, resolveWeldContext } from '@/rules/context.js';
import {
    cleanupTmpProjects,
    makeTmpProject,
    repoRoot,
    tsconfigBasicFixture,
    tsconfigMonorepoFixture,
} from '@/testing/index.js';
import { resetTsconfigCache } from '@/tsconfig/index.js';

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
            repoRoot: { type: 'string' },
            aliasesBaseUrl: { type: 'string' },
            aliases: { type: 'object' },
        });
    });
});

describe('resolveWeldContext', () => {
    afterEach(() => {
        resetFsHostCaches();
        resetTsconfigCache();
    });

    it('файл внутри корня репозитория → виртуальный путь, алиасы и та же файловая система', () => {
        const fsHost = createFakeFsHost(['/src/other/index.ts']);

        const weld = resolveWeldContext(
            fakeContext({
                filename: '/src/feature/file.ts',
                settings: {
                    weld: { aliasesBaseUrl: '/', aliases: { '@other/*': ['src/other/*'] } },
                },
            }),
            fsHost,
        );

        expect(weld).not.toBeNull();
        expect(weld?.fromFile).toBe('/src/feature/file.ts');
        expect(weld?.aliases).toEqual([{ prefix: '@other', anchor: '/src/other' }]);
        expect(weld?.fsHost).toBe(fsHost);
    });

    it('файл вне корня репозитория → null', () => {
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

    it('options.aliases и options.aliasesBaseUrl перекрывают settings.weld', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/src/feature/file.ts',
                settings: {
                    weld: { aliasesBaseUrl: '/nowhere', aliases: { '@a/*': ['nowhere/*'] } },
                },
                options: [{ aliasesBaseUrl: '/', aliases: { '@a/*': ['src/a/*'] } }],
            }),
            createFakeFsHost([]),
        );

        expect(weld?.aliases).toEqual([{ prefix: '@a', anchor: '/src/a' }]);
    });

    it('без инъекции файловая система собирается из settings.weld.repoRoot', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/repo/src/feature/file.ts',
                settings: { weld: { repoRoot: '/repo' } },
            }),
        );

        expect(weld?.fromFile).toBe('/src/feature/file.ts');
    });

    it('options.repoRoot выигрывает у settings.weld.repoRoot', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/repo/src/feature/file.ts',
                settings: { weld: { repoRoot: '/nowhere' } },
                options: [{ repoRoot: '/repo' }],
            }),
        );

        expect(weld?.fromFile).toBe('/src/feature/file.ts');
    });

    it('при инъекции fsHost опция repoRoot ни на что не влияет', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/src/feature/file.ts',
                options: [{ repoRoot: '/nowhere' }],
            }),
            createFakeFsHost([]),
        );

        expect(weld?.fromFile).toBe('/src/feature/file.ts');
    });

    it('пустой {} в options.aliases выключает автопоиск: алиасов нет', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/src/feature/file.ts',
                settings: { weld: { aliases: { '@a/*': ['src/a/*'] } } },
                options: [{ aliases: {} }],
            }),
            createFakeFsHost([]),
        );

        expect(weld?.aliases).toEqual([]);
    });

    it('пустой {} в settings.weld.aliases выключает автопоиск: алиасов нет', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/src/feature/file.ts',
                settings: { weld: { aliases: {} } },
            }),
            createFakeFsHost([]),
        );

        expect(weld?.aliases).toEqual([]);
    });

    it('при fsHostOverride без явных алиасов tsconfig не читается: алиасов нет', () => {
        // Файл лежит внутри реальной фикстуры с tsconfig, но фейковая ФС выключает автопоиск.
        // Регресс здесь дал бы непустые алиасы из `${tsconfigBasicFixture}/tsconfig.json`.
        const file = `${tsconfigBasicFixture}/src/consumer.ts`;
        const weld = resolveWeldContext(fakeContext({ filename: file }), createFakeFsHost([file]));

        expect(weld?.aliases).toEqual([]);
    });

    it('settings.weld.aliasesBaseUrl без явных алиасов на автопоиск не влияет: алиасы пусты без tsconfig', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: '/src/feature/file.ts',
                settings: { weld: { aliasesBaseUrl: '/src' } },
            }),
            createFakeFsHost([]),
        );

        expect(weld?.aliases).toEqual([]);
    });

    it('явные settings.weld.aliases побеждают tsconfig и на реальной фикстуре', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: `${tsconfigBasicFixture}/src/consumer.ts`,
                settings: {
                    weld: { repoRoot: tsconfigBasicFixture, aliases: { '@x/*': ['src/*'] } },
                },
            }),
        );

        expect(weld?.aliases).toEqual([{ prefix: '@x', anchor: '/src' }]);
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

/** Виртуальный путь реального пути внутри этого репозитория — для тестов с авто-root. */
function virt(realPath: string): string {
    return realPath.slice(repoRoot.length);
}

describe('resolveWeldContext: автопоиск tsconfig', () => {
    afterEach(() => {
        resetFsHostCaches();
        resetTsconfigCache();
        cleanupTmpProjects();
    });

    it('без явных алиасов алиасы приходят из tsconfig внутри явного root', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: `${tsconfigBasicFixture}/src/consumer.ts`,
                settings: { weld: { repoRoot: tsconfigBasicFixture } },
            }),
        );

        expect(weld?.fromFile).toBe('/src/consumer.ts');
        expect(weld?.aliases).toEqual([
            { prefix: '@', anchor: '/src' },
            { prefix: '#lib', anchor: '/src/lib' },
        ]);
    });

    it('монорепа при авто-root: база extends и якоря виртуализируются от найденного root', () => {
        const file = `${tsconfigMonorepoFixture}/packages/app/src/consumer.ts`;

        const weld = resolveWeldContext(
            fakeContext({ filename: file, cwd: tsconfigMonorepoFixture }),
        );

        // Авто-root — `.git` этого репозитория; якоря фикстуры лежат ниже и root не поднимают.
        expect(weld?.fromFile).toBe(virt(file));
        expect(weld?.aliases).toEqual([
            { prefix: '@shared', anchor: virt(`${tsconfigMonorepoFixture}/shared`) },
        ]);
    });

    it('два файла из разных пакетов монорепы дают согласованный результат', () => {
        const appFile = `${tsconfigMonorepoFixture}/packages/app/src/consumer.ts`;
        const libFile = `${tsconfigMonorepoFixture}/packages/lib/src/consumer.ts`;

        const app = resolveWeldContext(
            fakeContext({ filename: appFile, cwd: tsconfigMonorepoFixture }),
        );
        const lib = resolveWeldContext(
            fakeContext({ filename: libFile, cwd: tsconfigMonorepoFixture }),
        );

        expect(app?.aliases).toEqual(lib?.aliases);
        // Один и тот же итоговый root → один инстанс файловой системы.
        expect(app?.fsHost).toBe(lib?.fsHost);
    });

    it('якоря extends-базы поднимают авто-root выше директории запуска', () => {
        const proj = makeTmpProject({
            'tsconfig.base.json': JSON.stringify({
                compilerOptions: { baseUrl: '.', paths: { '@shared/*': ['shared/*'] } },
            }),
            'packages/app/tsconfig.json': JSON.stringify({
                extends: '../../tsconfig.base.json',
            }),
            'packages/app/src/consumer.ts': 'export {};\n',
        });

        // `.git` над tmpdir нет: без якорей root остался бы `cwd` — сам пакет.
        const weld = resolveWeldContext(
            fakeContext({
                filename: `${proj}/packages/app/src/consumer.ts`,
                cwd: `${proj}/packages/app`,
            }),
        );

        expect(weld?.fromFile).toBe('/packages/app/src/consumer.ts');
        expect(weld?.aliases).toEqual([{ prefix: '@shared', anchor: '/shared' }]);
    });

    it('записи с якорем в node_modules не влияют на root; база вне root → алиасов нет', () => {
        const proj = makeTmpProject({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { baseUrl: '.', paths: { 'dep/*': ['node_modules/dep/*'] } },
            }),
            'app/src/consumer.ts': 'export {};\n',
        });

        // Единственный якорь — в node_modules: root остаётся `cwd`, база paths (корень проекта)
        // оказывается вне root → алиасов нет, но линт живой.
        const weld = resolveWeldContext(
            fakeContext({ filename: `${proj}/app/src/consumer.ts`, cwd: `${proj}/app` }),
        );

        expect(weld?.fromFile).toBe('/src/consumer.ts');
        expect(weld?.aliases).toEqual([]);
    });

    it('tsconfig выше явного root отбрасывается целиком: алиасов нет, линт живой', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: `${tsconfigBasicFixture}/src/consumer.ts`,
                settings: { weld: { repoRoot: `${tsconfigBasicFixture}/src` } },
            }),
        );

        expect(weld?.fromFile).toBe('/consumer.ts');
        expect(weld?.aliases).toEqual([]);
    });

    it('якорь выше явного root отброшен существующей валидацией, остальные живут', () => {
        const proj = makeTmpProject({
            'app/tsconfig.json': JSON.stringify({
                compilerOptions: {
                    baseUrl: '.',
                    paths: { '@out/*': ['../outside/*'], '@in/*': ['src/*'] },
                },
            }),
            'app/src/consumer.ts': 'export {};\n',
        });

        const weld = resolveWeldContext(
            fakeContext({
                filename: `${proj}/app/src/consumer.ts`,
                settings: { weld: { repoRoot: `${proj}/app` } },
            }),
        );

        expect(weld?.aliases).toEqual([{ prefix: '@in', anchor: '/src' }]);
    });

    it('кривые значения paths в tsconfig не валят линт: debug и алиасов нет', () => {
        const proj = makeTmpProject({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { baseUrl: '.', paths: { '@a/*': 42 } },
            }),
            'src/consumer.ts': 'export {};\n',
        });

        const weld = resolveWeldContext(
            fakeContext({
                filename: `${proj}/src/consumer.ts`,
                settings: { weld: { repoRoot: proj } },
            }),
        );

        expect(weld?.fromFile).toBe('/src/consumer.ts');
        expect(weld?.aliases).toEqual([]);
    });

    it('заданный settings.weld.aliasesBaseUrl на базу tsconfig-алиасов не влияет', () => {
        const weld = resolveWeldContext(
            fakeContext({
                filename: `${tsconfigBasicFixture}/src/consumer.ts`,
                settings: { weld: { repoRoot: tsconfigBasicFixture, aliasesBaseUrl: '/nowhere' } },
            }),
        );

        // База пришла из tsconfig (`./src`), а не из `settings.weld.aliasesBaseUrl`.
        expect(weld?.aliases).toEqual([
            { prefix: '@', anchor: '/src' },
            { prefix: '#lib', anchor: '/src/lib' },
        ]);
    });

    it('paths без baseUrl в extends-базе отсчитываются от объявившего их конфига', () => {
        // Современный стиль (TS 4.1+): база монорепы объявляет `paths` без `baseUrl` — записи
        // отсчитываются от `tsconfig.base.json`, а не от расширившего его пакета.
        const proj = makeTmpProject({
            'tsconfig.base.json': JSON.stringify({
                compilerOptions: { paths: { '@shared/*': ['./shared/*'] } },
            }),
            'packages/app/tsconfig.json': JSON.stringify({
                extends: '../../tsconfig.base.json',
            }),
            'packages/app/src/consumer.ts': 'export {};\n',
        });

        const weld = resolveWeldContext(
            fakeContext({
                filename: `${proj}/packages/app/src/consumer.ts`,
                cwd: `${proj}/packages/app`,
            }),
        );

        expect(weld?.fromFile).toBe('/packages/app/src/consumer.ts');
        expect(weld?.aliases).toEqual([{ prefix: '@shared', anchor: '/shared' }]);
    });

    it('подстановка ${configDir} в baseUrl и значениях paths даёт рабочие алиасы', () => {
        const proj = makeTmpProject({
            'tsconfig.json': JSON.stringify({
                compilerOptions: {
                    baseUrl: '${configDir}',
                    paths: { '@/*': ['${configDir}/src/*'] },
                },
            }),
            'src/consumer.ts': 'export {};\n',
        });

        const weld = resolveWeldContext(
            fakeContext({
                filename: `${proj}/src/consumer.ts`,
                settings: { weld: { repoRoot: proj } },
            }),
        );

        expect(weld?.fromFile).toBe('/src/consumer.ts');
        expect(weld?.aliases).toEqual([{ prefix: '@', anchor: '/src' }]);
    });
});
