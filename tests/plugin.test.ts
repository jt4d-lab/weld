import { readFileSync } from 'node:fs';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import plugin, { configs, meta, rules } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    name: string;
};

describe('метаданные плагина', () => {
    it('имя совпадает с именем пакета', () => {
        expect(meta.name).toBe(pkg.name);
    });

    it('версия проставлена', () => {
        expect(meta.version).toMatch(/^\d+\.\d+\.\d+/);
    });
});

describe('реестр правил', () => {
    it('каждое правило описано и снабжено сообщениями', () => {
        // Пока реестр пуст, но инвариант должен выполняться для любого правила,
        // которое в него добавят.
        for (const [name, rule] of Object.entries(rules as Record<string, unknown>)) {
            const { meta: ruleMeta } = rule as { meta?: Record<string, unknown> };

            expect(ruleMeta, `${name}: нет meta`).toBeDefined();
            expect(ruleMeta?.docs, `${name}: нет meta.docs`).toBeDefined();
            expect(ruleMeta?.messages, `${name}: нет meta.messages`).toBeDefined();
        }
    });
});

describe('конфиг recommended', () => {
    it('регистрирует плагин под префиксом weld', () => {
        expect(configs.recommended?.plugins?.weld).toBe(plugin);
    });

    it('включает только существующие правила', () => {
        const enabled = Object.keys(configs.recommended?.rules ?? {});

        for (const ruleId of enabled) {
            expect(ruleId.startsWith('weld/')).toBe(true);
            expect(Object.keys(rules)).toContain(ruleId.slice('weld/'.length));
        }
    });
});

describe('подключение к ESLint', () => {
    const lint = async (code: string) => {
        const eslint = new ESLint({
            overrideConfigFile: true,
            overrideConfig: [configs.recommended as never],
        });

        return eslint.lintText(code, { filePath: 'example.js' });
    };

    it('ESLint принимает конфиг и линтует файл без внутренних ошибок', async () => {
        const [result] = await lint('import { a } from "./a.js";\nexport const b = a;\n');

        expect(result?.fatalErrorCount ?? 0).toBe(0);
        expect(result?.messages ?? []).toEqual([]);
    });

    it('плагин виден в вычисленном конфиге файла', async () => {
        const eslint = new ESLint({
            overrideConfigFile: true,
            overrideConfig: [configs.recommended as never],
        });

        const config = (await eslint.calculateConfigForFile('example.js')) as {
            plugins?: string[] | Record<string, unknown>;
        };
        const plugins = Array.isArray(config.plugins)
            ? config.plugins
            : Object.keys(config.plugins ?? {});

        expect(plugins).toContain('weld');
    });
});
