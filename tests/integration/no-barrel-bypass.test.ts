import { fileURLToPath } from 'node:url';

import { Linter } from 'eslint';
import type { Linter as LinterTypes } from 'eslint';
import { describe, expect, it } from 'vitest';

import { createEntryPointEnv } from '../../src/env/entry-point.js';
import { createRule } from '../../src/rules/no-barrel-bypass/index.js';

/**
 * Интеграционные тесты на реальной фикстуре `tests/fixtures/project/`: в отличие от
 * `tests/rules/no-barrel-bypass/rule.test.ts` (фейковый `env` над `Set`), здесь используется
 * настоящий `createEntryPointEnv` — так покрыт реальный `existsSync` и его TTL-кэш, а не
 * обойдён моком.
 */

const projectRoot = fileURLToPath(new URL('../fixtures/project/', import.meta.url));
const otherFile = `${projectRoot}src/other/file.ts`;

const languageOptions = {
    ecmaVersion: 2022 as const,
    sourceType: 'module' as const,
};

function lint(
    code: string,
    options: { settings?: Record<string, unknown> } = {},
): ReturnType<Linter['verify']> {
    // свой createEntryPointEnv() на тест — TTL-кэш не должен делиться между тестами, см. план
    const env = createEntryPointEnv();
    const rule = createRule(env);
    const linter = new Linter({ cwd: projectRoot });

    return linter.verify(
        code,
        [
            {
                files: ['**/*.ts'],
                languageOptions,
                ...(options.settings !== undefined ? { settings: options.settings } : {}),
                plugins: { test: { rules: { 'no-barrel-bypass': rule } } },
                rules: { 'test/no-barrel-bypass': 'error' },
            },
        ],
        { filename: otherFile },
    );
}

describe('интеграция: no-barrel-bypass на реальной фикстуре', () => {
    it('находит нарушение по относительному импорту внутрь границы фикстуры', () => {
        const messages = lint("import { a } from '../feature/internal/thing.js';");

        expect(messages).toHaveLength(1);
        expect(messages[0]?.messageId).toBe('bypass');
        expect(messages[0]?.suggestions?.[0]?.fix.text).toBe("'../feature'");
    });

    it('с settings.weld.aliases, указывающими в фикстуру, исправленный путь приходит с алиасом', () => {
        const messages = lint("import { a } from '@feature/internal/thing.js';", {
            settings: {
                weld: {
                    baseUrl: `${projectRoot}src`,
                    aliases: { '@feature': ['feature'] },
                },
            },
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]?.suggestions?.[0]?.fix.text).toBe("'@feature'");
    });

    it('повторный прогон по той же границе даёт стабильный результат при попадании в кэш', () => {
        const env = createEntryPointEnv();
        const rule = createRule(env);
        const linter = new Linter({ cwd: projectRoot });
        const code = "import { a } from '../feature/internal/thing.js';";
        const config: LinterTypes.Config[] = [
            {
                files: ['**/*.ts'],
                languageOptions,
                plugins: { test: { rules: { 'no-barrel-bypass': rule } } },
                rules: { 'test/no-barrel-bypass': 'error' },
            },
        ];

        const first = linter.verify(code, config, { filename: otherFile });
        const second = linter.verify(code, config, { filename: otherFile });

        expect(second).toEqual(first);
        expect(second).toHaveLength(1);
    });
});
