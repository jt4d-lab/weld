/**
 * Опции правила `root` / `baseUrl` / `aliases` — те же настройки, что и в `settings.weld`, но
 * заданные на самом правиле. Здесь проверяется, что они действительно перекрывают секцию.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeFsHost, resetFsHostCaches } from '@/host/index.js';

import { createRule } from '@/rules/no-barrel-bypass/index.js';
import { consumerFile, createRuleTester, fixtureRoot } from '@/testing/index.js';

const ruleTester = createRuleTester();

const rule = createRule(createFakeFsHost(['/repo/src/other/index.ts']));

const aliasError = {
    messageId: 'bypass',
    data: { suggestion: '@other/index.ts', original: '@other/internal.ts' },
};

describe('опции правила перекрывают settings.weld', () => {
    it('options.aliases выигрывает у settings.weld.aliases', () => {
        ruleTester.run('no-barrel-bypass options.aliases', rule, {
            valid: [],
            invalid: [
                {
                    name: 'алиас из опций указывает на настоящую директорию, из settings — в никуда',
                    code: "import { a } from '@other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    settings: {
                        weld: { baseUrl: '/repo', aliases: { '@other/*': ['nowhere/*'] } },
                    },
                    options: [{ aliases: { '@other/*': ['src/other/*'] } }],
                    output: "import { a } from '@other/index.ts';",
                    errors: [aliasError],
                },
            ],
        });
    });

    it('options.baseUrl переносит якоря алиасов из settings.weld', () => {
        ruleTester.run('no-barrel-bypass options.baseUrl', rule, {
            valid: [],
            invalid: [
                {
                    name: 'алиасы из settings, якорь считается от baseUrl из опций',
                    code: "import { a } from '@other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    settings: {
                        weld: { baseUrl: '/nowhere', aliases: { '@other/*': ['src/other/*'] } },
                    },
                    options: [{ baseUrl: '/repo' }],
                    output: "import { a } from '@other/index.ts';",
                    errors: [aliasError],
                },
            ],
        });
    });

    it('пара options.aliases + options.baseUrl работает вместе', () => {
        ruleTester.run('no-barrel-bypass options.aliases+baseUrl', rule, {
            valid: [],
            invalid: [
                {
                    name: 'обе настройки заданы только опциями, settings.weld ведёт в никуда',
                    code: "import { a } from '@other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    settings: {
                        weld: { baseUrl: '/nowhere', aliases: { '@other/*': ['nowhere/*'] } },
                    },
                    options: [{ baseUrl: '/repo', aliases: { '@other/*': ['src/other/*'] } }],
                    output: "import { a } from '@other/index.ts';",
                    errors: [aliasError],
                },
            ],
        });
    });

    it('значение опции неверного типа отсекается схемой', () => {
        expect(() =>
            ruleTester.run('no-barrel-bypass options schema', rule, {
                valid: [
                    {
                        name: 'root не строка',
                        code: "import { a } from '../other/internal.ts';",
                        filename: '/repo/src/feature/file.ts',
                        options: [{ root: 42 }],
                    },
                ],
                invalid: [],
            }),
        ).toThrow();
    });
});

describe('опция root на настоящем диске', () => {
    afterEach(() => {
        resetFsHostCaches();
    });

    it('options.root выигрывает у settings.weld.root', () => {
        ruleTester.run('no-barrel-bypass options.root', createRule(), {
            valid: [],
            invalid: [
                {
                    name: 'root фикстуры задан опцией, в settings.weld — несуществующая директория',
                    code: "import { a } from './feature/internal.ts';",
                    filename: consumerFile,
                    settings: { weld: { root: '/nowhere' } },
                    options: [{ root: fixtureRoot }],
                    output: "import { a } from './feature/index.ts';",
                    errors: [
                        {
                            messageId: 'bypass',
                            data: {
                                suggestion: './feature/index.ts',
                                original: './feature/internal.ts',
                            },
                        },
                    ],
                },
            ],
        });
    });
});
