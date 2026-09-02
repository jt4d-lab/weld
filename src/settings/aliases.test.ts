import { describe, expect, it } from 'vitest';

import { readAliases } from './aliases.js';

const cwd = '/repo';

describe('readAliases: таблица нормализации', () => {
    it("'@src/*': ['src/*'] — хвост /* снят с обеих сторон", () => {
        const settings = { weld: { aliases: { '@src/*': ['src/*'] } } };
        expect(readAliases(settings, cwd)).toEqual([{ prefix: '@src', anchor: '/repo/src' }]);
    });

    it("'@pkg': ['packages/pkg/src/index.ts'] — index + известное расширение даёт директорию", () => {
        const settings = { weld: { aliases: { '@pkg': ['packages/pkg/src/index.ts'] } } };
        expect(readAliases(settings, cwd)).toEqual([
            { prefix: '@pkg', anchor: '/repo/packages/pkg/src' },
        ]);
    });

    it("'@cfg': ['src/config.ts'] — обычный файл директорией не выражается, запись отбрасывается", () => {
        const settings = { weld: { aliases: { '@cfg': ['src/config.ts'] } } };
        expect(readAliases(settings, cwd)).toEqual([]);
    });

    it("'@dir': ['src/dir'] — как есть", () => {
        const settings = { weld: { aliases: { '@dir': ['src/dir'] } } };
        expect(readAliases(settings, cwd)).toEqual([{ prefix: '@dir', anchor: '/repo/src/dir' }]);
    });
});

describe('readAliases: отбрасывание', () => {
    it("'*': [...] отбрасывается принудительно", () => {
        const settings = { weld: { aliases: { '*': ['src'] } } };
        expect(readAliases(settings, cwd)).toEqual([]);
    });

    it("звёздочка в середине ключа ('@a/*/b') отбрасывается", () => {
        const settings = { weld: { aliases: { '@a/*/b': ['src/a'] } } };
        expect(readAliases(settings, cwd)).toEqual([]);
    });

    it("звёздочка в середине якоря ('src/*.ts') отбрасывается", () => {
        const settings = { weld: { aliases: { '@x': ['src/*.ts'] } } };
        expect(readAliases(settings, cwd)).toEqual([]);
    });
});

describe('readAliases: схлопывание дубликатов и разворачивание массива', () => {
    it('дубликаты prefix + anchor схлопываются', () => {
        const settings = { weld: { aliases: { '@a': ['src/a', 'src/a'] } } };
        expect(readAliases(settings, cwd)).toEqual([{ prefix: '@a', anchor: '/repo/src/a' }]);
    });

    it('массив якорей разворачивается в отдельные записи с сохранением порядка', () => {
        const settings = { weld: { aliases: { '@a': ['src/a', 'src/b'] } } };
        expect(readAliases(settings, cwd)).toEqual([
            { prefix: '@a', anchor: '/repo/src/a' },
            { prefix: '@a', anchor: '/repo/src/b' },
        ]);
    });
});

describe('readAliases: baseUrl', () => {
    it('baseUrl не задан — по умолчанию "."', () => {
        const settings = { weld: { aliases: { '@src/*': ['src/*'] } } };
        expect(readAliases(settings, cwd)).toEqual([{ prefix: '@src', anchor: '/repo/src' }]);
    });

    it('baseUrl задан — резолвится от cwd', () => {
        const settings = {
            weld: { baseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } },
        };
        expect(readAliases(settings, cwd)).toEqual([
            { prefix: '@src', anchor: '/repo/packages/app/src' },
        ]);
    });
});

describe('readAliases: отсутствие settings.weld', () => {
    it('нет settings.weld — пустой массив', () => {
        expect(readAliases({}, cwd)).toEqual([]);
    });

    it('settings совсем не задан — пустой массив', () => {
        expect(readAliases(undefined, cwd)).toEqual([]);
    });
});

describe('readAliases: значение-строка вместо массива', () => {
    it('строка принимается как единственный якорь', () => {
        const settings = { weld: { aliases: { '@x': 'src/x' } } };
        expect(readAliases(settings, cwd)).toEqual([{ prefix: '@x', anchor: '/repo/src/x' }]);
    });
});

describe('readAliases: исключения валидации', () => {
    it('aliases не объект', () => {
        const settings = { weld: { aliases: 'nope' } };
        expect(() => readAliases(settings, cwd)).toThrow();
    });

    it('значение не строка и не массив — текст называет ключ', () => {
        const settings = { weld: { aliases: { '@x': 42 } } };
        expect(() => readAliases(settings, cwd)).toThrow(/@x/);
    });

    it('элемент массива не строка — текст называет ключ', () => {
        const settings = { weld: { aliases: { '@x': ['src/x', 42] } } };
        expect(() => readAliases(settings, cwd)).toThrow(/@x/);
    });
});

describe('readAliases: WeakMap-кэш', () => {
    it('повторный вызов с тем же объектом settings.weld возвращает ту же ссылку', () => {
        const settings = { weld: { aliases: { '@src/*': ['src/*'] } } };
        const first = readAliases(settings, cwd);
        const second = readAliases(settings, cwd);
        expect(first).toBe(second);
    });

    it('разные объекты settings.weld не делят кэш', () => {
        const settingsA = { weld: { aliases: { '@src/*': ['src/*'] } } };
        const settingsB = { weld: { aliases: { '@src/*': ['src/*'] } } };
        const first = readAliases(settingsA, cwd);
        const second = readAliases(settingsB, cwd);
        expect(first).not.toBe(second);
        expect(first).toEqual(second);
    });
});
