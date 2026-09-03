import { readFileSync } from 'node:fs';

import { ESLint } from 'eslint';
import type { Rule } from 'eslint';
import { describe, expect, it } from 'vitest';

import plugin from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    name: string;
    version: string;
};

describe('метаданные плагина', () => {
    it('совпадают с package.json', () => {
        expect(plugin.meta).toEqual({ name: pkg.name, version: pkg.version });
    });
});

describe('реестр правил', () => {
    it('не пуст', () => {
        expect(Object.keys(plugin.rules).length).toBeGreaterThan(0);
    });

    it('каждое правило описано и снабжено сообщениями', () => {
        for (const [name, rule] of Object.entries<Rule.RuleModule>(plugin.rules)) {
            expect(rule.meta, `${name}: нет meta`).toBeDefined();
            expect(rule.meta?.docs, `${name}: нет meta.docs`).toBeDefined();
            expect(rule.meta?.messages, `${name}: нет meta.messages`).toBeDefined();
        }
    });
});

describe('конфиг recommended', () => {
    const { recommended } = plugin.configs;

    it('регистрирует плагин под префиксом weld', () => {
        expect(recommended.plugins?.weld).toBe(plugin);
    });

    it('включает только существующие правила', () => {
        for (const ruleId of Object.keys(recommended.rules ?? {})) {
            expect(ruleId.startsWith('weld/')).toBe(true);
            expect(Object.keys(plugin.rules)).toContain(ruleId.slice('weld/'.length));
        }
    });

    it('включает no-barrel-bypass', () => {
        expect(recommended.rules?.['weld/no-barrel-bypass']).toBe('error');
    });
});

describe('подключение к ESLint', () => {
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [plugin.configs.recommended],
    });

    it('ESLint принимает конфиг и линтует файл без внутренних ошибок', async () => {
        const [result] = await eslint.lintText(
            'import { a } from "./a.js";\nexport const b = a;\n',
            { filePath: 'example.js' },
        );

        expect(result?.fatalErrorCount ?? 0).toBe(0);
        expect(result?.messages ?? []).toEqual([]);
    });

    it('плагин виден в вычисленном конфиге файла', async () => {
        const config = (await eslint.calculateConfigForFile('example.js')) as {
            plugins?: string[] | Record<string, unknown>;
        };
        const plugins = Array.isArray(config.plugins)
            ? config.plugins
            : Object.keys(config.plugins ?? {});

        expect(plugins).toContain('weld');
    });
});
