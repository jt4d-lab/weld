/**
 * Опции правила `repoRoot` / `aliasesBaseUrl` / `aliases` / `tsconfig` и поля схемы слоев — те же
 * настройки, что и в `settings.weld`, но заданные на самом правиле.
 *
 * Здесь проверяется, что они действительно перекрывают секцию, а схема слоев разбирается только по
 * запросу.
 */

import type { Rule } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeFsHost, resetFsHostCaches } from '@/repo-fs/index.js';

import { WELD_OPTION_PROPERTIES, resolveWeldContext } from '@/rules/context.js';
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
                        weld: { aliasesBaseUrl: '/repo', aliases: { '@other/*': ['nowhere/*'] } },
                    },
                    options: [{ aliases: { '@other/*': ['src/other/*'] } }],
                    output: "import { a } from '@other/index.ts';",
                    errors: [aliasError],
                },
            ],
        });
    });

    it('options.aliasesBaseUrl переносит якоря алиасов из settings.weld', () => {
        ruleTester.run('no-barrel-bypass options.aliasesBaseUrl', rule, {
            valid: [],
            invalid: [
                {
                    name: 'алиасы из settings, якорь считается от aliasesBaseUrl из опций',
                    code: "import { a } from '@other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    settings: {
                        weld: {
                            aliasesBaseUrl: '/nowhere',
                            aliases: { '@other/*': ['src/other/*'] },
                        },
                    },
                    options: [{ aliasesBaseUrl: '/repo' }],
                    output: "import { a } from '@other/index.ts';",
                    errors: [aliasError],
                },
            ],
        });
    });

    it('пара options.aliases + options.aliasesBaseUrl работает вместе', () => {
        ruleTester.run('no-barrel-bypass options.aliases+aliasesBaseUrl', rule, {
            valid: [],
            invalid: [
                {
                    name: 'обе настройки заданы только опциями, settings.weld ведет в никуда',
                    code: "import { a } from '@other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    settings: {
                        weld: {
                            aliasesBaseUrl: '/nowhere',
                            aliases: { '@other/*': ['nowhere/*'] },
                        },
                    },
                    options: [
                        { aliasesBaseUrl: '/repo', aliases: { '@other/*': ['src/other/*'] } },
                    ],
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
                        name: 'repoRoot не строка',
                        code: "import { a } from '../other/internal.ts';",
                        filename: '/repo/src/feature/file.ts',
                        options: [{ repoRoot: 42 }],
                    },
                ],
                invalid: [],
            }),
        ).toThrow();
    });
});

/**
 * Правило-заглушка: ничего не проверяет, а только просит схему слоев.
 *
 * Ею проверяется, что схема разбирается именно по запросу, а не до вызова правила.
 */
function createSchemeProbe(): Rule.RuleModule {
    return {
        meta: {
            schema: [{ type: 'object', properties: WELD_OPTION_PROPERTIES }],
        },
        create(context) {
            resolveWeldContext(context, createFakeFsHost([]))?.getScheme();
            return {};
        },
    };
}

describe('схема слоев в опциях: настоящий ESLint', () => {
    const schemeSettings = { weld: { layers: ['app', '@modules'], moduleLayers: ['features'] } };

    it('произвольные значения полей схемы проходят схему ESLint и не мешают правилу', () => {
        ruleTester.run('no-barrel-bypass broken scheme', rule, {
            valid: [],
            invalid: [
                {
                    name: 'схема в опциях сломана, а правило продолжает работать',
                    code: "import { a } from '@other/internal.ts';",
                    filename: '/repo/src/feature/file.ts',
                    settings: {
                        weld: { aliasesBaseUrl: '/repo', aliases: { '@other/*': ['src/other/*'] } },
                    },
                    options: [{ layers: 'nope', srcDir: 42 }],
                    output: "import { a } from '@other/index.ts';",
                    errors: [aliasError],
                },
            ],
        });
    });

    it('правило, спросившее схему, получает исключение разбора в том же прогоне', () => {
        expect(() =>
            ruleTester.run('scheme probe broken', createSchemeProbe(), {
                valid: [
                    {
                        name: 'сломанные поля схемы в опциях',
                        code: 'const a = 1;',
                        filename: '/repo/src/feature/file.ts',
                        settings: schemeSettings,
                        options: [{ layers: 'nope' }],
                    },
                ],
                invalid: [],
            }),
        ).toThrow('options.layers must be an array of strings, got string');
    });

    it('корректная схема разбирается без исключения', () => {
        expect(() =>
            ruleTester.run('scheme probe valid', createSchemeProbe(), {
                valid: [
                    {
                        name: 'полная схема в настройках и опциях',
                        code: 'const a = 1;',
                        filename: '/repo/src/feature/file.ts',
                        settings: schemeSettings,
                        options: [{ srcDir: 'source' }],
                    },
                ],
                invalid: [],
            }),
        ).not.toThrow();
    });
});

describe('опция repoRoot на настоящем диске', () => {
    afterEach(() => {
        resetFsHostCaches();
    });

    it('options.repoRoot выигрывает у settings.weld.repoRoot', () => {
        ruleTester.run('no-barrel-bypass options.repoRoot', createRule(), {
            valid: [],
            invalid: [
                {
                    name: 'repoRoot фикстуры задан опцией, в settings.weld — несуществующая директория',
                    code: "import { a } from './feature/internal.ts';",
                    filename: consumerFile,
                    settings: { weld: { repoRoot: '/nowhere' } },
                    options: [{ repoRoot: fixtureRoot }],
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
