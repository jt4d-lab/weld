import { describe, expect, it } from 'vitest';

import type { LayerSchema } from '@/settings/layers.js';
import { parseLayerSchema } from '@/settings/layers.js';

/**
 * Разбор с источниками из секции: имена мест в конфиге проверяются отдельно (см. «источник
 * значения»), а в остальных наборах они только шумели бы.
 */
function compile(layers: unknown, moduleLayers?: unknown, moduleDir?: unknown): LayerSchema {
    return parseLayerSchema({
        layers: { value: layers, source: 'settings.weld.layers' },
        moduleLayers: { value: moduleLayers, source: 'settings.weld.moduleLayers' },
        moduleDir: { value: moduleDir, source: 'settings.weld.moduleDir' },
    });
}

describe('parseLayerSchema — развёртка order', () => {
    it('пример из плана: @modules обрамляет слои модуля парой module', () => {
        const schema = compile(
            ['common', '@unknown', '@modules', 'pages', 'app'],
            ['entities', 'features', 'widgets'],
        );

        expect(schema.order).toEqual([
            'root:common',
            'root:unknown',
            'module',
            'module:entities',
            'module:features',
            'module:widgets',
            'module',
            'root:pages',
            'root:app',
        ]);
    });

    it('@modules с пустым moduleLayers → смежный повтор module, module', () => {
        expect(compile(['common', '@modules', 'app'], []).order).toEqual([
            'root:common',
            'module',
            'module',
            'root:app',
        ]);
    });

    it('@modules без moduleLayers вовсе → тот же смежный повтор', () => {
        expect(compile(['@modules']).order).toEqual(['module', 'module']);
    });

    it('@unknown в moduleLayers → module:unknown на своём месте', () => {
        expect(compile(['@modules'], ['entities', '@unknown', 'features']).order).toEqual([
            'module',
            'module:entities',
            'module:unknown',
            'module:features',
            'module',
        ]);
    });

    it('@unknown в обоих списках → два разных квалифицированных слоя, ошибки нет', () => {
        const schema = compile(['@unknown', '@modules'], ['@unknown']);

        expect(schema.order).toEqual(['root:unknown', 'module', 'module:unknown', 'module']);
    });

    it('схема без @modules → только слои проекта', () => {
        expect(compile(['common', 'pages', 'app']).order).toEqual([
            'root:common',
            'root:pages',
            'root:app',
        ]);
    });

    it('пустой layers → пустой order', () => {
        expect(compile([]).order).toEqual([]);
    });

    it('смежный и разнесённый повторы сохраняются как есть', () => {
        expect(compile(['common', 'common', '@modules', 'legacy', 'app', 'legacy']).order).toEqual([
            'root:common',
            'root:common',
            'module',
            'module',
            'root:legacy',
            'root:app',
            'root:legacy',
        ]);
    });
});

describe('parseLayerSchema — first/last', () => {
    const schema = compile(
        ['common', 'legacy', '@modules', 'legacy', 'pages', 'app'],
        ['entities', 'features', 'widgets'],
    );

    it('module получает диапазон, обрамляющий слои модуля', () => {
        expect(schema.first.get('module')).toBe(2);
        expect(schema.last.get('module')).toBe(6);
    });

    it('разнесённый повтор обычного слоя тоже даёт диапазон', () => {
        expect(schema.first.get('root:legacy')).toBe(1);
        expect(schema.last.get('root:legacy')).toBe(7);
    });

    it('одиночное имя — first равен last', () => {
        expect(schema.first.get('module:features')).toBe(4);
        expect(schema.last.get('module:features')).toBe(4);
    });

    it('смежный повтор — диапазон из двух соседних позиций', () => {
        const withEmptyModules = compile(['@modules']);

        expect(withEmptyModules.first.get('module')).toBe(0);
        expect(withEmptyModules.last.get('module')).toBe(1);
    });

    it('имени нет в схеме → нет и в индексах', () => {
        expect(schema.first.get('root:nope')).toBeUndefined();
        expect(schema.last.get('root:nope')).toBeUndefined();
        expect(schema.first.get('root:unknown')).toBeUndefined();
    });
});

describe('parseLayerSchema — наборы имён и moduleDir', () => {
    it('projectLayers и moduleLayers — обычные имена, без спец-слоёв', () => {
        const schema = compile(
            ['common', '@unknown', '@modules', 'app'],
            ['entities', '@unknown', 'features'],
        );

        expect([...schema.projectLayers]).toEqual(['common', 'app']);
        expect([...schema.moduleLayers]).toEqual(['entities', 'features']);
    });

    it('повторы в наборы попадают один раз', () => {
        expect([...compile(['legacy', 'app', 'legacy']).projectLayers]).toEqual(['legacy', 'app']);
    });

    it('moduleLayers не задан → пустой набор', () => {
        expect(compile(['common', 'app']).moduleLayers.size).toBe(0);
    });

    it("moduleDir по умолчанию — 'modules'", () => {
        expect(compile(['common']).moduleDir).toBe('modules');
    });

    it('moduleDir из конфига берётся как есть', () => {
        expect(compile(['common'], undefined, 'packages').moduleDir).toBe('packages');
    });
});

describe('parseLayerSchema — валидация', () => {
    it('layers не массив → ошибка называет settings.weld.layers', () => {
        expect(() => compile('nope')).toThrow('settings.weld.layers must be an array');
        expect(() => compile({ common: 0 })).toThrow('settings.weld.layers must be an array');
    });

    it('layers не задан → та же ошибка (геттер зовётся только при заданной схеме)', () => {
        expect(() => compile(undefined)).toThrow('settings.weld.layers must be an array');
    });

    it('moduleLayers не массив → ошибка называет settings.weld.moduleLayers', () => {
        expect(() => compile(['@modules'], 'nope')).toThrow(
            'settings.weld.moduleLayers must be an array',
        );
    });

    it('элемент не строка → ошибка называет элемент и тип', () => {
        expect(() => compile(['a', 'b', 'c', 42])).toThrow(
            'settings.weld.layers[3] must be a non-empty string, got number',
        );
    });

    it('пустая строка → ошибка называет элемент', () => {
        expect(() => compile(['a', ''])).toThrow(
            'settings.weld.layers[1] must be a non-empty string',
        );
    });

    it('элемент moduleLayers не строка → ошибка называет элемент в moduleLayers', () => {
        expect(() => compile(['@modules'], ['entities', null])).toThrow(
            'settings.weld.moduleLayers[1] must be a non-empty string, got object',
        );
    });

    it('@-имя, отличное от @modules и @unknown → ошибка называет элемент', () => {
        expect(() => compile(['common', '@shared'])).toThrow(
            "settings.weld.layers[1]: unknown special layer '@shared'; only '@modules' and '@unknown' may start with \"@\"",
        );
    });

    it('@-имя в moduleLayers проверяется так же', () => {
        expect(() => compile(['@modules'], ['@shared'])).toThrow(
            "settings.weld.moduleLayers[0]: unknown special layer '@shared'",
        );
    });

    it('@modules в moduleLayers → ошибка называет элемент', () => {
        expect(() => compile(['@modules'], ['entities', '@modules'])).toThrow(
            "settings.weld.moduleLayers[1]: '@modules' may only be used in settings.weld.layers",
        );
    });

    it('@modules в layers больше одного раза → ошибка называет settings.weld.layers', () => {
        expect(() => compile(['@modules', 'pages', '@modules'])).toThrow(
            "settings.weld.layers must not contain '@modules' more than once",
        );
    });

    it('moduleLayers задан, а @modules в layers нет → ошибка называет settings.weld.moduleLayers', () => {
        expect(() => compile(['common', 'app'], ['entities'])).toThrow(
            "settings.weld.moduleLayers is set, but settings.weld.layers has no '@modules' to put it into",
        );
    });

    it('пустой moduleLayers без @modules — тоже заданное значение, тоже ошибка', () => {
        expect(() => compile(['common'], [])).toThrow(
            "settings.weld.moduleLayers is set, but settings.weld.layers has no '@modules' to put it into",
        );
    });

    it('обычное имя в обоих списках → ошибка называет элемент', () => {
        expect(() => compile(['common', '@modules', 'app'], ['entities', 'app'])).toThrow(
            "settings.weld.moduleLayers[1]: 'app' is already declared in settings.weld.layers",
        );
    });

    it('@unknown в обоих списках ошибкой не является', () => {
        expect(() => compile(['@unknown', '@modules'], ['@unknown'])).not.toThrow();
    });

    it('moduleDir не строка → ошибка называет settings.weld.moduleDir', () => {
        expect(() => compile(['common'], undefined, 42)).toThrow(
            'settings.weld.moduleDir must be a string, got number',
        );
    });

    it('moduleDir — пустая строка → ошибка', () => {
        expect(() => compile(['common'], undefined, '')).toThrow(
            'settings.weld.moduleDir must not be empty',
        );
    });

    it('moduleDir с / → ошибка: это имя директории, а не путь', () => {
        expect(() => compile(['common'], undefined, 'src/modules')).toThrow(
            "settings.weld.moduleDir must be a directory name, not a path: 'src/modules'",
        );
    });
});

describe('parseLayerSchema — источник значения', () => {
    it('значение из опций правила называется options.<имя>', () => {
        expect(() =>
            parseLayerSchema({
                layers: { value: ['common', 42], source: 'options.layers' },
                moduleLayers: { value: undefined, source: 'options.moduleLayers' },
                moduleDir: { value: undefined, source: 'options.moduleDir' },
            }),
        ).toThrow('options.layers[1] must be a non-empty string, got number');
    });

    it('источники смешанных мест называются каждый своим именем', () => {
        expect(() =>
            parseLayerSchema({
                layers: { value: ['common'], source: 'settings.weld.layers' },
                moduleLayers: { value: ['entities'], source: 'options.moduleLayers' },
                moduleDir: { value: undefined, source: 'settings.weld.moduleDir' },
            }),
        ).toThrow(
            "options.moduleLayers is set, but settings.weld.layers has no '@modules' to put it into",
        );
    });
});
