/**
 * Интеграционные тесты: единственное место с настоящим диском. Проверяют реальные `createFsHost` /
 * `getFsHost` / `findRepoRoot` поверх фикстуры `src/testing/fixtures/project`, а не их фейки.
 */

import { existsSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { findRepoRoot, getFsHost, resetFsHostCaches } from '@/host/index.js';

import { createRule } from '@/rules/no-barrel-bypass/index.js';
import { consumerFile, createRuleTester, fixtureRoot, repoRoot } from '@/testing/index.js';

const ruleTester = createRuleTester();

describe('weld/no-barrel-bypass: интеграционные тесты на реальной фикстуре', () => {
    afterEach(() => {
        resetFsHostCaches();
    });

    it('настоящий createFsHost (root фикстуры через settings.weld.root) находит нарушение по относительному импорту', () => {
        const rule = createRule();

        ruleTester.run('no-barrel-bypass integration relative', rule, {
            valid: [],
            invalid: [
                {
                    name: 'относительный импорт мимо барьера фикстуры',
                    code: "import { a } from './feature/internal.ts';",
                    filename: consumerFile,
                    settings: { weld: { root: fixtureRoot } },
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

    it('settings.weld.aliases на настоящем FsHost → правка приходит в форме алиаса', () => {
        const rule = createRule();

        ruleTester.run('no-barrel-bypass integration alias', rule, {
            valid: [],
            invalid: [
                {
                    name: 'алиас @src/* поверх настоящего root фикстуры',
                    code: "import { a } from '@src/feature/internal.ts';",
                    filename: consumerFile,
                    settings: {
                        weld: {
                            root: fixtureRoot,
                            baseUrl: '/',
                            aliases: { '@src/*': ['src/*'] },
                        },
                    },
                    output: "import { a } from '@src/feature/index.ts';",
                    errors: [
                        {
                            messageId: 'bypass',
                            data: {
                                suggestion: '@src/feature/index.ts',
                                original: '@src/feature/internal.ts',
                            },
                        },
                    ],
                },
            ],
        });
    });

    it('повторный прогон на том же входе стабилен и переиспользует инстанс/кэш FsHost в пределах TTL', () => {
        const rule = createRule();
        const settings = { weld: { root: fixtureRoot } };

        const runOnce = (): void =>
            ruleTester.run('no-barrel-bypass integration repeat', rule, {
                valid: [],
                invalid: [
                    {
                        name: 'повторный прогон',
                        code: "import { a } from './feature/internal.ts';",
                        filename: consumerFile,
                        settings,
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

        const fsHostBefore = getFsHost(settings, fixtureRoot);
        runOnce();
        runOnce();
        const fsHostAfter = getFsHost(settings, fixtureRoot);

        expect(fsHostAfter).toBe(fsHostBefore);
    });

    it('настоящий findRepoRoot от директории фикстуры находит корень этого репозитория', () => {
        const foundRoot = findRepoRoot(fixtureRoot, existsSync);

        expect(foundRoot).toBe(repoRoot);
    });

    it('getFsHost без явного settings.weld.root авто-находит корень репозитория и резолвит виртуальные пути от него', () => {
        const fsHost = getFsHost(undefined, fixtureRoot);

        expect(fsHost.toVirtual(`${repoRoot}/package.json`)).toBe('/package.json');
    });
});
