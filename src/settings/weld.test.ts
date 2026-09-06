import { describe, expect, it } from 'vitest';

import { getAliases, getBaseUrl, getRoot } from '@/settings/weld.js';

describe('getRoot', () => {
    it('root задан → возвращается как есть, без резолва', () => {
        expect(getRoot({ weld: { root: '../repo' } })).toBe('../repo');
    });

    it('нет settings.weld → undefined', () => {
        expect(getRoot({})).toBeUndefined();
    });

    it('root не строка → исключение называет тип', () => {
        expect(() => getRoot({ weld: { root: 42 } })).toThrow(
            'settings.weld.root must be a string, got number',
        );
    });

    it('settings.weld не объект → исключение', () => {
        expect(() => getRoot({ weld: 'nope' })).toThrow('settings.weld must be an object');
    });
});

describe('getBaseUrl', () => {
    it('baseUrl задан → возвращается как есть', () => {
        expect(getBaseUrl({ weld: { baseUrl: 'packages/app' } })).toBe('packages/app');
    });

    it("baseUrl не задан → '.'", () => {
        expect(getBaseUrl({})).toBe('.');
    });

    it('baseUrl не строка → исключение называет тип', () => {
        expect(() => getBaseUrl({ weld: { baseUrl: 42 } })).toThrow(
            'settings.weld.baseUrl must be a string, got number',
        );
    });
});

describe('getAliases', () => {
    it('якоря отсчитываются от baseUrl: тот же объект aliases при другом baseUrl даёт другие якоря', () => {
        const aliases = { '@src/*': ['src/*'] };

        const fromRoot = getAliases({ weld: { aliases } });
        const fromApp = getAliases({ weld: { baseUrl: 'packages/app', aliases } });

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
        const settings = { weld: { root: '/from-settings' } };

        expect(getRoot(settings, '/from-override')).toBe('/from-override');
    });

    it('перекрытая настройка не читается из settings — сломанный settings.weld не мешает', () => {
        expect(getRoot({ weld: 'nope' }, '/ok')).toBe('/ok');
    });

    it('override baseUrl подставляется вместо конфига', () => {
        expect(getBaseUrl({ weld: { baseUrl: 'packages/app' } }, 'other')).toBe('other');
    });

    it('override aliases разбирается с baseUrl из settings', () => {
        expect(getAliases({ weld: { baseUrl: 'packages/app' } }, { '@src/*': ['src/*'] })).toEqual([
            { prefix: '@src', anchor: '/packages/app/src' },
        ]);
    });

    it('override baseUrl задаёт якоря алиасам из settings', () => {
        const settings = { weld: { baseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } } };

        expect(getAliases(settings, undefined, 'packages/other')).toEqual([
            { prefix: '@src', anchor: '/packages/other/src' },
        ]);
    });

    it('пара override aliases + baseUrl разбирается вместе', () => {
        const settings = { weld: { baseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } } };

        expect(getAliases(settings, { '@lib/*': ['lib/*'] }, 'packages/other')).toEqual([
            { prefix: '@lib', anchor: '/packages/other/lib' },
        ]);
    });

    it('тот же объект aliases при другом override baseUrl даёт другие якоря', () => {
        const aliases = { '@src/*': ['src/*'] };

        const fromApp = getAliases({}, aliases, 'packages/app');
        const fromOther = getAliases({}, aliases, 'packages/other');

        expect(fromApp).toEqual([{ prefix: '@src', anchor: '/packages/app/src' }]);
        expect(fromOther).toEqual([{ prefix: '@src', anchor: '/packages/other/src' }]);
    });

    it('override baseUrl проверяется как options.baseUrl и при разборе алиасов', () => {
        expect(() => getAliases({}, { '@src/*': ['src/*'] }, 42)).toThrow(
            'options.baseUrl must be a string, got number',
        );
    });

    it('override не отменяет чтение остальных настроек', () => {
        const settings = { weld: { root: '/from-settings', baseUrl: 'packages/app' } };

        expect(getBaseUrl(settings)).toBe('packages/app');
        expect(getRoot(settings, '/other')).toBe('/other');
        expect(getRoot(settings)).toBe('/from-settings');
    });
});

describe('override — валидация', () => {
    it('override root не строка → исключение называет options.root', () => {
        expect(() => getRoot({}, 42)).toThrow('options.root must be a string, got number');
    });

    it('override baseUrl не строка → исключение называет options.baseUrl', () => {
        expect(() => getBaseUrl({}, 42)).toThrow('options.baseUrl must be a string, got number');
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
