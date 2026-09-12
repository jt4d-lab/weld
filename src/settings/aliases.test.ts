import { describe, expect, it } from 'vitest';

import { parseAliases } from '@/settings/aliases.js';

const SOURCE = 'settings.weld.aliases';

/** `source` у `parseAliases` обязателен — в тестах он везде один и тот же. */
function parse(rawAliases: unknown, aliasesBaseUrl: string) {
    return parseAliases(rawAliases, aliasesBaseUrl, SOURCE);
}

describe('parseAliases — таблица нормализации', () => {
    it("'@src/*': ['src/*'] → префикс @src, якорь <base>/src", () => {
        expect(parse({ '@src/*': ['src/*'] }, '.')).toEqual([{ prefix: '@src', anchor: '/src' }]);
    });

    it("'@pkg': ['packages/pkg/src/index.ts'] → якорь берёт директорию index-файла", () => {
        expect(parse({ '@pkg': ['packages/pkg/src/index.ts'] }, '.')).toEqual([
            { prefix: '@pkg', anchor: '/packages/pkg/src' },
        ]);
    });

    it("'@cfg': ['src/config.ts'] → запись отбрасывается, обычный файл не выражается директорией", () => {
        expect(parse({ '@cfg': ['src/config.ts'] }, '.')).toEqual([]);
    });

    it("'@dir': ['src/dir'] → якорь как есть", () => {
        expect(parse({ '@dir': ['src/dir'] }, '.')).toEqual([
            { prefix: '@dir', anchor: '/src/dir' },
        ]);
    });
});

describe('parseAliases — отбрасывание', () => {
    it("запись '*' отбрасывается принудительно", () => {
        expect(parse({ '*': ['src'] }, '.')).toEqual([]);
    });

    it('звёздочка в середине ключа отбрасывается', () => {
        expect(parse({ '@a*b': ['src'] }, '.')).toEqual([]);
    });

    it('звёздочка в середине якоря отбрасывается', () => {
        expect(parse({ '@a': ['sr*c'] }, '.')).toEqual([]);
    });

    it('хвост /* в ключе и якоре принимается', () => {
        expect(parse({ '@a/*': ['src/*'] }, '.')).toEqual([{ prefix: '@a', anchor: '/src' }]);
    });

    it("запись '/*' отбрасывается: пустой префикс матчил бы любой абсолютный специфайер", () => {
        expect(parse({ '/*': ['src/*'] }, '.')).toEqual([]);
    });

    it("пустой ключ '' отбрасывается по той же причине, что и '/*'", () => {
        expect(parse({ '': ['src'] }, '.')).toEqual([]);
    });

    it("якорь '/*' отбрасывается: пустой якорь не выражает директорию однозначно", () => {
        expect(parse({ '@a/*': ['/*'] }, '.')).toEqual([]);
    });
});

describe('parseAliases — дубликаты и массивы', () => {
    it('дубликаты prefix+anchor схлопываются', () => {
        expect(parse({ '@a/*': ['src/a/*', 'src/a/*'] }, '.')).toEqual([
            { prefix: '@a', anchor: '/src/a' },
        ]);
    });

    it('массив якорей разворачивается с сохранением порядка объявления', () => {
        expect(parse({ '@a/*': ['src/one/*', 'src/two/*'] }, '.')).toEqual([
            { prefix: '@a', anchor: '/src/one' },
            { prefix: '@a', anchor: '/src/two' },
        ]);
    });
});

describe('parseAliases — aliasesBaseUrl', () => {
    it('aliasesBaseUrl задан → якоря относительно него', () => {
        expect(parse({ '@src/*': ['src/*'] }, 'packages/app')).toEqual([
            { prefix: '@src', anchor: '/packages/app/src' },
        ]);
    });

    it("aliasesBaseUrl '.' → якоря от корня /", () => {
        expect(parse({ '@src/*': ['src/*'] }, '.')).toEqual([{ prefix: '@src', anchor: '/src' }]);
    });
});

describe('parseAliases — опечатки', () => {
    it('значение-строка вместо массива принимается', () => {
        expect(parse({ '@src/*': 'src/*' }, '.')).toEqual([{ prefix: '@src', anchor: '/src' }]);
    });
});

describe('parseAliases — якорь выше виртуального корня', () => {
    it("якорь с '..', поднимающимся выше /, отбрасывается", () => {
        expect(parse({ '@shared': ['../shared'] }, '.')).toEqual([]);
    });

    it('тот же случай для директории с хвостом /* тоже отбрасывается', () => {
        expect(parse({ '@shared/*': ['../shared/*'] }, '.')).toEqual([]);
    });
});

describe('parseAliases — валидация', () => {
    it('aliases не объект → исключение', () => {
        expect(() => parse('nope', '.')).toThrow('settings.weld.aliases must be an object');
    });

    it('aliases — массив → исключение', () => {
        expect(() => parse([], '.')).toThrow('settings.weld.aliases must be an object');
    });

    it('значение записи не строка и не массив → исключение называет ключ', () => {
        expect(() => parse({ '@bad': 42 }, '.')).toThrow(
            "settings.weld.aliases['@bad'] must be a string or an array of strings",
        );
    });

    it('элемент массива не строка → исключение называет ключ', () => {
        expect(() => parse({ '@bad': ['ok', 42] }, '.')).toThrow(
            "settings.weld.aliases['@bad'] must contain only strings",
        );
    });
});
