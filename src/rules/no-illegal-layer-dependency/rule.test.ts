/**
 * Поведение правила целиком: от `settings.weld` до сообщения на литерале специфаера. Диск здесь не
 * участвует — фейковый `FsHost` без единого файла только виртуализует путь линтуемого файла, а слой
 * правило читает из имён сегментов.
 *
 * Схема во всех наборах одна и та же (плюс `legacy` — слой проекта ниже модулей), поэтому расчёты
 * прав читаются по развёрнутому порядку из заголовка.
 */

import type { Rule } from 'eslint';
import { describe, expect, it } from 'vitest';

import type { FsHost } from '@/host/index.js';
import { createFakeFsHost } from '@/host/index.js';

import { createRule } from '@/rules/no-illegal-layer-dependency/index.js';
import { createRuleTester } from '@/testing/index.js';

const ruleTester = createRuleTester();

/** Правило диск не читает: списку файлов взяться неоткуда, и он пуст. */
const rule = createRule(createFakeFsHost([]));

const aliases = { '@/*': ['src/*'] };

/**
 * Развёрнутый порядок: `root:common`, `root:legacy`, `root:unknown`, `module`, `module:entities`,
 * `module:features`, `module:widgets`, `module`, `root:pages`, `root:app`.
 */
const settings = {
    weld: {
        layers: ['common', 'legacy', '@unknown', '@modules', 'pages', 'app'],
        moduleLayers: ['entities', 'features', 'widgets'],
        aliases,
    },
};

/** Схема без `@unknown`: код вне слоёв в ней недостижим и сам импортировать не может. */
const strictSettings = {
    weld: {
        layers: ['common', '@modules', 'pages', 'app'],
        moduleLayers: ['entities', 'features', 'widgets'],
        aliases,
    },
};

/** Схема без `@modules`: модули в дереве есть, но в порядке слоёв для них места не объявлено. */
const noModulesSettings = {
    weld: { layers: ['common', '@unknown', 'pages', 'app'], aliases },
};

/**
 * Схема с `@unknown` в обоих списках — два разных слоя, которые в сообщениях называются одинаково.
 * Развёрнутый порядок: `root:common`, `root:unknown`, `module`, `module:unknown`,
 * `module:entities`, `module:features`, `module`, `root:pages`, `root:app`.
 */
const twoLevelSettings = {
    weld: {
        layers: ['common', '@unknown', '@modules', 'pages', 'app'],
        moduleLayers: ['@unknown', 'entities', 'features'],
        aliases,
    },
};

const featuresFile = '/src/modules/order/features/cart/model.ts';
const widgetsFile = '/src/modules/order/widgets/card/ui.tsx';
const commonFile = '/src/common/ui/button.tsx';

describe('weld/no-illegal-layer-dependency', () => {
    it('легальные направления и внутренние импорты не репортятся', () => {
        ruleTester.run('no-illegal-layer-dependency valid', rule, {
            valid: [
                {
                    name: 'слой модуля импортирует нижний слой того же модуля',
                    code: "import { a } from '@/modules/order/entities';",
                    filename: featuresFile,
                    settings,
                },
                {
                    name: 'слой модуля импортирует слой проекта ниже модулей',
                    code: "import { a } from '@/legacy/api';",
                    filename: widgetsFile,
                    settings,
                },
                {
                    name: 'внутренний импорт своего слоя',
                    code: "import { a } from '../other/thing.js';",
                    filename: featuresFile,
                    settings,
                },
                {
                    name: 'баррель слоя проекта',
                    code: "import { a } from '@/common';",
                    filename: featuresFile,
                    settings,
                },
                {
                    name: 'баррель чужого модуля',
                    code: "import { a } from '@/modules/other';",
                    filename: featuresFile,
                    settings,
                },
                {
                    name: 'голый пакет правилу не принадлежит',
                    code: "import { a } from 'lodash';",
                    filename: featuresFile,
                    settings,
                },
            ],
            invalid: [],
        });
    });

    it('нарушение направления называет оба слоя простыми именами', () => {
        ruleTester.run('no-illegal-layer-dependency illegal', rule, {
            valid: [],
            invalid: [
                {
                    name: 'features → widgets внутри модуля',
                    code: "import { a } from '@/modules/order/widgets/card';",
                    filename: featuresFile,
                    settings,
                    errors: [
                        {
                            messageId: 'illegalDependency',
                            data: {
                                fromLayer: 'features',
                                toLayer: 'widgets',
                                target: '@/modules/order/widgets/card',
                            },
                        },
                    ],
                },
                {
                    name: 'common → app на уровне проекта',
                    code: "import { config } from '@/app/config';",
                    filename: commonFile,
                    settings,
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

    it('горизонталь — одноимённые слои разных владельцев', () => {
        ruleTester.run('no-illegal-layer-dependency horizontal', rule, {
            valid: [],
            invalid: [
                {
                    name: 'features чужого модуля',
                    code: "import { a } from '@/modules/other/features';",
                    filename: featuresFile,
                    settings,
                    errors: [
                        {
                            messageId: 'horizontalDependency',
                            data: {
                                layer: 'features',
                                list: 'moduleLayers',
                                target: '@/modules/other/features',
                            },
                            // Репорт вешается на литерал пути, а не на весь оператор.
                            line: 1,
                            column: 19,
                        },
                    ],
                },
                {
                    name: 'одноимённый слой проекта — следствие deepest',
                    code: "import { a } from '@/common/utils/app/format.js';",
                    filename: '/src/app/main.ts',
                    settings,
                    errors: [
                        {
                            messageId: 'horizontalDependency',
                            data: {
                                layer: 'app',
                                list: 'layers',
                                target: '@/common/utils/app/format.js',
                            },
                        },
                    ],
                },
            ],
        });
    });
});

describe('слой самого файла вне схемы', () => {
    it('репортится один раз на файл, импорты при этом не проверяются', () => {
        ruleTester.run('no-illegal-layer-dependency undeclaredLayer', rule, {
            valid: [],
            invalid: [
                {
                    name: 'код вне слоёв при схеме без @unknown',
                    code: [
                        "import { a } from '@/app/config';",
                        "import { b } from '@/common';",
                        'export const c = [a, b];',
                    ].join('\n'),
                    filename: '/src/shared/lib/x.ts',
                    settings: strictSettings,
                    errors: [
                        {
                            messageId: 'undeclaredLayer',
                            data: { layer: '@unknown', declare: "'@unknown' in layers" },
                            // Репорт на файл целиком: узел — `Program`, а не какой-то из импортов.
                            line: 1,
                            column: 1,
                            endLine: 3,
                        },
                    ],
                },
                {
                    name: 'неразмеченный код модуля при схеме без @modules',
                    code: "import { a } from '@/common';",
                    filename: '/src/modules/order/lib/x.ts',
                    settings: noModulesSettings,
                    errors: [
                        {
                            messageId: 'undeclaredLayer',
                            data: { layer: 'module', declare: "'@modules' in layers" },
                        },
                    ],
                },
            ],
        });
    });
});

describe('цель без объявленного слоя', () => {
    it('внутренности чужого модуля', () => {
        ruleTester.run('no-illegal-layer-dependency moduleInternals', rule, {
            valid: [],
            invalid: [
                {
                    name: 'у цели нет слоя внутри её модуля',
                    code: "import { a } from '@/modules/other/lib/x.js';",
                    filename: featuresFile,
                    settings,
                    errors: [
                        {
                            messageId: 'moduleInternals',
                            data: { fromLayer: 'features', target: '@/modules/other/lib/x.js' },
                        },
                    ],
                },
            ],
        });
    });

    it('внутренности модуля при схеме без @modules — совет объявить @modules, а не moduleLayers', () => {
        ruleTester.run('no-illegal-layer-dependency moduleInternals without @modules', rule, {
            valid: [],
            invalid: [
                {
                    // Совет `'@unknown' in moduleLayers` здесь был бы советом написать конфиг,
                    // который разбор схемы отвергает исключением и роняет весь прогон ESLint.
                    name: 'модулей в схеме нет — первым шагом объявляется @modules',
                    code: "import { a } from '@/modules/order/lib/format.js';",
                    filename: '/src/pages/home/index.ts',
                    settings: noModulesSettings,
                    errors: [
                        {
                            messageId: 'undeclaredTargetLayer',
                            data: {
                                layer: 'module',
                                declare: "'@modules' in layers",
                                target: '@/modules/order/lib/format.js',
                            },
                        },
                    ],
                },
            ],
        });
    });

    it('undeclaredTargetLayer во всех трёх формах совета', () => {
        ruleTester.run('no-illegal-layer-dependency undeclaredTargetLayer', rule, {
            valid: [],
            invalid: [
                {
                    name: "цель вне слоёв проекта — '@unknown' in layers",
                    code: "import { a } from '@/shared/lib/x.js';",
                    filename: commonFile,
                    settings: strictSettings,
                    errors: [
                        {
                            messageId: 'undeclaredTargetLayer',
                            data: {
                                layer: '@unknown',
                                declare: "'@unknown' in layers",
                                target: '@/shared/lib/x.js',
                            },
                        },
                    ],
                },
                {
                    name: "неразмеченный код своего модуля — '@unknown' in moduleLayers",
                    code: "import { a } from '@/modules/order/lib/x.js';",
                    filename: featuresFile,
                    settings,
                    errors: [
                        {
                            messageId: 'undeclaredTargetLayer',
                            data: {
                                layer: '@unknown',
                                declare: "'@unknown' in moduleLayers",
                                target: '@/modules/order/lib/x.js',
                            },
                        },
                    ],
                },
                {
                    name: "модуль как целое при схеме без @modules — '@modules' in layers",
                    code: "import { a } from '@/modules/order';",
                    filename: commonFile,
                    settings: noModulesSettings,
                    errors: [
                        {
                            messageId: 'undeclaredTargetLayer',
                            data: {
                                layer: 'module',
                                declare: "'@modules' in layers",
                                target: '@/modules/order',
                            },
                        },
                    ],
                },
            ],
        });
    });
});

describe('границы правила', () => {
    it('формы импорта: `export ... from`, `import type`, `require` и `import =` проверяются', () => {
        ruleTester.run('no-illegal-layer-dependency forms', rule, {
            valid: [
                {
                    name: 'экспорт без `from` зависимостью не является',
                    code: 'const a = 1;\nexport { a };',
                    filename: featuresFile,
                    settings,
                },
                {
                    name: 'реэкспорт легального направления',
                    code: "export { a } from '@/modules/order/entities';",
                    filename: featuresFile,
                    settings,
                },
                {
                    // Баррели собраны из реэкспортов, и обход не должен превращать их в нарушение:
                    // у барреля слоя владелец общий с его содержимым, у барреля модуля — диапазон
                    // `module` вокруг слоёв модуля.
                    name: 'баррель слоя собирает своё содержимое',
                    code: "export { Button } from './ui/button';",
                    filename: '/src/common/index.ts',
                    settings,
                },
                {
                    name: 'баррель модуля собирает свои слои',
                    code: "export * from './entities';",
                    filename: '/src/modules/order/index.ts',
                    settings,
                },
            ],
            invalid: [
                {
                    // Реэкспорт — такое же ребро графа зависимостей, как импорт: иначе запрет
                    // обходился бы переписыванием пары `import` + `export` в одну строку.
                    name: 'export ... from',
                    code: "export { a } from '@/modules/order/widgets/card';",
                    filename: featuresFile,
                    settings,
                    errors: [{ messageId: 'illegalDependency' }],
                },
                {
                    name: 'export * from',
                    code: "export * from '@/modules/order/widgets/card';",
                    filename: featuresFile,
                    settings,
                    errors: [{ messageId: 'illegalDependency' }],
                },
                {
                    name: 'import type',
                    code: "import type { A } from '@/modules/order/widgets/card';",
                    filename: featuresFile,
                    settings,
                    errors: [{ messageId: 'illegalDependency' }],
                },
                {
                    name: 'require()',
                    code: "const a = require('@/modules/order/widgets/card');",
                    filename: featuresFile,
                    settings,
                    errors: [{ messageId: 'illegalDependency' }],
                },
                {
                    // TypeScript-форма `require`: специфаер лежит не в `source` и не в аргументе
                    // вызова, и без её обхода направление проверялось бы не везде.
                    name: 'import x = require()',
                    code: "import a = require('@/modules/order/widgets/card');",
                    filename: featuresFile,
                    settings,
                    errors: [{ messageId: 'illegalDependency' }],
                },
                {
                    name: 'динамический import()',
                    code: "const a = import('@/modules/order/widgets/card');",
                    filename: featuresFile,
                    settings,
                    errors: [{ messageId: 'illegalDependency' }],
                },
            ],
        });
    });

    it('файл вне корня репозитория → правило молчит даже без схемы', () => {
        const outsideRootFsHost: FsHost = {
            hasEntryPoint: () => false,
            toVirtual: () => null,
        };

        ruleTester.run('no-illegal-layer-dependency outside root', createRule(outsideRootFsHost), {
            valid: [
                {
                    name: 'виртуального пути у файла нет — проверять нечего',
                    code: "import { a } from '@/modules/order/widgets/card';",
                    filename: featuresFile,
                    settings,
                },
                {
                    name: 'схемы нет вовсе — но до её проверки дело не доходит',
                    code: "import { a } from '@/modules/order/widgets/card';",
                    filename: featuresFile,
                    settings: { weld: { aliases } },
                },
            ],
            invalid: [],
        });
    });

    it('схемы нет вовсе → исключение из create(), а не молчание', () => {
        const withoutLayers = (filename: string) =>
            ({
                settings: { weld: { aliases } },
                cwd: '/',
                filename,
                options: [],
            }) as unknown as Rule.RuleContext;

        // Текст один на оба источника схемы: правило не знает, где пользователь собирался её задать.
        const missingSchema =
            'weld/no-illegal-layer-dependency requires a layer schema: set settings.weld.layers or options.layers';

        expect(() => rule.create(withoutLayers(featuresFile))).toThrow(missingSchema);
        expect(() => rule.create(withoutLayers(commonFile))).toThrow(missingSchema);
    });

    it('схема есть, но сломана → исключение из слоя настроек, а не молчание', () => {
        const brokenSchema = {
            settings: { weld: { layers: 'nope', aliases } },
            cwd: '/',
            filename: featuresFile,
            options: [],
        } as unknown as Rule.RuleContext;

        expect(() => rule.create(brokenSchema)).toThrow('settings.weld.layers must be an array');
    });

    it('схема, заданная только опцией, работает и без settings.weld.layers', () => {
        ruleTester.run('no-illegal-layer-dependency options-only schema', rule, {
            valid: [
                {
                    name: 'секции нет вовсе — схема и алиасы приходят из опций',
                    code: "import { a } from '@/common/ui';",
                    filename: '/src/app/main.ts',
                    options: [{ layers: ['common', 'app'], aliases }],
                },
            ],
            invalid: [
                {
                    name: 'та же схема из опций ловит обратное направление',
                    code: "import { config } from '@/app/config';",
                    filename: commonFile,
                    options: [{ layers: ['common', 'app'], aliases }],
                    errors: [
                        {
                            messageId: 'illegalDependency',
                            data: { fromLayer: 'common', toLayer: 'app', target: '@/app/config' },
                        },
                    ],
                },
            ],
        });
    });

    it('неразмеченный код модуля живёт по правам модуля целиком', () => {
        // Схлопывание источника: `module:unknown` в схеме не объявлен, и без него у файла не было бы
        // прав ни на что.
        const libFile = '/src/modules/order/lib/format.ts';

        ruleTester.run('no-illegal-layer-dependency module:unknown source', rule, {
            valid: [
                {
                    name: 'права модуля дотягиваются до слоёв модулей',
                    code: "import { a } from '@/modules/other/widgets/card';",
                    filename: libFile,
                    settings,
                },
            ],
            invalid: [
                {
                    name: 'но не до слоёв проекта правее модулей',
                    code: "import { a } from '@/pages/checkout';",
                    filename: libFile,
                    settings,
                    errors: [
                        {
                            messageId: 'illegalDependency',
                            data: {
                                fromLayer: 'module',
                                toLayer: 'pages',
                                target: '@/pages/checkout',
                            },
                        },
                    ],
                },
            ],
        });
    });

    it('у кода без слоя владельца нет: горизонталью считается и сосед по директории', () => {
        // Самая частая форма кода в проекте, который только что объявил `@unknown`. Сообщение
        // поэтому не говорит «из другой директории» — здесь директория та же самая.
        ruleTester.run('no-illegal-layer-dependency unowned horizontal', rule, {
            valid: [
                {
                    name: 'смежный повтор @unknown открывает такие связи',
                    code: "import { b } from './b.js';",
                    filename: '/src/shared/a.ts',
                    settings: {
                        weld: { layers: ['common', '@unknown', '@unknown', 'app'], aliases },
                    },
                },
            ],
            invalid: [
                {
                    name: 'один @unknown в схеме — точка, а не диапазон',
                    code: "import { b } from './b.js';",
                    filename: '/src/shared/a.ts',
                    settings,
                    errors: [
                        {
                            messageId: 'horizontalDependency',
                            data: { layer: '@unknown', list: 'layers', target: './b.js' },
                        },
                    ],
                },
            ],
        });
    });

    it('@unknown на двух уровнях: сообщение называет уровень каждого конца', () => {
        // Простого имени здесь не хватает: оба слоя называются `@unknown`, и без уровней сообщение
        // читалось бы как «слой не может импортировать сам себя».
        ruleTester.run('no-illegal-layer-dependency two levels of @unknown', rule, {
            valid: [
                {
                    name: 'обратное направление схема допускает',
                    code: "import { a } from '@/shared/date';",
                    filename: '/src/modules/order/lib/format.ts',
                    settings: twoLevelSettings,
                },
            ],
            invalid: [
                {
                    name: 'код вне слоёв → неразмеченный код модуля',
                    code: "import { y } from '@/modules/order/lib/y';",
                    filename: '/src/shared/x.ts',
                    settings: twoLevelSettings,
                    errors: [
                        {
                            messageId: 'illegalDependencyAcrossLevels',
                            data: {
                                fromLayer: '@unknown',
                                fromLevel: 'outside modules',
                                toLayer: '@unknown',
                                toLevel: 'inside a module',
                                target: '@/modules/order/lib/y',
                            },
                        },
                    ],
                },
            ],
        });
    });

    it('пустая схема исключением не является — в ней просто нет ни одного слоя', () => {
        ruleTester.run('no-illegal-layer-dependency empty schema', rule, {
            valid: [],
            invalid: [
                {
                    name: 'layers: [] — файл репортится как код вне схемы, а не как ошибка конфига',
                    code: "import { a } from '@/common';",
                    filename: commonFile,
                    settings: { weld: { layers: [], aliases } },
                    errors: [
                        {
                            messageId: 'undeclaredLayer',
                            data: { layer: '@unknown', declare: "'@unknown' in layers" },
                        },
                    ],
                },
            ],
        });
    });
});

describe('meta правила', () => {
    /**
     * Тексты сообщений — часть интерфейса правила: они уходят в вывод ESLint и в баг-репорты, а
     * проверки через `messageId`/`data` их не видят (RuleTester подставляет те же данные в тот же
     * шаблон). Поэтому прописью и целиком.
     */
    it('шесть сообщений с точными текстами', () => {
        expect(rule.meta?.messages).toEqual({
            illegalDependency:
                "Illegal layer dependency: '{{fromLayer}}' must not import from '{{toLayer}}'.",
            illegalDependencyAcrossLevels:
                "Illegal layer dependency: '{{fromLayer}}' {{fromLevel}} must not import from '{{toLayer}}' {{toLevel}}. Same name, different layers: they are declared separately in layers and moduleLayers.",
            horizontalDependency:
                "Illegal layer dependency: '{{layer}}' must not import from another '{{layer}}'. Declare '{{layer}}' twice in a row in {{list}} to allow horizontal imports.",
            undeclaredLayer:
                "This file belongs to '{{layer}}', which is not declared in the layer schema. Move the file into a layer, or declare {{declare}}.",
            undeclaredTargetLayer:
                "'{{target}}' belongs to '{{layer}}', which is not declared in the layer schema. Move it into a layer, or declare {{declare}}.",
            moduleInternals:
                "'{{fromLayer}}' must not import internals of another module: '{{target}}' has no layer inside its module. Import through the module barrel, or declare '@unknown' in moduleLayers.",
        });
    });

    it('ни автофикса, ни подсказок: нарушение направления правкой пути не исправляется', () => {
        expect(rule.meta?.fixable).toBeUndefined();
        expect(rule.meta?.hasSuggestions).toBeUndefined();
    });
});
