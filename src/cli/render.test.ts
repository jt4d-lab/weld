import { describe, expect, it } from 'vitest';

import type { ConfigData } from './config.js';
import { configJson } from './config.js';
import type { InspectData } from './inspect.js';
import { plain } from './program.testing.js';
import { renderConfig, renderInspect, renderJson, sanitizeText } from './render.js';

const INSPECT: InspectData = {
    file: '/repo/src/feature/internal.ts',
    alias: '@/feature/internal.ts',
    module: '@root',
    layer: '@unknown',
    innerPath: 'feature/internal.ts',
};

const CONFIG: ConfigData = {
    file: '/repo/src/feature/index.ts',
    configFile: 'eslint.config.mjs',
    settings: {
        repoRoot: { status: 'value', value: '/repo' },
        aliasesBaseUrl: { status: 'value', value: '.' },
        tsconfig: { status: 'value', value: 'tsconfig.json' },
        aliases: { status: 'value', value: [{ prefix: '@', anchor: '/src', star: true }] },
        srcDir: { status: 'value', value: '/src' },
        modulesDir: { status: 'value', value: 'modules' },
        layers: { status: 'value', value: ['app', '@modules', '@unknown'] },
        moduleLayers: { status: 'value', value: ['features'] },
        flatModules: { status: 'value', value: false },
    },
    sectionError: null,
};

describe('sanitizeText', () => {
    it('заменяет управляющие символы на `?`, включая DEL', () => {
        expect(sanitizeText('ab\x01cd\x1b[31mef\u007f')).toBe('ab?cd?[31mef?');
    });
});

describe('renderInspect', () => {
    it('печатает путь файла, путь импорта и метаданные, выровненные по подписям', () => {
        expect(renderInspect(INSPECT, { color: false })).toBe(
            [
                'file:      /repo/src/feature/internal.ts',
                'alias:     @/feature/internal.ts',
                'module:    @root',
                'layer:     @unknown',
                'innerPath: feature/internal.ts',
            ].join('\n'),
        );
    });

    it('без алиаса печатает то, что подставила команда — виртуальный путь', () => {
        const output = renderInspect(
            { ...INSPECT, alias: '/src/feature/internal.ts' },
            { color: false },
        );

        expect(output).toContain('alias:     /src/feature/internal.ts');
    });

    it('color: false дает текст без escape-последовательностей', () => {
        const output = renderInspect(INSPECT, { color: false });

        expect(plain(output)).toBe(output);
    });

    it('color: true добавляет цвет, не меняя текст', () => {
        const colored = renderInspect(INSPECT, { color: true });

        expect(plain(colored)).not.toBe(colored);
        expect(plain(colored)).toBe(renderInspect(INSPECT, { color: false }));
    });
});

describe('renderConfig: файл', () => {
    it('печатает конфиг, настройки и схему слоев после них', () => {
        expect(renderConfig(CONFIG, { color: false })).toBe(
            [
                'file:   /repo/src/feature/index.ts',
                'config: eslint.config.mjs',
                'settings.weld:',
                '  repoRoot:       /repo',
                '  aliasesBaseUrl: .',
                '  tsconfig:       tsconfig.json',
                '  aliases:',
                '    @/* → /src/*',
                '  srcDir:         /src',
                '  modulesDir:     modules',
                '  layers:         app, @modules, @unknown',
                '  moduleLayers:   features',
                '  flatModules:    false',
            ].join('\n'),
        );
    });

    it('ширина колонки подписей считается по строкам своей команды', () => {
        const configLine = renderConfig(CONFIG, { color: false }).split('\n')[0];
        const inspectLine = renderInspect(INSPECT, { color: false }).split('\n')[0];

        expect(configLine).toBe('file:   /repo/src/feature/index.ts');
        expect(inspectLine).toBe('file:      /repo/src/feature/internal.ts');
    });

    it('конфиг вне корня печатается абсолютным путем', () => {
        const output = renderConfig(
            { ...CONFIG, configFile: '/elsewhere/eslint.config.mjs' },
            { color: false },
        );

        expect(output.split('\n')[1]).toBe('config: /elsewhere/eslint.config.mjs');
    });

    it('пустые алиасы — явное (none) в строке подписи', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                settings: { ...CONFIG.settings, aliases: { status: 'value', value: [] } },
            },
            { color: false },
        );

        expect(output).toContain('\n  aliases:        (none)');
    });

    it('точный ключ печатается без хвоста /* с обеих сторон', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                settings: {
                    ...CONFIG.settings,
                    aliases: {
                        status: 'value',
                        value: [
                            { prefix: '@/config', anchor: '/src/config', star: false },
                            { prefix: '@', anchor: '/src', star: true },
                        ],
                    },
                },
            },
            { color: false },
        );

        expect(output.split('\n').slice(-7, -5)).toEqual([
            '    @/config → /src/config',
            '    @/* → /src/*',
        ]);
    });

    it('несколько алиасов печатаются каждый на своей строке', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                settings: {
                    ...CONFIG.settings,
                    aliases: {
                        status: 'value',
                        value: [
                            { prefix: '@', anchor: '/src', star: true },
                            { prefix: '@app', anchor: '/src/app', star: true },
                        ],
                    },
                },
            },
            { color: false },
        );

        expect(output.split('\n').slice(-7, -5)).toEqual([
            '    @/* → /src/*',
            '    @app/* → /src/app/*',
        ]);
    });

    it('хвост /* не удваивается, если он частично уже есть в записи', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                settings: {
                    ...CONFIG.settings,
                    aliases: {
                        status: 'value',
                        value: [
                            { prefix: '@/', anchor: '/src/', star: true },
                            { prefix: '@app', anchor: '/src/app', star: true },
                        ],
                    },
                },
            },
            { color: false },
        );

        expect(output.split('\n').slice(-7, -5)).toEqual([
            '    @/* → /src/*',
            '    @app/* → /src/app/*',
        ]);
    });

    it('имя алиаса с управляющим символом очищается в текстовом выводе', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                settings: {
                    ...CONFIG.settings,
                    aliases: {
                        status: 'value',
                        value: [{ prefix: '@a\u0007b', anchor: '/ab', star: false }],
                    },
                },
            },
            { color: false },
        );

        expect(output).toContain('@a?b → /ab');
        expect(output).not.toContain('\u0007');
    });

    it('invalid печатается сообщением на месте настройки', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                settings: {
                    ...CONFIG.settings,
                    repoRoot: {
                        status: 'invalid',
                        message: 'settings.weld.repoRoot must be a string, got number',
                    },
                },
            },
            { color: false },
        );

        expect(output.split('\n')[3]).toBe(
            '  repoRoot:       settings.weld.repoRoot must be a string, got number',
        );
    });

    it('unresolved печатается как (unresolved: <зависимость>)', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                settings: {
                    ...CONFIG.settings,
                    aliases: { status: 'unresolved', dependency: 'repoRoot' },
                },
            },
            { color: false },
        );

        expect(output).toContain('  aliases:        (unresolved: repoRoot)');
    });

    it('not set печатается как (not set)', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                settings: {
                    ...CONFIG.settings,
                    layers: { status: 'not-set' },
                    moduleLayers: { status: 'not-set' },
                },
            },
            { color: false },
        );

        expect(output).toContain('  layers:         (not set)');
        expect(output).toContain('  moduleLayers:   (not set)');
    });

    it('flatModules печатается как true/false, ошибка — как у строковых', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                settings: { ...CONFIG.settings, flatModules: { status: 'value', value: true } },
            },
            { color: false },
        );

        expect(output).toContain('  flatModules:    true');

        const broken = renderConfig(
            {
                ...CONFIG,
                settings: {
                    ...CONFIG.settings,
                    flatModules: {
                        status: 'invalid',
                        message: 'settings.weld.flatModules must be a boolean, got string',
                    },
                },
            },
            { color: false },
        );

        expect(broken).toContain(
            '  flatModules:    settings.weld.flatModules must be a boolean, got string',
        );
    });

    it('ошибка секции печатается один раз на строке settings.weld', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                sectionError: 'settings.weld must be an object',
                settings: {
                    ...CONFIG.settings,
                    repoRoot: { status: 'unresolved', dependency: 'settings.weld' },
                },
            },
            { color: false },
        );

        const sectionLines = output.split('\n').filter((line) => line.includes('settings.weld:'));
        expect(sectionLines).toEqual(['settings.weld: settings.weld must be an object']);
    });

    it('color: false дает текст без escape-последовательностей', () => {
        const output = renderConfig(CONFIG, { color: false });

        expect(plain(output)).toBe(output);
    });

    it('цвет: invalid — красный, unresolved — желтый, не меняя текст', () => {
        const data: ConfigData = {
            ...CONFIG,
            settings: {
                ...CONFIG.settings,
                repoRoot: { status: 'invalid', message: 'broken root' },
                aliases: { status: 'unresolved', dependency: 'repoRoot' },
            },
        };
        const colored = renderConfig(data, { color: true });

        expect(plain(colored)).not.toBe(colored);
        expect(plain(colored)).toBe(renderConfig(data, { color: false }));
        expect(colored).toContain('broken root');
        expect(colored).toContain('(unresolved: repoRoot)');
    });
});

describe('renderConfig: директория', () => {
    it('показывает сэмпл и аргумент директории в том виде, как его ввели', () => {
        const output = renderConfig({ ...CONFIG, sampleOf: 'src/feature' }, { color: false });

        expect(output.split('\n')[0]).toBe(
            'file:   /repo/src/feature/index.ts (sample of src/feature)',
        );
    });

    it('пометка сэмпла приглушенная, путь файла — нет', () => {
        const colored = renderConfig({ ...CONFIG, sampleOf: 'src/feature' }, { color: true });

        expect(plain(colored)).not.toBe(colored);
        expect(plain(colored)).toBe(
            renderConfig({ ...CONFIG, sampleOf: 'src/feature' }, { color: false }),
        );
    });
});

describe('renderJson / configJson', () => {
    it('inspect с алиасом', () => {
        expect(renderJson(INSPECT)).toBe(
            `{\n  "file": "/repo/src/feature/internal.ts",\n  "alias": "@/feature/internal.ts",\n` +
                `  "module": "@root",\n  "layer": "@unknown",\n` +
                `  "innerPath": "feature/internal.ts"\n}`,
        );
    });

    it('inspect без алиаса — alias: null', () => {
        const data = { ...INSPECT, file: '/repo/src/a.ts', alias: null, innerPath: 'a.ts' };

        expect(renderJson(data)).toBe(
            `{\n  "file": "/repo/src/a.ts",\n  "alias": null,\n  "module": "@root",\n` +
                `  "layer": "@unknown",\n  "innerPath": "a.ts"\n}`,
        );
    });

    it('config для файла без sampleOf', () => {
        const value = configJson(CONFIG);

        expect(Object.keys(value)).toEqual(['file', 'configFile', 'settings', 'problems']);
        expect(renderJson(value)).not.toContain('sampleOf');
    });

    it('config для директории: sampleOf, configFile и алиасы парами prefix/anchor', () => {
        const value = configJson({ ...CONFIG, sampleOf: 'src/feature' });

        expect(value).toEqual({
            file: '/repo/src/feature/index.ts',
            configFile: 'eslint.config.mjs',
            sampleOf: 'src/feature',
            settings: {
                repoRoot: '/repo',
                aliasesBaseUrl: '.',
                tsconfig: 'tsconfig.json',
                aliases: [{ prefix: '@', anchor: '/src', star: true }],
                srcDir: '/src',
                modulesDir: 'modules',
                layers: ['app', '@modules', '@unknown'],
                moduleLayers: ['features'],
                flatModules: false,
            },
            problems: {},
        });
    });

    it('недоступные значения — null, проблемы — в объекте problems', () => {
        const data: ConfigData = {
            ...CONFIG,
            file: '/abs/repo/src/a.ts',
            configFile: '/abs/repo/eslint.config.mjs',
            settings: {
                ...CONFIG.settings,
                repoRoot: {
                    status: 'invalid',
                    message: 'settings.weld.repoRoot must be a string, got number',
                },
                aliases: { status: 'unresolved', dependency: 'repoRoot' },
                layers: { status: 'not-set' },
            },
        };

        const value = configJson(data) as {
            settings: Record<string, unknown>;
            problems: Record<string, unknown>;
        };

        expect(value.settings.repoRoot).toBeNull();
        expect(value.settings.aliases).toBeNull();
        expect(value.settings.layers).toBeNull();
        expect(value.settings.tsconfig).toBe('tsconfig.json');
        expect(value.problems).toEqual({
            repoRoot: {
                status: 'invalid',
                message: 'settings.weld.repoRoot must be a string, got number',
            },
            aliases: { status: 'unresolved', dependency: 'repoRoot' },
        });
    });

    it('ошибка секции — запись settings.weld в problems', () => {
        const value = configJson({
            ...CONFIG,
            sectionError: 'settings.weld must be an object',
        }) as {
            problems: Record<string, unknown>;
        };

        expect(value.problems['settings.weld']).toEqual({
            status: 'invalid',
            message: 'settings.weld must be an object',
        });
    });

    it('not set — null в settings и без записи в problems', () => {
        const data: ConfigData = {
            ...CONFIG,
            settings: { ...CONFIG.settings, layers: { status: 'not-set' } },
        };

        const value = configJson(data) as {
            settings: Record<string, unknown>;
            problems: Record<string, unknown>;
        };

        expect(value.settings.layers).toBeNull();
        expect('layers' in value.problems).toBe(false);
        expect(Object.keys(value.problems)).toEqual([]);
    });

    it('имя алиаса с управляющим символом: JSON валиден и сохраняет значение', () => {
        const data: ConfigData = {
            ...CONFIG,
            settings: {
                ...CONFIG.settings,
                aliases: {
                    status: 'value',
                    value: [{ prefix: '@a\u0007b', anchor: '/ab', star: false }],
                },
            },
        };

        const raw = renderJson(configJson(data));
        const parsed = JSON.parse(raw) as {
            settings: { aliases: { prefix: string }[] };
        };

        expect(parsed.settings.aliases[0]!.prefix).toBe('@a\u0007b');
        expect(raw).not.toContain('\u0007');
    });
});
