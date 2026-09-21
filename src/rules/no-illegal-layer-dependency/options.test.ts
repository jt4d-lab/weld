/**
 * Опции правила: три схемных (`layers`, `moduleLayers`, `moduleDir`) плюс общие из
 * `WELD_OPTION_PROPERTIES`. Проверяется, что схемные действительно перекрывают `settings.weld`, —
 * поэтому в каждой паре тестов секция описывает порядок, при котором импорт легален, а опция —
 * порядок, при котором он нарушение (или наоборот).
 */

import { describe, expect, it } from 'vitest';

import { createFakeFsHost } from '@/host/index.js';

import { createRule } from '@/rules/no-illegal-layer-dependency/index.js';
import { createRuleTester } from '@/testing/index.js';

const ruleTester = createRuleTester();

const rule = createRule(createFakeFsHost([]));

const aliases = { '@/*': ['src/*'] };

const commonFile = '/src/common/ui/button.tsx';
const featuresFile = '/src/modules/order/features/cart/model.ts';

describe('options.layers перекрывает settings.weld.layers', () => {
    /** Перевёрнутый порядок: `app` ниже `common`, поэтому `common → app` секцией разрешён. */
    const reversed = { weld: { layers: ['app', 'common'], aliases } };

    it('секция без опции разрешает импорт, опция его запрещает', () => {
        ruleTester.run('no-illegal-layer-dependency options.layers', rule, {
            valid: [
                {
                    name: 'порядок из секции: app стоит левее common',
                    code: "import { config } from '@/app/config';",
                    filename: commonFile,
                    settings: reversed,
                },
            ],
            invalid: [
                {
                    name: 'порядок из опций: common левее app',
                    code: "import { config } from '@/app/config';",
                    filename: commonFile,
                    settings: reversed,
                    options: [{ layers: ['common', 'app'] }],
                    errors: [
                        {
                            messageId: 'illegalDependency',
                            data: {
                                fromLayer: 'common',
                                toLayer: 'app',
                                target: '@/app/config',
                            },
                        },
                    ],
                },
            ],
        });
    });
});

describe('options.moduleLayers перекрывает settings.weld.moduleLayers', () => {
    /** Слои модуля в секции перевёрнуты: `entities` стоит выше `features`. */
    const reversed = {
        weld: {
            layers: ['common', '@modules', 'app'],
            moduleLayers: ['widgets', 'features', 'entities'],
            aliases,
        },
    };

    it('опция возвращает слоям модуля нормальный порядок', () => {
        ruleTester.run('no-illegal-layer-dependency options.moduleLayers', rule, {
            valid: [
                {
                    name: 'порядок из опций: entities ниже features',
                    code: "import { a } from '@/modules/order/entities';",
                    filename: featuresFile,
                    settings: reversed,
                    options: [{ moduleLayers: ['entities', 'features', 'widgets'] }],
                },
            ],
            invalid: [
                {
                    name: 'порядок из секции: entities выше features',
                    code: "import { a } from '@/modules/order/entities';",
                    filename: featuresFile,
                    settings: reversed,
                    errors: [
                        {
                            messageId: 'illegalDependency',
                            data: {
                                fromLayer: 'features',
                                toLayer: 'entities',
                                target: '@/modules/order/entities',
                            },
                        },
                    ],
                },
            ],
        });
    });
});

describe('options.moduleDir перекрывает settings.weld.moduleDir', () => {
    const settings = {
        weld: {
            layers: ['common', '@unknown', '@modules', 'pages', 'app'],
            moduleLayers: ['entities', 'features', 'widgets'],
            aliases,
        },
    };

    const packagesFile = '/src/packages/order/features/cart/model.ts';

    it('опция переносит границу модулей в другую директорию', () => {
        ruleTester.run('no-illegal-layer-dependency options.moduleDir', rule, {
            valid: [
                {
                    name: 'moduleDir из опций: packages/order — модуль, features — его слой',
                    code: "import { a } from '@/packages/order/entities';",
                    filename: packagesFile,
                    settings,
                    options: [{ moduleDir: 'packages' }],
                },
            ],
            invalid: [
                {
                    name: 'без опции modules не совпадает с packages: обе стороны вне слоёв',
                    code: "import { a } from '@/packages/order/entities';",
                    filename: packagesFile,
                    settings,
                    errors: [
                        {
                            messageId: 'horizontalDependency',
                            data: {
                                layer: '@unknown',
                                list: 'layers',
                                target: '@/packages/order/entities',
                            },
                        },
                    ],
                },
            ],
        });
    });
});

describe('общие опции и схема опций', () => {
    it('options.aliases и options.repoRoot принимаются правилом', () => {
        ruleTester.run('no-illegal-layer-dependency common options', rule, {
            valid: [],
            invalid: [
                {
                    name: 'алиасы заданы только опцией — специфаер всё равно разбирается',
                    code: "import { config } from '@/app/config';",
                    filename: commonFile,
                    settings: { weld: { layers: ['common', 'app'] } },
                    options: [{ repoRoot: '/', aliases }],
                    errors: [
                        {
                            messageId: 'illegalDependency',
                            data: {
                                fromLayer: 'common',
                                toLayer: 'app',
                                target: '@/app/config',
                            },
                        },
                    ],
                },
            ],
        });
    });

    /** Прогон одного valid-случая с заданными опциями: тест ждёт от него ошибки схемы опций. */
    const runWithOptions = (name: string, options: unknown[]): void => {
        ruleTester.run(name, rule, {
            valid: [
                {
                    name,
                    code: "import { a } from '@/common';",
                    filename: commonFile,
                    settings: { weld: { layers: ['common', 'app'], aliases } },
                    options,
                },
            ],
            invalid: [],
        });
    };

    it('неизвестный ключ опций отвергается схемой', () => {
        expect(() =>
            runWithOptions('no-illegal-layer-dependency unknown option', [
                { layersOrder: ['common', 'app'] },
            ]),
        ).toThrow(/should NOT have additional properties/);
    });

    it('значение схемной опции неверного типа отсекается схемой', () => {
        expect(() =>
            runWithOptions('no-illegal-layer-dependency option type', [{ moduleDir: 42 }]),
        ).toThrow(/should be string/);
    });

    it('элемент layers неверного типа отсекается схемой, а не разбором', () => {
        // Иначе опечатка в конфиге превращалась бы в исключение из `create()`, то есть в упавший
        // прогон ESLint вместо обычной ошибки конфигурации.
        expect(() =>
            runWithOptions('no-illegal-layer-dependency layers items', [
                { layers: ['common', 42] },
            ]),
        ).toThrow(/should be string/);

        expect(() =>
            runWithOptions('no-illegal-layer-dependency moduleLayers items', [
                { layers: ['@modules'], moduleLayers: [42] },
            ]),
        ).toThrow(/should be string/);
    });
});
