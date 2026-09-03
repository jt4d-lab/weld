import { Linter, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { createRule } from './index.js';
import type { CheckEnv } from './check.js';

function fakeEnv(dirs: string[]): CheckEnv {
    const set = new Set(dirs);
    return { hasEntryPoint: (dir) => set.has(dir) };
}

const languageOptions = {
    ecmaVersion: 2022 as const,
    sourceType: 'module' as const,
    parser: tseslint.parser,
};

const ruleTester = new RuleTester({ languageOptions });

describe('weld/no-barrel-bypass', () => {
    it('прогоняет RuleTester без исключений', () => {
        const env = fakeEnv(['/repo/src/other']);
        const rule = createRule(env);

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
                    options: [{ fix: false }],
                    errors: [
                        {
                            messageId: 'bypass',
                            suggestions: [
                                {
                                    messageId: 'useBarrel',
                                    data: { suggestion: '../other' },
                                    output: "import { a } from '../other';",
                                },
                            ],
                        },
                    ],
                },
                {
                    name: 'import type',
                    code: "import type { A } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    options: [{ fix: false }],
                    errors: [
                        {
                            messageId: 'bypass',
                            suggestions: [
                                {
                                    messageId: 'useBarrel',
                                    data: { suggestion: '../other' },
                                    output: "import type { A } from '../other';",
                                },
                            ],
                        },
                    ],
                },
                {
                    name: 'import()',
                    code: "const p = import('../other/internal.ts');",
                    filename: '/repo/src/feature/file.ts',
                    options: [{ fix: false }],
                    errors: [
                        {
                            messageId: 'bypass',
                            suggestions: [
                                {
                                    messageId: 'useBarrel',
                                    data: { suggestion: '../other' },
                                    output: "const p = import('../other');",
                                },
                            ],
                        },
                    ],
                },
                {
                    name: 'require()',
                    code: "const a = require('../other/internal.ts');",
                    filename: '/repo/src/feature/file.ts',
                    options: [{ fix: false }],
                    errors: [
                        {
                            messageId: 'bypass',
                            suggestions: [
                                {
                                    messageId: 'useBarrel',
                                    data: { suggestion: '../other' },
                                    output: "const a = require('../other');",
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it('нарушение с алиасом приходит с исправленным путём в форме алиаса', () => {
        const env = fakeEnv(['/repo/src/other']);
        const rule = createRule(env);

        ruleTester.run('no-barrel-bypass alias', rule, {
            valid: [],
            invalid: [
                {
                    name: 'алиас',
                    code: "import { a } from '@src/other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    settings: { weld: { baseUrl: '/repo', aliases: { '@src/*': ['src/*'] } } },
                    options: [{ fix: false }],
                    errors: [
                        {
                            messageId: 'bypass',
                            data: { suggestion: '@src/other', original: '@src/other/internal.ts' },
                            suggestions: [
                                {
                                    messageId: 'useBarrel',
                                    data: { suggestion: '@src/other' },
                                    output: "import { a } from '@src/other';",
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it('нормализует Windows-путь filename перед арифметикой', () => {
        const env = fakeEnv(['C:/repo/src/other']);
        const rule = createRule(env);

        ruleTester.run('no-barrel-bypass windows', rule, {
            valid: [],
            invalid: [
                {
                    name: 'windows filename',
                    code: "import { a } from '../other/internal.ts';",
                    filename: 'C:\\repo\\src\\feature\\file.ts',
                    options: [{ fix: false }],
                    errors: [
                        {
                            messageId: 'bypass',
                            suggestions: [
                                {
                                    messageId: 'useBarrel',
                                    data: { suggestion: '../other' },
                                    output: "import { a } from '../other';",
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it('падает с внятной ошибкой при неверных settings.weld', () => {
        const env = fakeEnv([]);
        const rule = createRule(env);
        const linter = new Linter({ cwd: '/repo' });

        expect(() =>
            linter.verify(
                "import { a } from '../other/internal.ts';",
                {
                    files: ['**/*.ts'],
                    languageOptions,
                    plugins: { local: { rules: { 'no-barrel-bypass': rule } } },
                    settings: { weld: { aliases: 'nope' } },
                    rules: { 'local/no-barrel-bypass': 'error' },
                },
                '/repo/src/feature/file.ts',
            ),
        ).toThrow('settings.weld.aliases must be an object');
    });

    it('fix:false выдаёт suggestion, output не меняется', () => {
        const env = fakeEnv(['/repo/src/other']);
        const rule = createRule(env);

        ruleTester.run('no-barrel-bypass fix:false', rule, {
            valid: [],
            invalid: [
                {
                    name: 'fix:false → suggestion',
                    code: "import { a } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    options: [{ fix: false }],
                    errors: [
                        {
                            messageId: 'bypass',
                            suggestions: [
                                {
                                    messageId: 'useBarrel',
                                    data: { suggestion: '../other' },
                                    output: "import { a } from '../other';",
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it('без опции fix применяется автофикс (fix:true по умолчанию)', () => {
        const env = fakeEnv(['/repo/src/other']);
        const rule = createRule(env);

        ruleTester.run('no-barrel-bypass default fix', rule, {
            valid: [],
            invalid: [
                {
                    name: 'опция fix не задана → fix',
                    code: "import { a } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    output: "import { a } from '../other';",
                    errors: [{ messageId: 'bypass' }],
                },
            ],
        });
    });

    it('fix:true применяет автофикс', () => {
        const env = fakeEnv(['/repo/src/other']);
        const rule = createRule(env);

        ruleTester.run('no-barrel-bypass fix:true', rule, {
            valid: [],
            invalid: [
                {
                    name: 'fix:true → fix',
                    code: "import { a } from '../other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    options: [{ fix: true }],
                    output: "import { a } from '../other';",
                    errors: [{ messageId: 'bypass' }],
                },
            ],
        });
    });

    it('сохраняет стиль кавычек исходного литерала', () => {
        const env = fakeEnv(['/repo/src/other']);
        const rule = createRule(env);

        ruleTester.run('no-barrel-bypass quotes', rule, {
            valid: [],
            invalid: [
                {
                    name: 'одинарные кавычки сохраняются',
                    code: `import { a } from '../other/internal.ts';`,
                    filename: '/repo/src/feature/file.ts',
                    options: [{ fix: true }],
                    output: `import { a } from '../other';`,
                    errors: [{ messageId: 'bypass' }],
                },
                {
                    name: 'двойные кавычки сохраняются',
                    code: `import { a } from "../other/internal.ts";`,
                    filename: '/repo/src/feature/file.ts',
                    options: [{ fix: true }],
                    output: `import { a } from "../other";`,
                    errors: [{ messageId: 'bypass' }],
                },
            ],
        });
    });
});
