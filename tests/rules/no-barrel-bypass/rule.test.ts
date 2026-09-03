import { Linter, RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';

import { createRule } from '../../../src/rules/no-barrel-bypass/index.js';

function hasEntryPointIn(dirs: Iterable<string>): (dir: string) => boolean {
    const set = new Set(dirs);
    return (dir: string) => set.has(dir);
}

const languageOptions = {
    ecmaVersion: 2022 as const,
    sourceType: 'module' as const,
    parser: tsParser,
};

// RuleTester ищет глобальные `describe`/`it`, которых нет в vitest без `globals: true` в конфиге —
// передаём их явно, иначе он falls back на свой mocha-style default handler.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

describe('no-barrel-bypass', () => {
    const env = { hasEntryPoint: hasEntryPointIn(['/repo/feature', '/repo/feature/inner']) };
    const rule = createRule(env);

    ruleTester.run('no-barrel-bypass', rule, {
        valid: [
            {
                code: "import { a } from './internal/thing.js';",
                filename: '/repo/feature/file.ts',
                languageOptions,
            },
            {
                code: "import { a } from '../sibling/thing.js';",
                filename: '/repo/other/file.ts',
                languageOptions,
            },
            {
                code: "import lodash from 'lodash';",
                filename: '/repo/other/file.ts',
                languageOptions,
            },
            {
                // filename не абсолютный ('<input>' при lintText без filePath) — правило выходит
                // сразу, арифметике не от чего отсчитывать
                code: "import { a } from '../feature/internal/thing.js';",
                filename: '<input>',
                languageOptions,
            },
            {
                // export ... from не проверяется вовсе — см. Out of scope плана
                code: "export { a } from '../feature/internal/thing.js';",
                filename: '/repo/other/file.ts',
                languageOptions,
            },
            {
                // динамический import(expr) без строкового литерала — не проверяется
                code: 'const path = "./x.js"; import(path);',
                filename: '/repo/other/file.ts',
                languageOptions,
            },
            {
                // require(expr) без строкового литерала — не проверяется
                code: 'const path = "./x.js"; require(path);',
                filename: '/repo/other/file.ts',
                languageOptions: { ecmaVersion: 2022 as const, sourceType: 'script' as const },
            },
        ],

        invalid: [
            {
                code: "import { a } from '../feature/internal/thing.js';",
                filename: '/repo/other/file.ts',
                languageOptions,
                output: null,
                errors: [
                    {
                        messageId: 'bypass',
                        data: {
                            suggestion: '../feature',
                            original: '../feature/internal/thing.js',
                        },
                        suggestions: [
                            {
                                messageId: 'useBarrel',
                                data: { suggestion: '../feature' },
                                output: "import { a } from '../feature';",
                            },
                        ],
                    },
                ],
            },
            {
                code: "import type { A } from '../feature/internal/thing.js';",
                filename: '/repo/other/file.ts',
                languageOptions,
                output: null,
                errors: [
                    {
                        messageId: 'bypass',
                        suggestions: [
                            {
                                messageId: 'useBarrel',
                                data: { suggestion: '../feature' },
                                output: "import type { A } from '../feature';",
                            },
                        ],
                    },
                ],
            },
            {
                code: "const mod = import('../feature/internal/thing.js');",
                filename: '/repo/other/file.ts',
                languageOptions,
                output: null,
                errors: [
                    {
                        messageId: 'bypass',
                        suggestions: [
                            {
                                messageId: 'useBarrel',
                                data: { suggestion: '../feature' },
                                output: "const mod = import('../feature');",
                            },
                        ],
                    },
                ],
            },
            {
                code: "const mod = require('../feature/internal/thing.js');",
                filename: '/repo/other/file.ts',
                languageOptions: { ecmaVersion: 2022 as const, sourceType: 'script' as const },
                output: null,
                errors: [
                    {
                        messageId: 'bypass',
                        suggestions: [
                            {
                                messageId: 'useBarrel',
                                data: { suggestion: '../feature' },
                                output: "const mod = require('../feature');",
                            },
                        ],
                    },
                ],
            },
            {
                // settings.weld.aliases: нарушение и путь приходят с алиасом, а не относительным
                code: "import { a } from '@feature/internal/thing.js';",
                filename: '/repo/other/file.ts',
                languageOptions,
                settings: {
                    weld: { baseUrl: '/repo', aliases: { '@feature': ['feature'] } },
                },
                output: null,
                errors: [
                    {
                        messageId: 'bypass',
                        data: { suggestion: '@feature', original: '@feature/internal/thing.js' },
                        suggestions: [
                            {
                                messageId: 'useBarrel',
                                data: { suggestion: '@feature' },
                                output: "import { a } from '@feature';",
                            },
                        ],
                    },
                ],
            },
            {
                // fix: false (по умолчанию) — правка приходит только как suggest, output не меняется
                code: "import { a } from '../feature/internal/thing.js';",
                filename: '/repo/other/file.ts',
                languageOptions,
                options: [{ fix: false }],
                output: null,
                errors: [
                    {
                        messageId: 'bypass',
                        suggestions: [
                            {
                                messageId: 'useBarrel',
                                data: { suggestion: '../feature' },
                                output: "import { a } from '../feature';",
                            },
                        ],
                    },
                ],
            },
            {
                // fix: true — правка приходит как fix с ожидаемым output, без suggest
                code: "import { a } from '../feature/internal/thing.js';",
                filename: '/repo/other/file.ts',
                languageOptions,
                options: [{ fix: true }],
                output: "import { a } from '../feature';",
                errors: [
                    {
                        messageId: 'bypass',
                        suggestions: undefined,
                    },
                ],
            },
            {
                // стиль кавычек в правке берётся из исходного литерала (двойные), fix: true
                code: 'import { a } from "../feature/internal/thing.js";',
                filename: '/repo/other/file.ts',
                languageOptions,
                options: [{ fix: true }],
                output: 'import { a } from "../feature";',
                errors: [{ messageId: 'bypass', suggestions: undefined }],
            },
        ],
    });
});

describe('no-barrel-bypass: filename в Windows-форме', () => {
    // нормализация разделителей доводит filename до арифметики; граница задана
    // на том же псевдо-диске 'C:', иначе у путей разные корни
    const env = { hasEntryPoint: hasEntryPointIn(['C:/repo/feature']) };
    const rule = createRule(env);

    ruleTester.run('no-barrel-bypass windows filename', rule, {
        valid: [],
        invalid: [
            {
                code: "import { a } from '../feature/internal/thing.js';",
                filename: 'C:\\repo\\other\\file.ts',
                languageOptions,
                output: null,
                errors: [
                    {
                        messageId: 'bypass',
                        suggestions: [
                            {
                                messageId: 'useBarrel',
                                data: { suggestion: '../feature' },
                                output: "import { a } from '../feature';",
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

describe('no-barrel-bypass: неверные settings.weld', () => {
    // невалидные settings.weld дают исключение внутри create() — это не нарушение правила
    // (какое RuleTester ожидает в `errors`), а ошибка линтера — проверяется напрямую через Linter
    it('падает с внятной ошибкой на каждом проверяемом файле', () => {
        const env = { hasEntryPoint: hasEntryPointIn(['/repo/feature']) };
        const rule = createRule(env);
        const linter = new Linter({ cwd: '/repo' });

        expect(() =>
            linter.verify(
                "import { a } from './x.js';",
                [
                    {
                        files: ['**/*.ts'],
                        languageOptions,
                        settings: { weld: { aliases: 'not-an-object' } },
                        plugins: { test: { rules: { 'no-barrel-bypass': rule } } },
                        rules: { 'test/no-barrel-bypass': 'error' },
                    },
                ],
                { filename: '/repo/other/file.ts' },
            ),
        ).toThrow(/settings\.weld\.aliases.*must be an object/);
    });
});
