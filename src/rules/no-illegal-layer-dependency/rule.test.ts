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
                            data: { layer: 'features', target: '@/modules/other/features' },
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
                            data: { layer: 'app', target: '@/common/utils/app/format.js' },
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
    it('формы импорта: `export ... from` не проверяется, `import type` и `require` проверяются', () => {
        ruleTester.run('no-illegal-layer-dependency forms', rule, {
            valid: [
                {
                    name: 'реэкспорт не обходится',
                    code: "export { a } from '@/modules/order/widgets/card';",
                    filename: featuresFile,
                    settings,
                },
            ],
            invalid: [
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
            ],
            invalid: [],
        });
    });

    it('схемы нет вовсе → исключение на каждом файле', () => {
        const withoutLayers = (filename: string) =>
            ({
                settings: { weld: { aliases } },
                cwd: '/',
                filename,
                options: [],
            }) as unknown as Rule.RuleContext;

        expect(() => rule.create(withoutLayers(featuresFile))).toThrow(/settings\.weld\.layers/);
        expect(() => rule.create(withoutLayers(commonFile))).toThrow(/options\.layers/);
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
