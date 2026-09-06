import type { Rule } from 'eslint';
import { describe, expect, it } from 'vitest';

import type { FsHost } from '@/host/index.js';
import { createFakeFsHost, createFsHost } from '@/host/index.js';

import { createRule } from '@/rules/no-barrel-bypass/index.js';
import { createRuleTester } from '@/testing/index.js';

const ruleTester = createRuleTester();

describe('weld/no-barrel-bypass', () => {
    const fsHost = createFakeFsHost(['/repo/src/other/index.ts']);
    const rule = createRule(fsHost);

    it('прогоняет RuleTester без исключений', () => {
        ruleTester.run('no-barrel-bypass', rule, {
            valid: [
                {
                    name: 'импорт самого барреля',
                    code: "import { a } from '../other/index.ts';",
                    filename: '/repo/src/feature/file.ts',
                },
                {
                    name: 'импорт соседа без границ на пути',
                    code: "import { a } from '../sibling/thing.ts';",
                    filename: '/repo/src/feature/file.ts',
                },
                {
                    name: 'голый пакет',
                    code: "import { a } from 'lodash';",
                    filename: '/repo/src/feature/file.ts',
                },
                {
                    name: 'неабсолютный context.filename',
                    code: "import { a } from '../other/internal.ts';",
                    filename: '<input>',
                },
                {
                    name: '`export { x } from` не проверяется',
                    code: "export { x } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                },
                {
                    name: 'нелитеральный import(expr)',
                    code: 'const path = "../other/internal.ts"; import(path);',
                    filename: '/repo/src/feature/file.ts',
                },
                {
                    name: 'нелитеральный require(expr)',
                    code: 'const path = "../other/internal.ts"; require(path);',
                    filename: '/repo/src/feature/file.ts',
                },
            ],
            invalid: [
                {
                    name: 'import',
                    code: "import { a } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    output: "import { a } from '../other/index.ts';",
                    errors: [
                        {
                            messageId: 'bypass',
                            data: {
                                suggestion: '../other/index.ts',
                                original: '../other/internal.ts',
                            },
                        },
                    ],
                },
                {
                    name: 'import без расширения → правка тоже без расширения',
                    code: "import { a } from '../other/internal';",
                    filename: '/repo/src/feature/file.ts',
                    output: "import { a } from '../other';",
                    errors: [
                        {
                            messageId: 'bypass',
                            data: { suggestion: '../other', original: '../other/internal' },
                        },
                    ],
                },
                {
                    name: 'import type',
                    code: "import type { A } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    output: "import type { A } from '../other/index.ts';",
                    errors: [
                        {
                            messageId: 'bypass',
                            data: {
                                suggestion: '../other/index.ts',
                                original: '../other/internal.ts',
                            },
                        },
                    ],
                },
                {
                    name: 'import()',
                    code: "const p = import('../other/internal.ts');",
                    filename: '/repo/src/feature/file.ts',
                    output: "const p = import('../other/index.ts');",
                    errors: [
                        {
                            messageId: 'bypass',
                            data: {
                                suggestion: '../other/index.ts',
                                original: '../other/internal.ts',
                            },
                        },
                    ],
                },
                {
                    name: 'require()',
                    code: "const a = require('../other/internal.ts');",
                    filename: '/repo/src/feature/file.ts',
                    output: "const a = require('../other/index.ts');",
                    errors: [
                        {
                            messageId: 'bypass',
                            data: {
                                suggestion: '../other/index.ts',
                                original: '../other/internal.ts',
                            },
                        },
                    ],
                },
            ],
        });
    });

    it('нарушение с алиасом приходит с исправленным путём в форме алиаса', () => {
        ruleTester.run('no-barrel-bypass alias', rule, {
            valid: [],
            invalid: [
                {
                    name: 'нарушение и правка приходят в форме алиаса',
                    code: "import { a } from '@src/other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    settings: { weld: { baseUrl: '/repo', aliases: { '@src/*': ['src/*'] } } },
                    output: "import { a } from '@src/other/index.ts';",
                    errors: [
                        {
                            messageId: 'bypass',
                            data: {
                                suggestion: '@src/other/index.ts',
                                original: '@src/other/internal.ts',
                            },
                        },
                    ],
                },
            ],
        });
    });

    it('fix: true (по умолчанию) → правка применяется автофиксом', () => {
        ruleTester.run('no-barrel-bypass fix', rule, {
            valid: [],
            invalid: [
                {
                    name: 'без опций правка применяется сразу',
                    code: "import { a } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    output: "import { a } from '../other/index.ts';",
                    errors: [{ messageId: 'bypass' }],
                },
            ],
        });
    });

    it('fix: false → правка приходит в suggest, output не меняется', () => {
        ruleTester.run('no-barrel-bypass suggest', rule, {
            valid: [],
            invalid: [
                {
                    name: 'options: [{ fix: false }] отключает автофикс',
                    code: "import { a } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    options: [{ fix: false }],
                    output: null,
                    errors: [
                        {
                            messageId: 'bypass',
                            suggestions: [
                                {
                                    messageId: 'useBarrel',
                                    data: { suggestion: '../other/index.ts' },
                                    output: "import { a } from '../other/index.ts';",
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it('сообщение указывается на строковом литерале пути, а не на всём операторе', () => {
        ruleTester.run('no-barrel-bypass location', rule, {
            valid: [],
            invalid: [
                {
                    name: 'диапазон ошибки совпадает с литералом специфаера',
                    code: "import { a } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    output: "import { a } from '../other/index.ts';",
                    errors: [
                        {
                            messageId: 'bypass',
                            line: 1,
                            column: 19,
                            endColumn: 41,
                        },
                    ],
                },
            ],
        });
    });

    it('стиль кавычек в правке берётся из исходного литерала', () => {
        ruleTester.run('no-barrel-bypass quotes', rule, {
            valid: [],
            invalid: [
                {
                    name: 'одинарные кавычки в исходнике → одинарные в правке',
                    code: "import { a } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    output: "import { a } from '../other/index.ts';",
                    errors: [{ messageId: 'bypass' }],
                },
                {
                    name: 'двойные кавычки в исходнике → двойные в правке',
                    code: 'import { a } from "../other/internal.ts";',
                    filename: '/repo/src/feature/file.ts',
                    output: 'import { a } from "../other/index.ts";',
                    errors: [{ messageId: 'bypass' }],
                },
            ],
        });
    });

    it('неверные settings.weld → внятная ошибка правила', () => {
        const fakeContext = {
            settings: { weld: { aliases: 'not-an-object' } },
            cwd: '/repo',
            filename: '/repo/src/feature/file.ts',
            options: [],
        } as unknown as Rule.RuleContext;

        expect(() => rule.create(fakeContext)).toThrow(/settings\.weld\.aliases/);
    });

    it('Windows filename нормализуется настоящим createFsHost в границе', () => {
        const windowsFsHost = createFsHost('C:\\proj', {
            exists: (realPath) => realPath === 'C:/proj/src/other/index.ts',
        });
        const windowsRule = createRule(windowsFsHost);

        ruleTester.run('no-barrel-bypass windows', windowsRule, {
            valid: [],
            invalid: [
                {
                    name: 'Windows-путь к файлу нормализуется в виртуальный',
                    code: "import { a } from '../other/internal.ts';",
                    filename: 'C:\\proj\\src\\feature\\file.ts',
                    output: "import { a } from '../other/index.ts';",
                    errors: [
                        {
                            messageId: 'bypass',
                            data: {
                                suggestion: '../other/index.ts',
                                original: '../other/internal.ts',
                            },
                        },
                    ],
                },
            ],
        });
    });

    it('файл вне root → правило молчит', () => {
        const outsideRootFsHost: FsHost = {
            hasEntryPoint: () => false,
            toVirtual: () => null,
        };
        const outsideRootRule = createRule(outsideRootFsHost);

        ruleTester.run('no-barrel-bypass outside root', outsideRootRule, {
            valid: [
                {
                    name: 'файл вне root → правило молчит',
                    code: "import { a } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                },
            ],
            invalid: [],
        });
    });
});
