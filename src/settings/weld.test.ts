import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAliasesFromPaths } from '@/settings/index.js';
import {
    getAliases,
    getAliasesBaseUrl,
    getLayerSchema,
    getRepoRoot,
    hasAliases,
    hasLayers,
} from '@/settings/weld.js';

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
    it('якоря отсчитываются от aliasesBaseUrl: тот же объект aliases при другом aliasesBaseUrl даёт другие якоря', () => {
        const aliases = { '@src/*': ['src/*'] };

        const fromRoot = getAliases({ weld: { aliases } });
        const fromApp = getAliases({ weld: { aliasesBaseUrl: 'packages/app', aliases } });

        expect(fromRoot).toEqual([{ prefix: '@src', anchor: '/src' }]);
        expect(fromApp).toEqual([{ prefix: '@src', anchor: '/packages/app/src' }]);
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

        expect(getAliases(settings, { aliases: { '@lib/*': ['lib/*'] } })).toEqual([
            { prefix: '@lib', anchor: '/lib' },
        ]);
        expect(getAliases(settings)).toEqual([{ prefix: '@src', anchor: '/src' }]);
    });

    it('та же ссылка на overrides → попадание в кэш, новый объект той же формы → промах', () => {
        const settings = { weld: {} };
        const overrides = { aliases: { '@src/*': ['src/*'] } };

        const first = getAliases(settings, overrides);

        // Ключ кэша — ссылка на объект опций: вызывающий обязан держать его одним на все файлы
        // (`EMPTY_OPTIONS` в `src/rules/context.ts`), иначе кэш не попадает никогда.
        expect(getAliases(settings, overrides)).toBe(first);
        expect(getAliases(settings, { aliases: { '@src/*': ['src/*'] } })).not.toBe(first);
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
        expect(getAliases(settings)).toEqual([{ prefix: '@src', anchor: '/src' }]);
    });

    it('сломанный конфиг бросает на каждом вызове, а не только на первом', () => {
        const settings = { weld: { aliases: 'nope' } };

        expect(() => getAliases(settings)).toThrow('settings.weld.aliases must be an object');
        expect(() => getAliases(settings)).toThrow('settings.weld.aliases must be an object');
    });
});

describe('getAliasesFromPaths', () => {
    it('валидные paths дают те же Alias[], что settings.weld.aliases с тем же базовым путём', () => {
        const paths = { '@src/*': ['src/*'], '@lib': ['lib/index.ts'] };

        const fromPaths = getAliasesFromPaths(paths, '/packages/app', 'tsconfig.json');
        const fromSettings = getAliases({
            weld: { aliasesBaseUrl: 'packages/app', aliases: paths },
        });

        expect(fromPaths).toEqual(fromSettings);
        expect(fromPaths).toEqual([
            { prefix: '@src', anchor: '/packages/app/src' },
            { prefix: '@lib', anchor: '/packages/app/lib' },
        ]);
    });

    it('база — виртуальный корень', () => {
        expect(getAliasesFromPaths({ '@src/*': ['src/*'] }, '/', 'tsconfig.json')).toEqual([
            { prefix: '@src', anchor: '/src' },
        ]);
    });

    it('source попадает в текст ошибки', () => {
        expect(() => getAliasesFromPaths({ '@bad': 42 }, '/', '/repo/tsconfig.json')).toThrow(
            "/repo/tsconfig.json['@bad'] must be a string or an array of strings",
        );
    });

    it('кривое значение paths бросает так же, как settings.weld.aliases', () => {
        expect(() => getAliasesFromPaths('nope', '/', 'tsconfig.json')).toThrow(
            'tsconfig.json must be an object',
        );
    });
});

describe('hasAliases', () => {
    it('ключ aliases отсутствует → false', () => {
        expect(hasAliases({})).toBe(false);
        expect(hasAliases({ weld: {} })).toBe(false);
        expect(hasAliases({ weld: { repoRoot: '/repo' } })).toBe(false);
    });

    it('overrides без ключа aliases секцию не отменяет', () => {
        expect(hasAliases({}, { repoRoot: '/repo' })).toBe(false);
        expect(hasAliases({ weld: { aliases: {} } }, { repoRoot: '/repo' })).toBe(true);
    });

    it('пустой объект {} в settings.weld.aliases → true', () => {
        expect(hasAliases({ weld: { aliases: {} } })).toBe(true);
    });

    it('непустые aliases в settings.weld → true', () => {
        expect(hasAliases({ weld: { aliases: { '@src/*': ['src/*'] } } })).toBe(true);
    });

    it('override учитывается: задан → true, даже без settings', () => {
        expect(hasAliases({}, { aliases: {} })).toBe(true);
        expect(hasAliases({}, { aliases: { '@src/*': ['src/*'] } })).toBe(true);
    });

    it('при заданном override settings не читается — сломанный settings.weld не мешает', () => {
        expect(hasAliases({ weld: 'nope' }, { aliases: {} })).toBe(true);
    });
});

describe('getLayerSchema', () => {
    it('схема из секции разворачивается в порядок квалифицированных слоёв', () => {
        const settings = {
            weld: { layers: ['common', '@modules', 'app'], moduleLayers: ['entities'] },
        };

        expect(getLayerSchema(settings).order).toEqual([
            'root:common',
            'module',
            'module:entities',
            'module',
            'root:app',
        ]);
    });

    it('override layers выигрывает у секции', () => {
        const settings = { weld: { layers: ['common', 'app'] } };

        expect(getLayerSchema(settings, { layers: ['app'] }).order).toEqual(['root:app']);
    });

    it('каждая настройка перекрывается порознь: layers из секции, moduleLayers из опций', () => {
        const settings = { weld: { layers: ['@modules', 'app'], moduleLayers: ['entities'] } };

        expect(getLayerSchema(settings, { moduleLayers: ['features'] }).order).toEqual([
            'module',
            'module:features',
            'module',
            'root:app',
        ]);
    });

    it("moduleDir не задан нигде → 'modules'", () => {
        expect(getLayerSchema({ weld: { layers: ['app'] } }).moduleDir).toBe('modules');
    });

    it('moduleDir берётся из секции, а override перекрывает его', () => {
        const settings = { weld: { layers: ['app'], moduleDir: 'packages' } };

        expect(getLayerSchema(settings).moduleDir).toBe('packages');
        expect(getLayerSchema(settings, { moduleDir: 'features' }).moduleDir).toBe('features');
    });

    it('чужие поля overrides схему не трогают', () => {
        const settings = { weld: { layers: ['common', 'app'] } };

        expect(getLayerSchema(settings, { aliases: { '@src/*': ['src/*'] } }).order).toEqual([
            'root:common',
            'root:app',
        ]);
    });

    it('layers не задан нигде → исключение называет settings.weld.layers', () => {
        expect(() => getLayerSchema({})).toThrow('settings.weld.layers must be an array');
        expect(() => getLayerSchema({ weld: {} })).toThrow('settings.weld.layers must be an array');
    });

    it('значение из секции называется в ошибке settings.weld.<имя>', () => {
        expect(() => getLayerSchema({ weld: { layers: ['common', 42] } })).toThrow(
            'settings.weld.layers[1] must be a non-empty string, got number',
        );
    });

    it('значение из опций называется в ошибке options.<имя>', () => {
        expect(() => getLayerSchema({}, { layers: ['common', 42] })).toThrow(
            'options.layers[1] must be a non-empty string, got number',
        );
        expect(() => getLayerSchema({}, { layers: ['app'], moduleDir: 42 })).toThrow(
            'options.moduleDir must be a string, got number',
        );
    });

    it('смешанные источники называются каждый своим именем', () => {
        const settings = { weld: { layers: ['common', 'app'] } };

        expect(() => getLayerSchema(settings, { moduleLayers: ['entities'] })).toThrow(
            "options.moduleLayers is set, but settings.weld.layers has no '@modules' to put it into",
        );
    });

    it('все три настройки из опций → секция не читается, сломанный settings.weld не мешает', () => {
        const overrides = { layers: ['@modules'], moduleLayers: ['entities'], moduleDir: 'pkg' };

        expect(getLayerSchema({ weld: 'nope' }, overrides).order).toEqual([
            'module',
            'module:entities',
            'module',
        ]);
    });

    it('settings.weld не объект → исключение', () => {
        expect(() => getLayerSchema({ weld: 'nope' })).toThrow('settings.weld must be an object');
    });

    it('кэша нет: те же аргументы разбираются заново', () => {
        const settings = { weld: { layers: ['common', 'app'] } };

        expect(getLayerSchema(settings)).not.toBe(getLayerSchema(settings));
        expect(getLayerSchema(settings)).toEqual(getLayerSchema(settings));
    });

    it('сломанная схема бросает на каждом вызове, а не только на первом', () => {
        const settings = { weld: { layers: 'nope' } };

        expect(() => getLayerSchema(settings)).toThrow('settings.weld.layers must be an array');
        expect(() => getLayerSchema(settings)).toThrow('settings.weld.layers must be an array');
    });
});

describe('hasLayers', () => {
    it('ключ layers отсутствует → false', () => {
        expect(hasLayers({})).toBe(false);
        expect(hasLayers({ weld: {} })).toBe(false);
        expect(hasLayers({ weld: { moduleLayers: ['entities'] } })).toBe(false);
    });

    it('пустой layers: [] → true: схема задана, просто без слоёв', () => {
        expect(hasLayers({ weld: { layers: [] } })).toBe(true);
        expect(hasLayers({}, { layers: [] })).toBe(true);
    });

    it('непустой layers в settings.weld → true', () => {
        expect(hasLayers({ weld: { layers: ['common', 'app'] } })).toBe(true);
    });

    it('override учитывается: задан → true, даже без settings', () => {
        expect(hasLayers({}, { layers: ['app'] })).toBe(true);
    });

    it('overrides без ключа layers секцию не отменяет', () => {
        expect(hasLayers({}, { moduleLayers: ['entities'] })).toBe(false);
        expect(hasLayers({ weld: { layers: [] } }, { moduleDir: 'pkg' })).toBe(true);
    });

    it('при заданном override settings не читается — сломанный settings.weld не мешает', () => {
        expect(hasLayers({ weld: 'nope' }, { layers: [] })).toBe(true);
    });
});

describe('overrides', () => {
    it('значение выигрывает у settings.weld', () => {
        const settings = { weld: { repoRoot: '/from-settings' } };

        expect(getRepoRoot(settings, { repoRoot: '/from-override' })).toBe('/from-override');
    });

    it('перекрытая настройка не читается из settings — сломанный settings.weld не мешает', () => {
        expect(getRepoRoot({ weld: 'nope' }, { repoRoot: '/ok' })).toBe('/ok');
    });

    it('чужие поля overrides геттер не трогает', () => {
        const settings = { weld: { repoRoot: '/from-settings' } };

        expect(getRepoRoot(settings, { aliases: { '@src/*': ['src/*'] } })).toBe('/from-settings');
    });

    it('override aliasesBaseUrl подставляется вместо конфига', () => {
        expect(
            getAliasesBaseUrl(
                { weld: { aliasesBaseUrl: 'packages/app' } },
                {
                    aliasesBaseUrl: 'other',
                },
            ),
        ).toBe('other');
    });

    it('override aliases разбирается с aliasesBaseUrl из settings', () => {
        expect(
            getAliases(
                { weld: { aliasesBaseUrl: 'packages/app' } },
                {
                    aliases: { '@src/*': ['src/*'] },
                },
            ),
        ).toEqual([{ prefix: '@src', anchor: '/packages/app/src' }]);
    });

    it('override aliasesBaseUrl задаёт якоря алиасам из settings', () => {
        const settings = {
            weld: { aliasesBaseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } },
        };

        expect(getAliases(settings, { aliasesBaseUrl: 'packages/other' })).toEqual([
            { prefix: '@src', anchor: '/packages/other/src' },
        ]);
    });

    it('пара override aliases + aliasesBaseUrl разбирается вместе', () => {
        const settings = {
            weld: { aliasesBaseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } },
        };

        expect(
            getAliases(settings, {
                aliases: { '@lib/*': ['lib/*'] },
                aliasesBaseUrl: 'packages/other',
            }),
        ).toEqual([{ prefix: '@lib', anchor: '/packages/other/lib' }]);
    });

    it('тот же объект aliases при другом override aliasesBaseUrl даёт другие якоря', () => {
        const aliases = { '@src/*': ['src/*'] };

        const fromApp = getAliases({}, { aliases, aliasesBaseUrl: 'packages/app' });
        const fromOther = getAliases({}, { aliases, aliasesBaseUrl: 'packages/other' });

        expect(fromApp).toEqual([{ prefix: '@src', anchor: '/packages/app/src' }]);
        expect(fromOther).toEqual([{ prefix: '@src', anchor: '/packages/other/src' }]);
    });

    it('override aliasesBaseUrl проверяется как options.aliasesBaseUrl и при разборе алиасов', () => {
        expect(() =>
            getAliases({}, { aliases: { '@src/*': ['src/*'] }, aliasesBaseUrl: 42 }),
        ).toThrow('options.aliasesBaseUrl must be a string, got number');
    });

    it('override не отменяет чтение остальных настроек', () => {
        const settings = { weld: { repoRoot: '/from-settings', aliasesBaseUrl: 'packages/app' } };

        expect(getAliasesBaseUrl(settings)).toBe('packages/app');
        expect(getRepoRoot(settings, { repoRoot: '/other' })).toBe('/other');
        expect(getRepoRoot(settings)).toBe('/from-settings');
    });
});

describe('overrides — валидация', () => {
    it('override repoRoot не строка → исключение называет options.repoRoot', () => {
        expect(() => getRepoRoot({}, { repoRoot: 42 })).toThrow(
            'options.repoRoot must be a string, got number',
        );
    });

    it('override aliasesBaseUrl не строка → исключение называет options.aliasesBaseUrl', () => {
        expect(() => getAliasesBaseUrl({}, { aliasesBaseUrl: 42 })).toThrow(
            'options.aliasesBaseUrl must be a string, got number',
        );
    });

    it('override aliases не объект → исключение называет options.aliases', () => {
        expect(() => getAliases({}, { aliases: 'nope' })).toThrow(
            'options.aliases must be an object',
        );
    });

    it('ошибка внутри override aliases называет ключ и источник', () => {
        expect(() => getAliases({}, { aliases: { '@bad': 42 } })).toThrow(
            "options.aliases['@bad'] must be a string or an array of strings",
        );
    });
});
