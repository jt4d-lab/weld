import { describe, expect, it } from 'vitest';

import { parseAliases } from './aliases.js';

const cwd = '/repo';

describe('parseAliases: таблица нормализации', () => {
    it("'@src/*': ['src/*'] — хвост /* снят с обеих сторон", () => {
        const weld = { aliases: { '@src/*': ['src/*'] } };
        expect(parseAliases(weld, cwd)).toEqual([{ prefix: '@src', anchor: '/repo/src' }]);
    });

    it("'@pkg': ['packages/pkg/src/index.ts'] — index + известное расширение даёт директорию", () => {
        const weld = { aliases: { '@pkg': ['packages/pkg/src/index.ts'] } };
        expect(parseAliases(weld, cwd)).toEqual([
            { prefix: '@pkg', anchor: '/repo/packages/pkg/src' },
        ]);
    });

    it("'@cfg': ['src/config.ts'] — обычный файл директорией не выражается, запись отбрасывается", () => {
        const weld = { aliases: { '@cfg': ['src/config.ts'] } };
        expect(parseAliases(weld, cwd)).toEqual([]);
    });

    it("'@dir': ['src/dir'] — как есть", () => {
        const weld = { aliases: { '@dir': ['src/dir'] } };
        expect(parseAliases(weld, cwd)).toEqual([{ prefix: '@dir', anchor: '/repo/src/dir' }]);
    });
});

describe('parseAliases: отбрасывание', () => {
    it("'*': [...] отбрасывается принудительно", () => {
        const weld = { aliases: { '*': ['src'] } };
        expect(parseAliases(weld, cwd)).toEqual([]);
    });

    it("звёздочка в середине ключа ('@a/*/b') отбрасывается", () => {
        const weld = { aliases: { '@a/*/b': ['src/a'] } };
        expect(parseAliases(weld, cwd)).toEqual([]);
    });

    it("звёздочка в середине якоря ('src/*.ts') отбрасывается", () => {
        const weld = { aliases: { '@x': ['src/*.ts'] } };
        expect(parseAliases(weld, cwd)).toEqual([]);
    });
});

describe('parseAliases: схлопывание дубликатов и разворачивание массива', () => {
    it('дубликаты prefix + anchor схлопываются', () => {
        const weld = { aliases: { '@a': ['src/a', 'src/a'] } };
        expect(parseAliases(weld, cwd)).toEqual([{ prefix: '@a', anchor: '/repo/src/a' }]);
    });

    it('массив якорей разворачивается в отдельные записи с сохранением порядка', () => {
        const weld = { aliases: { '@a': ['src/a', 'src/b'] } };
        expect(parseAliases(weld, cwd)).toEqual([
            { prefix: '@a', anchor: '/repo/src/a' },
            { prefix: '@a', anchor: '/repo/src/b' },
        ]);
    });
});

describe('parseAliases: baseUrl', () => {
    it('baseUrl не задан — по умолчанию "."', () => {
        const weld = { aliases: { '@src/*': ['src/*'] } };
        expect(parseAliases(weld, cwd)).toEqual([{ prefix: '@src', anchor: '/repo/src' }]);
    });

    it('baseUrl задан — резолвится от cwd', () => {
        const weld = { baseUrl: 'packages/app', aliases: { '@src/*': ['src/*'] } };
        expect(parseAliases(weld, cwd)).toEqual([
            { prefix: '@src', anchor: '/repo/packages/app/src' },
        ]);
    });
});

describe('parseAliases: значение-строка вместо массива', () => {
    it('строка принимается как единственный якорь', () => {
        const weld = { aliases: { '@x': 'src/x' } };
        expect(parseAliases(weld, cwd)).toEqual([{ prefix: '@x', anchor: '/repo/src/x' }]);
    });
});
