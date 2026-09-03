import { describe, expect, it } from 'vitest';

import { readAliases } from '../../src/settings/aliases.js';

const cwd = '/repo';

describe('readAliases: таблица нормализации', () => {
    it("'@src/*': ['src/*'] — снят хвост /* с обеих сторон", () => {
        const result = readAliases({ weld: { aliases: { '@src/*': ['src/*'] } } }, cwd);
        expect(result).toEqual([{ prefix: '@src', anchor: '/repo/src' }]);
    });

    it("'@pkg': ['packages/pkg/src/index.ts'] — index + известное расширение → директория", () => {
        const result = readAliases(
            { weld: { aliases: { '@pkg': ['packages/pkg/src/index.ts'] } } },
            cwd,
        );
        expect(result).toEqual([{ prefix: '@pkg', anchor: '/repo/packages/pkg/src' }]);
    });

    it("'@cfg': ['src/config.ts'] — обычный файл директорией не выражается, запись отбрасывается", () => {
        const result = readAliases({ weld: { aliases: { '@cfg': ['src/config.ts'] } } }, cwd);
        expect(result).toEqual([]);
    });

    it("'@dir': ['src/dir'] — как есть", () => {
        const result = readAliases({ weld: { aliases: { '@dir': ['src/dir'] } } }, cwd);
        expect(result).toEqual([{ prefix: '@dir', anchor: '/repo/src/dir' }]);
    });
});

describe('readAliases: отбрасывание', () => {
    it("'*' отбрасывается принудительно — пустой префикс совпал бы с чем угодно", () => {
        const result = readAliases({ weld: { aliases: { '*': ['src/*'] } } }, cwd);
        expect(result).toEqual([]);
    });

    it("звёздочка в середине ключа ('@a/*/b') отбрасывается", () => {
        const result = readAliases({ weld: { aliases: { '@a/*/b': ['src/a/*/b'] } } }, cwd);
        expect(result).toEqual([]);
    });

    it("звёздочка в середине якоря ('src/*.ts') отбрасывается", () => {
        const result = readAliases({ weld: { aliases: { '@x': ['src/*.ts'] } } }, cwd);
        expect(result).toEqual([]);
    });
});

describe('readAliases: разворачивание и дедупликация', () => {
    it('массив якорей разворачивается в отдельные записи с сохранением порядка', () => {
        const result = readAliases({ weld: { aliases: { '@x/*': ['a/*', 'b/*'] } } }, cwd);
        expect(result).toEqual([
            { prefix: '@x', anchor: '/repo/a' },
            { prefix: '@x', anchor: '/repo/b' },
        ]);
    });

    it('дубликаты prefix + anchor схлопываются', () => {
        const result = readAliases(
            {
                weld: {
                    aliases: {
                        '@x/*': ['a/*'],
                        '@x': ['a'],
                    },
                },
            },
            cwd,
        );
        expect(result).toEqual([{ prefix: '@x', anchor: '/repo/a' }]);
    });
});

describe('readAliases: baseUrl', () => {
    it('baseUrl задан — якорь считается от него', () => {
        const result = readAliases(
            { weld: { baseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } } },
            cwd,
        );
        expect(result).toEqual([{ prefix: '@src', anchor: '/repo/packages/app/src' }]);
    });

    it('baseUrl не задан — по умолчанию текущая директория (cwd)', () => {
        const result = readAliases({ weld: { aliases: { '@src/*': ['src/*'] } } }, cwd);
        expect(result).toEqual([{ prefix: '@src', anchor: '/repo/src' }]);
    });
});

describe('readAliases: отсутствие settings.weld', () => {
    it('settings.weld отсутствует — пустой массив', () => {
        expect(readAliases({}, cwd)).toEqual([]);
    });

    it('settings не передан — пустой массив', () => {
        expect(readAliases(undefined, cwd)).toEqual([]);
    });

    it('settings.weld отсутствует — не попадает в кэш (не бросает при повторном вызове)', () => {
        const settings = {};
        expect(readAliases(settings, cwd)).toEqual([]);
        expect(readAliases(settings, cwd)).toEqual([]);
    });
});

describe('readAliases: значение-строка вместо массива', () => {
    it('строка вместо массива принимается как единственный якорь', () => {
        const result = readAliases({ weld: { aliases: { '@src/*': 'src/*' } } }, cwd);
        expect(result).toEqual([{ prefix: '@src', anchor: '/repo/src' }]);
    });
});

describe('readAliases: валидация', () => {
    it('settings.weld не объект — исключение', () => {
        expect(() => readAliases({ weld: 'nope' }, cwd)).toThrow(/settings\.weld/);
    });

    it('aliases не объект — исключение', () => {
        expect(() => readAliases({ weld: { aliases: 'nope' } }, cwd)).toThrow(
            /settings\.weld\.aliases/,
        );
    });

    it('значение записи не строка и не массив — исключение называет ключ', () => {
        expect(() => readAliases({ weld: { aliases: { '@bad': 42 } } }, cwd)).toThrow(
            /settings\.weld\.aliases\.@bad/,
        );
    });

    it('элемент массива не строка — исключение называет ключ', () => {
        expect(() => readAliases({ weld: { aliases: { '@bad': [42] } } }, cwd)).toThrow(
            /settings\.weld\.aliases\.@bad/,
        );
    });
});

describe('readAliases: WeakMap-кэш', () => {
    it('повторный вызов с тем же объектом settings.weld возвращает ту же ссылку', () => {
        const weld = { aliases: { '@src/*': ['src/*'] } };
        const first = readAliases({ weld }, cwd);
        const second = readAliases({ weld }, cwd);
        expect(first).toBe(second);
    });
});
