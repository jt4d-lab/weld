import { writeFileSync } from 'node:fs';

import { getTsconfig } from 'get-tsconfig';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    cleanupTmpProjects,
    makeTmpProject,
    tsconfigBasicFixture,
    tsconfigBrokenFixture,
    tsconfigExtendsPackageFixture,
    tsconfigJsoncFixture,
    tsconfigMonorepoFixture,
    tsconfigNoPathsFixture,
} from '@/testing/index.js';

import { loadTsconfigPaths, resetTsconfigCache } from '@/tsconfig/load.js';

afterEach(() => {
    resetTsconfigCache();
    cleanupTmpProjects();
});

describe('loadTsconfigPaths: поиск и разбор', () => {
    it('обычный проект: paths, realBaseDir от baseUrl, configPath', () => {
        const result = loadTsconfigPaths(`${tsconfigBasicFixture}/src/consumer.ts`);

        expect(result).toEqual({
            paths: { '@/*': ['./*'], '#lib': ['./lib/index.ts'] },
            realBaseDir: `${tsconfigBasicFixture}/src`,
            configPath: `${tsconfigBasicFixture}/tsconfig.json`,
            realAnchors: [
                `${tsconfigBasicFixture}/src`,
                `${tsconfigBasicFixture}/src/lib/index.ts`,
            ],
        });
    });

    it('монорепа: extends отработал, realBaseDir у корня фикстуры', () => {
        const result = loadTsconfigPaths(`${tsconfigMonorepoFixture}/packages/app/src/consumer.ts`);

        expect(result).toEqual({
            paths: { '@shared/*': ['shared/*'] },
            realBaseDir: tsconfigMonorepoFixture,
            configPath: `${tsconfigMonorepoFixture}/packages/app/tsconfig.json`,
            realAnchors: [`${tsconfigMonorepoFixture}/shared`],
        });
    });

    it('extends в пакет из локальной node_modules', () => {
        const result = loadTsconfigPaths(`${tsconfigExtendsPackageFixture}/src/consumer.ts`);

        expect(result).toEqual({
            paths: { '@pkg/*': ['src/*'] },
            realBaseDir: tsconfigExtendsPackageFixture,
            configPath: `${tsconfigExtendsPackageFixture}/tsconfig.json`,
            realAnchors: [`${tsconfigExtendsPackageFixture}/src`],
        });
    });

    it('JSONC: комментарии и висячие запятые не мешают', () => {
        const result = loadTsconfigPaths(`${tsconfigJsoncFixture}/app/consumer.ts`);

        expect(result).toEqual({
            paths: { '~/*': ['app/*'] },
            realBaseDir: tsconfigJsoncFixture,
            configPath: `${tsconfigJsoncFixture}/tsconfig.json`,
            realAnchors: [`${tsconfigJsoncFixture}/app`],
        });
    });

    it('битый JSON → null, не исключение', () => {
        expect(loadTsconfigPaths(`${tsconfigBrokenFixture}/src/consumer.ts`)).toBeNull();
    });

    it('валидный tsconfig без compilerOptions.paths → null', () => {
        expect(loadTsconfigPaths(`${tsconfigNoPathsFixture}/src/consumer.ts`)).toBeNull();
    });

    it('нет tsconfig вовсе → null', () => {
        const dir = makeTmpProject();

        expect(loadTsconfigPaths(`${dir}/consumer.ts`)).toBeNull();
    });

    it('неабсолютный путь файла (<input> из RuleTester) → null без обращения к диску', () => {
        const read = vi.fn(getTsconfig);

        expect(loadTsconfigPaths('<input>', { read })).toBeNull();
        expect(loadTsconfigPaths('relative/consumer.ts', { read })).toBeNull();
        expect(read).not.toHaveBeenCalled();
    });

    it('якоря внутри node_modules исключаются из realAnchors, нестроковые значения пропускаются', () => {
        const read = () =>
            ({
                path: '/proj/tsconfig.json',
                config: {
                    compilerOptions: {
                        paths: {
                            'dep/*': ['./node_modules/dep/*'],
                            '@a/*': ['src/*'],
                            '@typo': 'src/typo',
                            '@bad/*': [42],
                        },
                    },
                },
            }) as unknown as ReturnType<typeof getTsconfig>;

        const result = loadTsconfigPaths('/proj/src/file.ts', { read });

        expect(result?.realAnchors).toEqual(['/proj/src', '/proj/src/typo']);
    });

    it('пустой compilerOptions.paths → null', () => {
        const read = () =>
            ({
                path: '/proj/tsconfig.json',
                config: { compilerOptions: { paths: {} } },
            }) as unknown as ReturnType<typeof getTsconfig>;

        expect(loadTsconfigPaths('/proj/src/file.ts', { read })).toBeNull();
    });

    it('paths без baseUrl в extends-базе: realBaseDir — директория объявившего конфига', () => {
        const proj = makeTmpProject({
            'tsconfig.base.json': JSON.stringify({
                compilerOptions: { paths: { '@shared/*': ['./shared/*'] } },
            }),
            'packages/app/tsconfig.json': JSON.stringify({ extends: '../../tsconfig.base.json' }),
            'packages/app/src/consumer.ts': 'export {};\n',
        });

        const result = loadTsconfigPaths(`${proj}/packages/app/src/consumer.ts`);

        expect(result).toEqual({
            paths: { '@shared/*': ['./shared/*'] },
            realBaseDir: proj,
            configPath: `${proj}/packages/app/tsconfig.json`,
            realAnchors: [`${proj}/shared`],
        });
    });

    it('подстановка ${configDir}: абсолютные значения paths переписаны относительно realBaseDir', () => {
        const proj = makeTmpProject({
            'tsconfig.json': JSON.stringify({
                compilerOptions: {
                    baseUrl: '${configDir}',
                    paths: { '@/*': ['${configDir}/src/*'] },
                },
            }),
            'src/consumer.ts': 'export {};\n',
        });

        const result = loadTsconfigPaths(`${proj}/src/consumer.ts`);

        expect(result).toEqual({
            paths: { '@/*': ['src/*'] },
            realBaseDir: proj,
            configPath: `${proj}/tsconfig.json`,
            realAnchors: [`${proj}/src`],
        });
    });

    it('подстановка ${configDir}/* в саму базу: значение становится `./*`, а не голой `*`', () => {
        const proj = makeTmpProject({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { paths: { '~/*': ['${configDir}/*'] } },
            }),
            'src/consumer.ts': 'export {};\n',
        });

        const result = loadTsconfigPaths(`${proj}/src/consumer.ts`);

        expect(result).toEqual({
            paths: { '~/*': ['./*'] },
            realBaseDir: proj,
            configPath: `${proj}/tsconfig.json`,
            realAnchors: [proj],
        });
    });

    it('записи с кривой формой `*` не попадают в realAnchors и root не поднимают', () => {
        const read = () =>
            ({
                path: '/proj/tsconfig.json',
                config: {
                    compilerOptions: {
                        paths: {
                            'mid/*/x': ['../above/*/x'],
                            '*': ['../everything/*'],
                            '@ok/*': ['src/*', '../bad-*-middle/*'],
                        },
                    },
                },
            }) as unknown as ReturnType<typeof getTsconfig>;

        const result = loadTsconfigPaths('/proj/src/file.ts', { read });

        expect(result?.realAnchors).toEqual(['/proj/src']);
    });

    it('исключение из чтения tsconfig перехватывается → null', () => {
        const read = vi.fn(() => {
            throw new Error('extends target not found');
        });

        expect(loadTsconfigPaths(`${tsconfigBasicFixture}/src/consumer.ts`, { read })).toBeNull();
    });
});

describe('loadTsconfigPaths: TTL-кэш', () => {
    it('повторный вызов для той же директории в пределах TTL не перечитывает диск', () => {
        const read = vi.fn(getTsconfig);
        let time = 0;
        const now = () => time;
        const file = `${tsconfigBasicFixture}/src/consumer.ts`;

        const first = loadTsconfigPaths(file, { read, now });
        time = 599_999;
        const second = loadTsconfigPaths(file, { read, now });

        expect(read).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
    });

    it('второй файл из той же директории попадает в ту же запись кэша', () => {
        const read = vi.fn(getTsconfig);
        const now = () => 0;

        loadTsconfigPaths(`${tsconfigBasicFixture}/src/consumer.ts`, { read, now });
        loadTsconfigPaths(`${tsconfigBasicFixture}/src/other.ts`, { read, now });

        expect(read).toHaveBeenCalledTimes(1);
    });

    it('отрицательный результат (null) тоже кэшируется', () => {
        const read = vi.fn(getTsconfig);
        const now = () => 0;
        const file = `${tsconfigNoPathsFixture}/src/consumer.ts`;

        expect(loadTsconfigPaths(file, { read, now })).toBeNull();
        expect(loadTsconfigPaths(file, { read, now })).toBeNull();
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('после сдвига часов за 10 минут — перечитывает диск', () => {
        const read = vi.fn(getTsconfig);
        let time = 0;
        const now = () => time;
        const file = `${tsconfigBasicFixture}/src/consumer.ts`;

        loadTsconfigPaths(file, { read, now });
        time = 600_001;
        loadTsconfigPaths(file, { read, now });

        expect(read).toHaveBeenCalledTimes(2);
    });

    it('правка tsconfig подхватывается после истечения TTL (дефолтное чтение, без шва read)', () => {
        const proj = makeTmpProject({
            'tsconfig.json': JSON.stringify({
                compilerOptions: { paths: { '@/*': ['./before/*'] } },
            }),
            'src/consumer.ts': 'export {};\n',
        });
        let time = 0;
        const now = () => time;
        const file = `${proj}/src/consumer.ts`;

        expect(loadTsconfigPaths(file, { now })?.paths).toEqual({ '@/*': ['./before/*'] });

        writeFileSync(
            `${proj}/tsconfig.json`,
            JSON.stringify({ compilerOptions: { paths: { '@/*': ['./after/*'] } } }),
        );
        time = 600_001;

        expect(loadTsconfigPaths(file, { now })?.paths).toEqual({ '@/*': ['./after/*'] });
    });

    it('resetTsconfigCache сбрасывает кэш', () => {
        const read = vi.fn(getTsconfig);
        const now = () => 0;
        const file = `${tsconfigBasicFixture}/src/consumer.ts`;

        loadTsconfigPaths(file, { read, now });
        resetTsconfigCache();
        loadTsconfigPaths(file, { read, now });

        expect(read).toHaveBeenCalledTimes(2);
    });
});
