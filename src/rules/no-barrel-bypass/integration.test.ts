import { fileURLToPath } from 'node:url';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

import { toPosix } from '../../path/posix.js';
import { createEntryPointEnv } from '../../env/entry-point.js';
import { createRule } from './index.js';

const PROJECT_DIR = toPosix(fileURLToPath(new URL('./fixtures/project', import.meta.url)));

const languageOptions = {
    ecmaVersion: 2022 as const,
    sourceType: 'module' as const,
    parser: tseslint.parser,
};

const ruleTester = new RuleTester({ languageOptions });

describe('интеграция weld/no-barrel-bypass с реальным createEntryPointEnv', () => {
    it('находит нарушение на фикстуре по относительному импорту', () => {
        const env = createEntryPointEnv();
        const rule = createRule(env);

        ruleTester.run('no-barrel-bypass fixture relative', rule, {
            valid: [],
            invalid: [
                {
                    name: 'относительный импорт пробивает баррель фикстуры',
                    code: "import { a } from '../feature/internal.ts';",
                    filename: `${PROJECT_DIR}/src/other/file.ts`,
                    options: [{ fix: false }],
                    errors: [
                        {
                            messageId: 'bypass',
                            data: { suggestion: '../feature', original: '../feature/internal.ts' },
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

    it('исправленный путь использует алиас, указывающий в фикстуру', () => {
        const env = createEntryPointEnv();
        const rule = createRule(env);

        ruleTester.run('no-barrel-bypass fixture alias', rule, {
            valid: [],
            invalid: [
                {
                    name: 'алиас, покрывающий src фикстуры',
                    code: "import { a } from '@src/feature/internal.ts';",
                    filename: `${PROJECT_DIR}/src/other/file.ts`,
                    settings: {
                        weld: { baseUrl: PROJECT_DIR, aliases: { '@src/*': ['src/*'] } },
                    },
                    options: [{ fix: false }],
                    errors: [
                        {
                            messageId: 'bypass',
                            data: {
                                suggestion: '@src/feature',
                                original: '@src/feature/internal.ts',
                            },
                            suggestions: [
                                {
                                    messageId: 'useBarrel',
                                    data: { suggestion: '@src/feature' },
                                    output: "import { a } from '@src/feature';",
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it('повторный прогон по той же границе даёт стабильный результат из кэша', () => {
        const env = createEntryPointEnv();
        const rule = createRule(env);

        const scenario = {
            name: 'та же граница, второй прогон',
            code: "import { a } from '../feature/internal.ts';",
            filename: `${PROJECT_DIR}/src/other/file.ts`,
            options: [{ fix: false }],
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
        };

        ruleTester.run('no-barrel-bypass fixture cache run 1', rule, {
            valid: [],
            invalid: [scenario],
        });
        ruleTester.run('no-barrel-bypass fixture cache run 2', rule, {
            valid: [],
            invalid: [scenario],
        });
    });
});
