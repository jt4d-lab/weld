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

    it('передаёт кастомное имя конфигурации в read-шов', () => {
        const read = vi.fn((_searchDir: string, configName: string) => {
            expect(configName).toBe('tsconfig.app.json');
            return {
                path: '/proj/tsconfig.app.json',
                config: { compilerOptions: { paths: { '@/*': ['./src/*'] } } },
            } as unknown as ReturnType<typeof getTsconfig>;
        });

        const result = loadTsconfigPaths('/proj/src/file.ts', {
            configName: 'tsconfig.app.json',
            read,
        });

        expect(read).toHaveBeenCalledWith('/proj/src', 'tsconfig.app.json');
        expect(result?.configPath).toBe('/proj/tsconfig.app.json');
    });

    it('по умолчанию передаёт `tsconfig.json` в read-шов', () => {
        const read = vi.fn(() => null);

        loadTsconfigPaths('/proj/src/file.ts', { read });

        expect(read).toHaveBeenCalledWith('/proj/src', 'tsconfig.json');
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

    it('разные имена имеют независимые результаты и TTL', () => {
        const read = vi.fn(
            (_searchDir: string, configName: string) =>
                ({
                    path: `/proj/${configName}`,
                    config: { compilerOptions: { paths: { '@/*': [`${configName}/*`] } } },
                }) as unknown as ReturnType<typeof getTsconfig>,
        );
        let time = 0;
        const now = () => time;
        const file = '/proj/src/file.ts';

        expect(
            loadTsconfigPaths(file, { configName: 'tsconfig.a.json', read, now })?.paths,
        ).toEqual({
            '@/*': ['tsconfig.a.json/*'],
        });
        time = 599_999;
        expect(
            loadTsconfigPaths(file, { configName: 'tsconfig.b.json', read, now })?.paths,
        ).toEqual({
            '@/*': ['tsconfig.b.json/*'],
        });
        time = 600_001;
        loadTsconfigPaths(file, { configName: 'tsconfig.a.json', read, now });
        loadTsconfigPaths(file, { configName: 'tsconfig.b.json', read, now });

        expect(read).toHaveBeenCalledTimes(3);
        expect(read).toHaveBeenNthCalledWith(1, '/proj/src', 'tsconfig.a.json');
        expect(read).toHaveBeenNthCalledWith(2, '/proj/src', 'tsconfig.b.json');
        expect(read).toHaveBeenNthCalledWith(3, '/proj/src', 'tsconfig.a.json');
    });

    it('одно имя в разных директориях имеет независимые результаты', () => {
        const read = vi.fn((searchDir: string, configName: string) => {
            const project = searchDir.startsWith('/proj-a') ? 'a' : 'b';
            return {
                path: `/proj-${project}/${configName}`,
                config: {
                    compilerOptions: {
                        paths: { '@/*': [`${project}/target/*`] },
                    },
                },
            } as unknown as ReturnType<typeof getTsconfig>;
        });
        const now = () => 0;
        const configName = 'tsconfig.app.json';

        expect(loadTsconfigPaths('/proj-a/src/file.ts', { configName, read, now })?.paths).toEqual({
            '@/*': ['a/target/*'],
        });
        expect(loadTsconfigPaths('/proj-b/src/file.ts', { configName, read, now })?.paths).toEqual({
            '@/*': ['b/target/*'],
        });

        loadTsconfigPaths('/proj-a/src/other.ts', { configName, read, now });
        loadTsconfigPaths('/proj-b/src/other.ts', { configName, read, now });

        expect(read).toHaveBeenCalledTimes(2);
        expect(read).toHaveBeenNthCalledWith(1, '/proj-a/src', configName);
        expect(read).toHaveBeenNthCalledWith(2, '/proj-b/src', configName);
    });

    it('отрицательный результат (null) тоже кэшируется — в пределах своего короткого TTL', () => {
        const read = vi.fn(getTsconfig);
        let time = 0;
        const now = () => time;
        const file = `${tsconfigNoPathsFixture}/src/consumer.ts`;

        expect(loadTsconfigPaths(file, { read, now })).toBeNull();
        time = 4_999;
        expect(loadTsconfigPaths(file, { read, now })).toBeNull();
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('отрицательный результат протухает раньше положительного — через 5 секунд', () => {
        const read = vi.fn(getTsconfig);
        let time = 0;
        const now = () => time;
        const file = `${tsconfigNoPathsFixture}/src/consumer.ts`;

        loadTsconfigPaths(file, { read, now });
        time = 5_001;
        loadTsconfigPaths(file, { read, now });

        expect(read).toHaveBeenCalledTimes(2);
    });

    it('добавленные в tsconfig paths подхватываются через негативный TTL (дефолтное чтение, без шва read)', () => {
        const proj = makeTmpProject({
            'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
            'src/consumer.ts': 'export {};\n',
        });
        let time = 0;
        const now = () => time;
        const file = `${proj}/src/consumer.ts`;

        expect(loadTsconfigPaths(file, { now })).toBeNull();

        writeFileSync(
            `${proj}/tsconfig.json`,
            JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
        );
        time = 5_001;

        expect(loadTsconfigPaths(file, { now })?.paths).toEqual({ '@/*': ['./src/*'] });
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
