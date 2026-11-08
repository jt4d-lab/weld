import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getAliasesFromPaths,
    getSectionError,
    getScheme,
    getTsconfigName,
} from '@/raw-settings/index.js';
import {
    getAliases,
    getAliasesBaseUrl,
    getRepoRoot,
    hasAliases,
    resetSettingsCaches,
} from '@/raw-settings/weld.js';

afterEach(() => {
    resetSettingsCaches();
});

describe('getRepoRoot', () => {
    it('repoRoot задан → возвращается как есть, без резолва', () => {
        expect(getRepoRoot({ weld: { repoRoot: '../repo' } })).toBe('../repo');
    });

    it('нет settings.weld → undefined', () => {
        expect(getRepoRoot({})).toBeUndefined();
    });

    it('repoRoot не строка → исключение называет тип', () => {
        expect(() => getRepoRoot({ weld: { repoRoot: 42 } })).toThrow(
            'settings.weld.repoRoot must be a string, got number',
        );
    });

    it('settings.weld не объект → исключение', () => {
        expect(() => getRepoRoot({ weld: 'nope' })).toThrow('settings.weld must be an object');
    });
});

describe('getTsconfigName', () => {
    it("нет настройки → 'tsconfig.json'", () => {
        expect(getTsconfigName({})).toBe('tsconfig.json');
        expect(getTsconfigName({ weld: {} })).toBe('tsconfig.json');
    });

    it('значение из settings.weld возвращается как есть', () => {
        expect(getTsconfigName({ weld: { tsconfig: 'tsconfig.app.json' } })).toBe(
            'tsconfig.app.json',
        );
    });

    it('override имеет приоритет над settings.weld', () => {
        expect(
            getTsconfigName({ weld: { tsconfig: 'tsconfig.app.json' } }, 'tsconfig.test.json'),
        ).toBe('tsconfig.test.json');
    });

    it('нестроковое значение в settings.weld → исключение называет тип', () => {
        expect(() => getTsconfigName({ weld: { tsconfig: 42 } })).toThrow(
            'settings.weld.tsconfig must be a string, got number',
        );
    });

    it('нестроковый override → исключение называет options.tsconfig', () => {
        expect(() => getTsconfigName({}, 42)).toThrow(
            'options.tsconfig must be a string, got number',
        );
    });
});

describe('getAliasesBaseUrl', () => {
    it('aliasesBaseUrl задан → возвращается как есть', () => {
        expect(getAliasesBaseUrl({ weld: { aliasesBaseUrl: 'packages/app' } })).toBe(
            'packages/app',
        );
    });

    it("aliasesBaseUrl не задан → '.'", () => {
        expect(getAliasesBaseUrl({})).toBe('.');
    });

    it('aliasesBaseUrl не строка → исключение называет тип', () => {
        expect(() => getAliasesBaseUrl({ weld: { aliasesBaseUrl: 42 } })).toThrow(
            'settings.weld.aliasesBaseUrl must be a string, got number',
        );
    });
});

describe('getAliases', () => {
    it('якоря отсчитываются от aliasesBaseUrl: тот же объект aliases при другом aliasesBaseUrl дает другие якоря', () => {
        const aliases = { '@src/*': ['src/*'] };

        const fromRoot = getAliases({ weld: { aliases } });
        const fromApp = getAliases({ weld: { aliasesBaseUrl: 'packages/app', aliases } });

        expect(fromRoot).toEqual([{ prefix: '@src', anchor: '/src', star: true }]);
        expect(fromApp).toEqual([{ prefix: '@src', anchor: '/packages/app/src', star: true }]);
    });

    it('нет settings.weld → пустой массив', () => {
        expect(getAliases({})).toEqual([]);
    });

    it('settings.weld не объект → исключение', () => {
        expect(() => getAliases({ weld: 'nope' })).toThrow('settings.weld must be an object');
    });

    it('settings.weld — массив → принимается как объект (typeof [] === "object")', () => {
        expect(getAliases({ weld: [] })).toEqual([]);
    });
});

describe('getAliases — кэш', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('те же аргументы → тот же массив, без повторного разбора', () => {
        const settings = { weld: { aliases: { '@src/*': ['src/*'] } } };

        expect(getAliases(settings)).toBe(getAliases(settings));
    });

    it('другой settings → разбор заново', () => {
        const aliases = { '@src/*': ['src/*'] };

        expect(getAliases({ weld: { aliases } })).not.toBe(getAliases({ weld: { aliases } }));
    });

    it('тот же settings, но другой override → разбор заново', () => {
        const settings = { weld: { aliases: { '@src/*': ['src/*'] } } };

        expect(getAliases(settings, { '@lib/*': ['lib/*'] })).toEqual([
            { prefix: '@lib', anchor: '/lib', star: true },
        ]);
        expect(getAliases(settings)).toEqual([{ prefix: '@src', anchor: '/src', star: true }]);
    });

    it('два конфига не вытесняют друг друга — записей в кэше несколько', () => {
        const first = { weld: { aliases: { '@a/*': ['a/*'] } } };
        const second = { weld: { aliases: { '@b/*': ['b/*'] } } };

        const fromFirst = getAliases(first);
        getAliases(second);

        expect(getAliases(first)).toBe(fromFirst);
    });

    it('через минуту запись протухает — разбор заново', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const settings = { weld: { aliases: { '@src/*': ['src/*'] } } };

        const fresh = getAliases(settings);
        vi.setSystemTime(60_001);

        expect(getAliases(settings)).not.toBe(fresh);
        expect(getAliases(settings)).toEqual([{ prefix: '@src', anchor: '/src', star: true }]);
    });

    it('сломанный конфиг падает на каждом вызове, а не только на первом', () => {
        const settings = { weld: { aliases: 'nope' } };

        expect(() => getAliases(settings)).toThrow('settings.weld.aliases must be an object');
        expect(() => getAliases(settings)).toThrow('settings.weld.aliases must be an object');
    });
});

describe('getAliasesFromPaths', () => {
    it('валидные paths дают те же Alias[], что settings.weld.aliases с тем же базовым путем', () => {
        const paths = { '@src/*': ['src/*'], '@lib': ['lib/index.ts'] };

        const fromPaths = getAliasesFromPaths(paths, '/packages/app', 'tsconfig.json');
        const fromSettings = getAliases({
            weld: { aliasesBaseUrl: 'packages/app', aliases: paths },
        });

        expect(fromPaths).toEqual(fromSettings);
        expect(fromPaths).toEqual([
            { prefix: '@src', anchor: '/packages/app/src', star: true },
            { prefix: '@lib', anchor: '/packages/app/lib', star: false },
        ]);
    });

    it('база — виртуальный корень', () => {
        expect(getAliasesFromPaths({ '@src/*': ['src/*'] }, '/', 'tsconfig.json')).toEqual([
            { prefix: '@src', anchor: '/src', star: true },
        ]);
    });

    it('source попадает в текст ошибки', () => {
        expect(() => getAliasesFromPaths({ '@bad': 42 }, '/', '/repo/tsconfig.json')).toThrow(
            "/repo/tsconfig.json['@bad'] must be a string or an array of strings",
        );
    });

    it('ошибочное значение paths вызывает такую же ошибку, как settings.weld.aliases', () => {
        expect(() => getAliasesFromPaths('nope', '/', 'tsconfig.json')).toThrow(
            'tsconfig.json must be an object',
        );
    });
});

describe('hasAliases', () => {
    it('ключ aliases отсутствует → false', () => {
        expect(hasAliases({}, undefined)).toBe(false);
        expect(hasAliases({ weld: {} }, undefined)).toBe(false);
        expect(hasAliases({ weld: { repoRoot: '/repo' } }, undefined)).toBe(false);
    });

    it('пустой объект {} в settings.weld.aliases → true', () => {
        expect(hasAliases({ weld: { aliases: {} } }, undefined)).toBe(true);
    });

    it('непустые aliases в settings.weld → true', () => {
        expect(hasAliases({ weld: { aliases: { '@src/*': ['src/*'] } } }, undefined)).toBe(true);
    });

    it('override учитывается: задан → true, даже без settings', () => {
        expect(hasAliases({}, {})).toBe(true);
        expect(hasAliases({}, { '@src/*': ['src/*'] })).toBe(true);
    });

    it('при заданном override settings не читается — сломанный settings.weld не мешает', () => {
        expect(hasAliases({ weld: 'nope' }, {})).toBe(true);
    });
});

describe('getScheme', () => {
    it('srcDir и modulesDir по умолчанию — /src и modules', () => {
        expect(
            getScheme({ weld: { layers: ['app', '@modules'], moduleLayers: ['features'] } }),
        ).toEqual({
            srcDir: '/src',
            modulesDir: 'modules',
            layers: ['app', '@modules'],
            moduleLayers: ['features'],
            flatModules: false,
        });
    });

    it('значения из settings.weld перекрывают значения по умолчанию', () => {
        expect(
            getScheme({
                weld: {
                    srcDir: 'app',
                    modulesDir: 'mods',
                    layers: ['ui', '@modules'],
                    moduleLayers: ['widgets'],
                },
            }),
        ).toEqual({
            srcDir: '/app',
            modulesDir: 'mods',
            layers: ['ui', '@modules'],
            moduleLayers: ['widgets'],
            flatModules: false,
        });
    });

    it('каждая опция целиком перекрывает одноименную настройку', () => {
        const settings = {
            weld: {
                srcDir: 'app',
                modulesDir: 'mods',
                layers: ['ui', '@modules'],
                moduleLayers: ['widgets'],
            },
        };

        expect(
            getScheme(settings, {
                srcDir: 'source',
                modulesDir: 'nested',
                layers: ['pages', '@modules'],
                moduleLayers: ['entities'],
            }),
        ).toEqual({
            srcDir: '/source',
            modulesDir: 'nested',
            layers: ['pages', '@modules'],
            moduleLayers: ['entities'],
            flatModules: false,
        });
    });

    it('опции задают схему целиком — settings может быть пустым', () => {
        expect(getScheme({}, { layers: ['app', '@modules'], moduleLayers: ['features'] })).toEqual({
            srcDir: '/src',
            modulesDir: 'modules',
            layers: ['app', '@modules'],
            moduleLayers: ['features'],
            flatModules: false,
        });
    });

    it('нет layers → исключение называет settings.weld.layers', () => {
        expect(() => getScheme({})).toThrow('settings.weld.layers is required');
    });

    it('схема без модулей — пустой moduleLayers и flatModules как задан', () => {
        expect(getScheme({ weld: { layers: ['app', 'common'], flatModules: true } })).toEqual({
            srcDir: '/src',
            modulesDir: 'modules',
            layers: ['app', 'common'],
            moduleLayers: [],
            flatModules: true,
        });
    });

    it('кривая схема в опциях → исключение называет options.<поле>', () => {
        expect(() => getScheme({}, { layers: [], moduleLayers: ['features'] })).toThrow(
            'options.layers must not be empty',
        );
    });

    it('кривой srcDir в опциях → исключение называет options.srcDir', () => {
        expect(() => getScheme({}, { srcDir: '../out' })).toThrow(
            'options.srcDir must not point above the repository root',
        );
    });

    it('кривой modulesDir в опциях → исключение называет options.modulesDir', () => {
        expect(() => getScheme({}, { modulesDir: 'a/b' })).toThrow(
            'options.modulesDir must be a single directory name',
        );
    });

    it('пустой moduleLayers в опциях → исключение называет options.moduleLayers', () => {
        expect(() => getScheme({}, { layers: ['app', '@modules'], moduleLayers: [] })).toThrow(
            'options.moduleLayers must not be empty',
        );
    });

    it('settings.weld не объект → исключение', () => {
        expect(() => getScheme({ weld: 'nope' })).toThrow('settings.weld must be an object');
    });

    it('секция читается, пока хоть один список из секции — сломанная секция падает', () => {
        expect(() => getScheme({ weld: 'nope' }, { flatModules: true })).toThrow(
            'settings.weld must be an object',
        );
    });

    it('списки из опций, скаляры без override — скаляры берутся из settings.weld', () => {
        const settings = {
            weld: {
                srcDir: 'app',
                modulesDir: 'mods',
                flatModules: true,
                layers: ['ui', '@modules'],
                moduleLayers: ['widgets'],
            },
        };

        expect(
            getScheme(settings, { layers: ['pages', '@modules'], moduleLayers: ['features'] }),
        ).toEqual({
            srcDir: '/app',
            modulesDir: 'mods',
            layers: ['pages', '@modules'],
            moduleLayers: ['features'],
            flatModules: true,
        });
    });

    it('списки из опций, скаляры без override — сломанная секция падает', () => {
        expect(() =>
            getScheme(
                { weld: 'nope' },
                { layers: ['app', '@modules'], moduleLayers: ['features'] },
            ),
        ).toThrow('settings.weld must be an object');
    });

    it('схема перекрыта опциями целиком — сломанная секция не читается', () => {
        expect(
            getScheme(
                { weld: 'nope' },
                {
                    srcDir: 'app',
                    modulesDir: 'mods',
                    layers: ['pages', '@modules'],
                    moduleLayers: ['features'],
                    flatModules: true,
                },
            ),
        ).toEqual({
            srcDir: '/app',
            modulesDir: 'mods',
            layers: ['pages', '@modules'],
            moduleLayers: ['features'],
            flatModules: true,
        });
    });

    it('секция не читается при полном перекрытии — кривое поле дает ошибку из опций', () => {
        expect(() =>
            getScheme(
                { weld: 'nope' },
                {
                    srcDir: 'app',
                    modulesDir: 'mods',
                    layers: ['app', '@modules'],
                    moduleLayers: [],
                    flatModules: true,
                },
            ),
        ).toThrow('options.moduleLayers must not be empty');
    });

    it('flatModules по умолчанию false', () => {
        expect(
            getScheme({ weld: { layers: ['app', '@modules'], moduleLayers: ['features'] } })
                .flatModules,
        ).toBe(false);
    });

    it('опция правила перекрывает flatModules из settings.weld', () => {
        const settings = {
            weld: { flatModules: true, layers: ['app', '@modules'], moduleLayers: ['features'] },
        };

        expect(getScheme(settings).flatModules).toBe(true);
        expect(getScheme(settings, { flatModules: false }).flatModules).toBe(false);
    });

    it('кривой flatModules → исключение называет options.flatModules', () => {
        expect(() =>
            getScheme(
                { weld: { layers: ['app', '@modules'], moduleLayers: ['features'] } },
                { flatModules: 'no' },
            ),
        ).toThrow('options.flatModules must be a boolean, got string');
    });
});

describe('getScheme — кэш', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('те же аргументы → та же схема, без повторного разбора', () => {
        const settings = { weld: { layers: ['app', '@modules'], moduleLayers: ['features'] } };

        expect(getScheme(settings)).toBe(getScheme(settings));
    });

    it('другой settings → разбор заново', () => {
        const weld = { layers: ['app', '@modules'], moduleLayers: ['features'] };

        expect(getScheme({ weld })).not.toBe(getScheme({ weld }));
    });

    it('тот же settings, но другие опции → разбор заново', () => {
        const settings = { weld: { layers: ['app', '@modules'], moduleLayers: ['features'] } };

        expect(getScheme(settings, { srcDir: 'app' }).srcDir).toBe('/app');
        expect(getScheme(settings).srcDir).toBe('/src');
    });

    it('разное flatModules → разные результаты, одинаковое → тот же объект', () => {
        const settings = { weld: { layers: ['app', '@modules'], moduleLayers: ['features'] } };

        const flat = getScheme(settings, { flatModules: true });
        expect(flat).toBe(getScheme(settings, { flatModules: true }));
        expect(getScheme(settings, { flatModules: false })).not.toBe(flat);
    });

    it('через минуту запись протухает — разбор заново', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const settings = { weld: { layers: ['app', '@modules'], moduleLayers: ['features'] } };

        const fresh = getScheme(settings);
        vi.setSystemTime(60_001);

        expect(getScheme(settings)).not.toBe(fresh);
        expect(getScheme(settings)).toEqual(fresh);
    });

    it('сломанная схема падает на каждом вызове, а не только на первом', () => {
        const settings = { weld: { layers: ['app'], moduleLayers: ['features'] } };

        expect(() => getScheme(settings)).toThrow(
            'settings.weld.layers must contain the "@modules" marker',
        );
        expect(() => getScheme(settings)).toThrow(
            'settings.weld.layers must contain the "@modules" marker',
        );
    });
});

describe('override', () => {
    it('значение выигрывает у settings.weld', () => {
        const settings = { weld: { repoRoot: '/from-settings' } };

        expect(getRepoRoot(settings, '/from-override')).toBe('/from-override');
    });

    it('перекрытая настройка не читается из settings — сломанный settings.weld не мешает', () => {
        expect(getRepoRoot({ weld: 'nope' }, '/ok')).toBe('/ok');
    });

    it('override aliasesBaseUrl подставляется вместо конфига', () => {
        expect(getAliasesBaseUrl({ weld: { aliasesBaseUrl: 'packages/app' } }, 'other')).toBe(
            'other',
        );
    });

    it('override aliases разбирается с aliasesBaseUrl из settings', () => {
        expect(
            getAliases({ weld: { aliasesBaseUrl: 'packages/app' } }, { '@src/*': ['src/*'] }),
        ).toEqual([{ prefix: '@src', anchor: '/packages/app/src', star: true }]);
    });

    it('override aliasesBaseUrl задает якоря алиасам из settings', () => {
        const settings = {
            weld: { aliasesBaseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } },
        };

        expect(getAliases(settings, undefined, 'packages/other')).toEqual([
            { prefix: '@src', anchor: '/packages/other/src', star: true },
        ]);
    });

    it('пара override aliases + aliasesBaseUrl разбирается вместе', () => {
        const settings = {
            weld: { aliasesBaseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } },
        };

        expect(getAliases(settings, { '@lib/*': ['lib/*'] }, 'packages/other')).toEqual([
            { prefix: '@lib', anchor: '/packages/other/lib', star: true },
        ]);
    });

    it('тот же объект aliases при другом override aliasesBaseUrl дает другие якоря', () => {
        const aliases = { '@src/*': ['src/*'] };

        const fromApp = getAliases({}, aliases, 'packages/app');
        const fromOther = getAliases({}, aliases, 'packages/other');

        expect(fromApp).toEqual([{ prefix: '@src', anchor: '/packages/app/src', star: true }]);
        expect(fromOther).toEqual([{ prefix: '@src', anchor: '/packages/other/src', star: true }]);
    });

    it('override aliasesBaseUrl проверяется как options.aliasesBaseUrl и при разборе алиасов', () => {
        expect(() => getAliases({}, { '@src/*': ['src/*'] }, 42)).toThrow(
            'options.aliasesBaseUrl must be a string, got number',
        );
    });

    it('override не отменяет чтение остальных настроек', () => {
        const settings = { weld: { repoRoot: '/from-settings', aliasesBaseUrl: 'packages/app' } };

        expect(getAliasesBaseUrl(settings)).toBe('packages/app');
        expect(getRepoRoot(settings, '/other')).toBe('/other');
        expect(getRepoRoot(settings)).toBe('/from-settings');
    });
});

describe('override — валидация', () => {
    it('override repoRoot не строка → исключение называет options.repoRoot', () => {
        expect(() => getRepoRoot({}, 42)).toThrow('options.repoRoot must be a string, got number');
    });

    it('override aliasesBaseUrl не строка → исключение называет options.aliasesBaseUrl', () => {
        expect(() => getAliasesBaseUrl({}, 42)).toThrow(
            'options.aliasesBaseUrl must be a string, got number',
        );
    });

    it('override aliases не объект → исключение называет options.aliases', () => {
        expect(() => getAliases({}, 'nope')).toThrow('options.aliases must be an object');
    });

    it('ошибка внутри override aliases называет ключ и источник', () => {
        expect(() => getAliases({}, { '@bad': 42 })).toThrow(
            "options.aliases['@bad'] must be a string or an array of strings",
        );
    });
});

describe('getSectionError', () => {
    it('нет settings.weld → null', () => {
        expect(getSectionError({})).toBeNull();
    });

    it('settings.weld валидный объект → null', () => {
        expect(getSectionError({ weld: { repoRoot: '/repo' } })).toBeNull();
    });

    it('settings.weld не объект → возвращает сообщение об ошибке', () => {
        expect(getSectionError({ weld: 'nope' })).toBe('settings.weld must be an object');
    });

    it('settings не объект → null (нет секции)', () => {
        expect(getSectionError('string')).toBeNull();
    });
});
