import { describe, expect, it } from 'vitest';

import { getAliases, getAliasesBaseUrl, getRepoRoot } from '@/settings/weld.js';

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
        ).toEqual([{ prefix: '@src', anchor: '/packages/app/src' }]);
    });

    it('override aliasesBaseUrl задаёт якоря алиасам из settings', () => {
        const settings = {
            weld: { aliasesBaseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } },
        };

        expect(getAliases(settings, undefined, 'packages/other')).toEqual([
            { prefix: '@src', anchor: '/packages/other/src' },
        ]);
    });

    it('пара override aliases + aliasesBaseUrl разбирается вместе', () => {
        const settings = {
            weld: { aliasesBaseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } },
        };

        expect(getAliases(settings, { '@lib/*': ['lib/*'] }, 'packages/other')).toEqual([
            { prefix: '@lib', anchor: '/packages/other/lib' },
        ]);
    });

    it('тот же объект aliases при другом override aliasesBaseUrl даёт другие якоря', () => {
        const aliases = { '@src/*': ['src/*'] };

        const fromApp = getAliases({}, aliases, 'packages/app');
        const fromOther = getAliases({}, aliases, 'packages/other');

        expect(fromApp).toEqual([{ prefix: '@src', anchor: '/packages/app/src' }]);
        expect(fromOther).toEqual([{ prefix: '@src', anchor: '/packages/other/src' }]);
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
