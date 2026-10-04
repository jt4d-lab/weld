import { describe, expect, it } from 'vitest';

import type { LayerSchema } from '@/settings/layers.js';
import {
    isModuleLevel,
    MODULE,
    MODULE_UNKNOWN,
    parseLayerSchema,
    plainLayerName,
    ROOT_UNKNOWN,
} from '@/settings/layers.js';

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

    it('повтор имени в moduleLayers тоже даёт диапазон — список не схлопывается', () => {
        const repeated = compile(['@modules'], ['entities', 'features', 'entities']);

        expect(repeated.order).toEqual([
            'module',
            'module:entities',
            'module:features',
            'module:entities',
            'module',
        ]);
        expect(repeated.first.get('module:entities')).toBe(1);
        expect(repeated.last.get('module:entities')).toBe(3);
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

    it('moduleLayers: null — заданное значение, а не отсутствие ключа', () => {
        // `null` проходит мимо проверки на `undefined`, поэтому проверяется отдельно: принять его за
        // «не задано» значило бы молча проглотить опечатку в конфиге.
        expect(() => compile(['@modules'], null)).toThrow(
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

    it("обычное имя 'unknown' зарезервировано — оно совпало бы с развёрткой @unknown", () => {
        expect(() => compile(['common', 'unknown', 'app'])).toThrow(
            "settings.weld.layers[1]: 'unknown' is reserved; use '@unknown' for code without a layer",
        );
    });

    it("'unknown' в moduleLayers зарезервировано так же", () => {
        expect(() => compile(['@modules'], ['entities', 'unknown'])).toThrow(
            "settings.weld.moduleLayers[1]: 'unknown' is reserved; use '@unknown' for code without a layer",
        );
    });

    it("обычное имя 'module' зарезервировано — в сообщениях оно совпало бы с модулем целиком", () => {
        expect(() => compile(['common', 'module', 'app'])).toThrow(
            "settings.weld.layers[1]: 'module' is reserved; use '@modules' to place modules in the order",
        );
    });

    it("'module' при уже объявленном @modules → совет не зовёт объявить второй", () => {
        // Совет «use '@modules'» здесь отправлял бы в схему с двумя `@modules`, которую разбор
        // отвергает следующей же проверкой, — а это самый частый случай: схема с модулями плюс
        // лишнее имя `module`.
        expect(() => compile(['common', '@modules', 'module'])).toThrow(
            "settings.weld.layers[2]: 'module' is reserved; pick another name: '@modules' already places modules in the order, and it may be declared only once",
        );
    });

    it("'module' в moduleLayers зарезервировано так же, но совет другой", () => {
        // Совет из `layers` («use '@modules'») здесь отправлял бы ровно в ту запись, которую
        // отвергает следующая же проверка: место модулям задаётся один раз, в `layers`.
        expect(() => compile(['@modules'], ['entities', 'module'])).toThrow(
            "settings.weld.moduleLayers[1]: 'module' is reserved; pick another name: the place for modules is declared once, as '@modules' in settings.weld.layers, and it applies to modules at any depth",
        );
    });

    it("'module' в moduleLayers при схеме без @modules → совет называет оба шага", () => {
        // Имена проверяются раньше схемы целиком, поэтому сюда доходит конфиг, в котором `@modules`
        // не объявлен вовсе: совет из соседнего теста утверждал бы про него неправду, а «возьми
        // другое имя» упёрлось бы в следующую ошибку — `moduleLayers` некуда класть.
        expect(() => compile(['common', 'app'], ['entities', 'module'])).toThrow(
            "settings.weld.moduleLayers[1]: 'module' is reserved; pick another name, and declare '@modules' in settings.weld.layers: that is where modules get their place, once, and it applies to modules at any depth",
        );
    });

    it("совет вместо 'module' ведёт в конфиг, который разбор принимает", () => {
        // Проверка ровно про это: ни один совет из сообщения не должен упираться в следующую
        // ошибку. Каждая строка — результат буквального следования совету из теста выше.

        // `['common', 'module', 'app']` + «use '@modules'»:
        expect(() => compile(['common', '@modules', 'app'])).not.toThrow();
        // `['common', '@modules', 'module']` + «pick another name»:
        expect(() => compile(['common', '@modules', 'shell'])).not.toThrow();
        // `['@modules'], ['entities', 'module']` + «pick another name»:
        expect(() => compile(['@modules'], ['entities', 'shell'])).not.toThrow();
        // `['common', 'app'], ['entities', 'module']` + «другое имя плюс '@modules' в layers»:
        expect(() => compile(['common', '@modules', 'app'], ['entities', 'shell'])).not.toThrow();

        // А совет из `layers`, применённый в `moduleLayers`, упёрся бы в следующую же проверку —
        // потому он там и не выдаётся.
        expect(() => compile(['@modules'], ['entities', '@modules'])).toThrow(
            "settings.weld.moduleLayers[1]: '@modules' may only be used in settings.weld.layers",
        );
    });

    it('имя слоя с / → ошибка: это имя директории, а не путь', () => {
        expect(() => compile(['common', 'ui/button'])).toThrow(
            "settings.weld.layers[1]: 'ui/button' must be a directory name, not a path",
        );
        expect(() => compile(['@modules'], ['entities/user'])).toThrow(
            "settings.weld.moduleLayers[0]: 'entities/user' must be a directory name, not a path",
        );
    });

    it("'.' и '..' именами слоёв не бывают — сегментом пути они не станут", () => {
        // Резолв пути их схлопывает, поэтому такой слой не совпал бы ни с одним файлом: он молча не
        // существовал бы, а файлы, которые он должен был покрыть, шумели бы `undeclaredLayer`.
        expect(() => compile(['common', '..'])).toThrow(
            "settings.weld.layers[1]: '..' must be a directory name, not a path",
        );
        expect(() => compile(['common', '.'])).toThrow(
            "settings.weld.layers[1]: '.' must be a directory name, not a path",
        );
        expect(() => compile(['@modules'], ['..'])).toThrow(
            "settings.weld.moduleLayers[0]: '..' must be a directory name, not a path",
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

describe('plainLayerName', () => {
    it.each([
        ['root:common', 'common'],
        ['module:entities', 'entities'],
        ['module', 'module'],
        ['root:unknown', '@unknown'],
        ['module:unknown', '@unknown'],
    ])('%s → %s', (layer, plain) => {
        expect(plainLayerName(layer)).toBe(plain);
    });

    it('простого слоя с именем unknown не бывает — имя отвергает валидация схемы', () => {
        // Иначе `root:unknown` означал бы два разных слоя сразу, а `plainLayerName` печатал бы
        // `@unknown` там, где в конфиге написано `unknown`.
        expect(() => compile(['unknown'])).toThrow('is reserved');
    });

    it('простого слоя с именем module не бывает — по той же причине', () => {
        // `root:module` — отдельный ключ индексов, но в сообщениях он неотличим от модуля целиком:
        // вердикт читался бы как «'module' must not import from 'module'».
        expect(plainLayerName('root:module')).toBe(plainLayerName(MODULE));
        expect(() => compile(['module'])).toThrow('is reserved');
    });
});

describe('isModuleLevel', () => {
    it.each([
        ['module:entities', true],
        ['module:unknown', true],
        ['root:common', false],
        ['root:unknown', false],
        // Модуль целиком объявляется в `layers` и стоит в порядке проекта, а не внутри модуля.
        ['module', false],
    ])('%s → %s', (layer, inside) => {
        expect(isModuleLevel(layer)).toBe(inside);
    });

    it('различает единственную пару слоёв, у которых простое имя совпадает', () => {
        // `@unknown` в обоих списках — валидный конфиг: сообщению, называющему оба конца импорта,
        // остаётся только уровень.
        expect(plainLayerName(ROOT_UNKNOWN)).toBe(plainLayerName(MODULE_UNKNOWN));
        expect(isModuleLevel(ROOT_UNKNOWN)).toBe(false);
        expect(isModuleLevel(MODULE_UNKNOWN)).toBe(true);
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
