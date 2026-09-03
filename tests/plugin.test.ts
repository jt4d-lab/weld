import { readFileSync } from 'node:fs';

import { ESLint } from 'eslint';
import type { Rule } from 'eslint';
import { describe, expect, it } from 'vitest';

import plugin from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    name: string;
    version: string;
};

describe('plugin metadata', () => {
    it('matches package.json', () => {
        expect(plugin.meta).toEqual({ name: pkg.name, version: pkg.version });
    });
});

describe('rule registry', () => {
    it('every rule has documentation and messages', () => {
        for (const [name, rule] of Object.entries<Rule.RuleModule>(plugin.rules)) {
            expect(rule.meta, `${name}: missing meta`).toBeDefined();
            expect(rule.meta?.docs, `${name}: missing meta.docs`).toBeDefined();
            expect(rule.meta?.messages, `${name}: missing meta.messages`).toBeDefined();
        }
    });
});

describe('rule configs', () => {
    it('exports the recommended and strict configs', () => {
        expect(plugin.configs?.recommended).toBeDefined();
        expect(plugin.configs?.strict).toBeDefined();
    });

    for (const [name, config] of Object.entries(plugin.configs ?? {})) {
        describe(name, () => {
            it('registers the plugin under the weld namespace', () => {
                expect(config.plugins?.weld).toBe(plugin);
            });

            it('only enables existing rules', () => {
                for (const ruleId of Object.keys(config.rules ?? {})) {
                    expect(ruleId.startsWith('weld/')).toBe(true);
                    expect(Object.keys(plugin.rules)).toContain(ruleId.slice('weld/'.length));
                }
            });
        });
    }
});

describe('ESLint integration', () => {
    for (const name of ['recommended', 'strict'] as const) {
        describe(name, () => {
            const eslint = new ESLint({
                overrideConfigFile: true,
                overrideConfig: [plugin.configs[name]],
            });

            it('ESLint accepts the config and lints a file without internal errors', async () => {
                const [result] = await eslint.lintText(
                    'import { a } from "./a.js";\nexport const b = a;\n',
                    { filePath: 'example.js' },
                );

                expect(result?.fatalErrorCount ?? 0).toBe(0);
                expect(result?.messages ?? []).toEqual([]);
            });

            it('the plugin is present in the file config', async () => {
                const config = (await eslint.calculateConfigForFile('example.js')) as {
                    plugins?: string[] | Record<string, unknown>;
                };
                const plugins = Array.isArray(config.plugins)
                    ? config.plugins
                    : Object.keys(config.plugins ?? {});

                expect(plugins).toContain('weld');
            });
        });
    }
});
