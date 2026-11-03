import { afterEach, describe, expect, it } from 'vitest';

import type { SettingState } from '@/settings/index.js';
import { cleanupTmpProjects } from '@/testing/index.js';

import { hasOwnError } from './config.js';
import type { ConfigData } from './config.js';
import {
    ALIAS_CONFIG,
    OUTSIDE_ROOT_CONFIG,
    capture,
    makeCliProject,
    printed,
} from './program.testing.js';

/** Тот же проект без алиасов в `settings.weld`: алиасы ищутся в tsconfig. */
const TSCONFIG_AUTODETECT_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: {} },
    },
];
`;

const RULE_OPTIONS_CONFIG = `const weld = {
    rules: {
        'no-barrel-bypass': { meta: { schema: [{ type: 'object' }] }, create: () => ({}) },
    },
};

export default [
    {
        files: ['**/*.ts'],
        plugins: { weld },
        rules: {
            'weld/no-barrel-bypass': [
                'error',
                { aliases: { '@/*': ['src/*'] }, tsconfig: 'tsconfig.custom.json' },
            ],
        },
    },
];
`;

/**
 * Опции правила с кривой схемой: `weld config` больше не игнорирует схему, а показывает
 * собственные ошибки полей в отчете и возвращает код 1.
 */
const BROKEN_SCHEME_OPTIONS_CONFIG = `const weld = {
    rules: {
        'no-barrel-bypass': { meta: { schema: [{ type: 'object' }] }, create: () => ({}) },
    },
};

export default [
    {
        files: ['**/*.ts'],
        plugins: { weld },
        rules: {
            'weld/no-barrel-bypass': [
                'error',
                { aliases: { '@/*': ['src/*'] }, layers: 'nope', srcDir: 42 },
            ],
        },
    },
];
`;

/** Кривой `repoRoot` в секции: корень не вычисляется, авто-алиасы не могут быть получены. */
const BAD_REPO_ROOT_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { repoRoot: 42 } },
    },
];
`;

/** Невалидная секция `settings.weld` вовсе: одна проблема секции, все ее настройки — unresolved. */
const BAD_SECTION_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: 'nope' },
    },
];
`;

/** Несколько независимых собственных ошибок в одном отчете. */
const MULTI_PROBLEM_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: {
            weld: {
                repoRoot: 42,
                tsconfig: 42,
                aliases: { '@a': 42 },
                layers: 'nope',
            },
        },
    },
];
`;

/** Валидная секция без схемы: `weld config` печатает `(not set)` и дает код 0. */
const NO_SCHEME_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@/*': ['src/*'] } } },
    },
];
`;

/**
 * Имя алиаса с управляющим символом: в файле конфига — JS-экранирование, после загрузки —
 * реальный символ `\\u0007` внутри ключа.
 */
const CONTROL_ALIAS_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@a\\u0007/*': ['a/*'] } } },
    },
];
`;

/** Валидная секция с `flatModules`: отчет печатает значение и дает код 0. */
const FLAT_MODULES_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@/*': ['src/*'] }, flatModules: true } },
    },
];
`;

/** Кривой `flatModules`: собственная ошибка поля, код 1. */
const BAD_FLAT_MODULES_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@/*': ['src/*'] }, flatModules: 'nope' } },
    },
];
`;

afterEach(() => {
    cleanupTmpProjects();
});

describe('weld config: файл', () => {
    it('печатает корень, базу алиасов, имя tsconfig, алиасы и схему, код 0', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [
                'file:   src/feature/internal.ts',
                'config: eslint.config.mjs',
                'settings.weld:',
                `  repoRoot:       ${root}`,
                '  aliasesBaseUrl: .',
                '  tsconfig:       tsconfig.json',
                '  aliases:',
                '    @/* → /src/*',
                '  srcDir:         /src',
                '  modulesDir:     modules',
                '  layers:         app, @modules, @unknown',
                '  moduleLayers:   features',
                '  flatModules:    false',
            ].join('\n') + '\n',
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('алиасы из tsconfig: автопоиск включается, когда в settings.weld их нет', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': TSCONFIG_AUTODETECT_CONFIG,
            'tsconfig.json': JSON.stringify({
                compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } },
            }),
            'src/feature/internal.ts': '',
        });
        const { program, out, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [
                'file:   src/feature/internal.ts',
                'config: eslint.config.mjs',
                'settings.weld:',
                `  repoRoot:       ${root}`,
                '  aliasesBaseUrl: .',
                '  tsconfig:       tsconfig.json',
                '  aliases:',
                '    @/* → /src/*',
                '  srcDir:         /src',
                '  modulesDir:     modules',
                '  layers:         (not set)',
                '  moduleLayers:   (not set)',
                '  flatModules:    false',
            ].join('\n') + '\n',
        );
        expect(codes).toEqual([]);
    });

    it('опции правила из конфига перекрывают settings.weld, как и при линте', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': RULE_OPTIONS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [
                'file:   src/feature/internal.ts',
                'config: eslint.config.mjs',
                'settings.weld:',
                `  repoRoot:       ${root}`,
                '  aliasesBaseUrl: .',
                '  tsconfig:       tsconfig.custom.json',
                '  aliases:',
                '    @/* → /src/*',
                '  srcDir:         /src',
                '  modulesDir:     modules',
                '  layers:         (not set)',
                '  moduleLayers:   (not set)',
                '  flatModules:    false',
            ].join('\n') + '\n',
        );
        expect(codes).toEqual([]);
    });
});

describe('weld config: схема в отчете', () => {
    it('кривые опции схемы: собственные ошибки полей, код 1, алиасы при этом валидны', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': BROKEN_SCHEME_OPTIONS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [
                'file:   src/feature/internal.ts',
                'config: eslint.config.mjs',
                'settings.weld:',
                `  repoRoot:       ${root}`,
                '  aliasesBaseUrl: .',
                '  tsconfig:       tsconfig.json',
                '  aliases:',
                '    @/* → /src/*',
                '  srcDir:         options.srcDir must be a string, got number',
                '  modulesDir:     modules',
                '  layers:         options.layers must be an array of strings, got string',
                '  moduleLayers:   (not set)',
                '  flatModules:    false',
            ].join('\n') + '\n',
        );
        expect(codes).toEqual([1]);
    });

    it('flatModules: значение в тексте и JSON, без problems, код 0', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': FLAT_MODULES_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [
                'file:   src/feature/internal.ts',
                'config: eslint.config.mjs',
                'settings.weld:',
                `  repoRoot:       ${root}`,
                '  aliasesBaseUrl: .',
                '  tsconfig:       tsconfig.json',
                '  aliases:',
                '    @/* → /src/*',
                '  srcDir:         /src',
                '  modulesDir:     modules',
                '  layers:         (not set)',
                '  moduleLayers:   (not set)',
                '  flatModules:    true',
            ].join('\n') + '\n',
        );
        expect(codes).toEqual([]);

        const { program: jprogram, out: jout } = capture(root);
        await jprogram.parseAsync(['--json', 'config', 'src/feature/internal.ts'], {
            from: 'user',
        });

        const data = JSON.parse(printed(jout)) as {
            settings: Record<string, unknown>;
            problems: Record<string, unknown>;
        };

        expect(data.settings.flatModules).toBe(true);
        expect(data.problems).toEqual({});
    });

    it('кривой flatModules: ошибка поля в тексте и JSON, код 1', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': BAD_FLAT_MODULES_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toContain(
            '  flatModules:    settings.weld.flatModules must be a boolean, got string',
        );
        expect(codes).toEqual([1]);

        const { program: jprogram, out: jout } = capture(root);
        await jprogram.parseAsync(['--json', 'config', 'src/feature/internal.ts'], {
            from: 'user',
        });

        const data = JSON.parse(printed(jout)) as {
            settings: Record<string, unknown>;
            problems: Record<string, unknown>;
        };

        expect(data.settings.flatModules).toBeNull();
        expect(data.problems).toEqual({
            flatModules: {
                status: 'invalid',
                message: 'settings.weld.flatModules must be a boolean, got string',
            },
        });
    });
});

describe('weld config: директория', () => {
    it('показывает сэмпл директории и помечает его', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
            'src/feature/index.ts': '',
        });
        const { program, out, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature'], { from: 'user' });

        expect(printed(out)).toContain('file:   src/feature/index.ts (sample of src/feature)\n');
        expect(codes).toEqual([]);
    });

    it('--json отдает sampleOf, настройки, схему и пустые problems', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
            'src/feature/index.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['--json', 'config', 'src/feature'], { from: 'user' });

        expect(JSON.parse(printed(out))).toEqual({
            file: 'src/feature/index.ts',
            configFile: 'eslint.config.mjs',
            sampleOf: 'src/feature',
            settings: {
                repoRoot: root,
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
});

describe('weld config: --json у файла', () => {
    it('не содержит sampleOf, содержит settings и problems', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['--json', 'config', 'src/feature/internal.ts'], { from: 'user' });

        const data = JSON.parse(printed(out)) as Record<string, unknown>;
        expect(Object.keys(data)).toEqual(['file', 'configFile', 'settings', 'problems']);
        expect(data.file).toBe('src/feature/internal.ts');
        expect(data.configFile).toBe('eslint.config.mjs');
    });
});

describe('weld config: диагностический отчет', () => {
    it('кривой repoRoot: file/config абсолютные, авто-алиасы unresolved, код 1', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': BAD_REPO_ROOT_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [
                `file:   ${root}/src/feature/internal.ts`,
                `config: ${root}/eslint.config.mjs`,
                'settings.weld:',
                '  repoRoot:       settings.weld.repoRoot must be a string, got number',
                '  aliasesBaseUrl: .',
                '  tsconfig:       tsconfig.json',
                '  aliases:        (unresolved: repoRoot)',
                '  srcDir:         /src',
                '  modulesDir:     modules',
                '  layers:         (not set)',
                '  moduleLayers:   (not set)',
                '  flatModules:    false',
            ].join('\n') + '\n',
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([1]);
    });

    it('то же --json: null в settings, problems с invalid и unresolved', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': BAD_REPO_ROOT_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['--json', 'config', 'src/feature/internal.ts'], { from: 'user' });

        const data = JSON.parse(printed(out)) as {
            file: string;
            settings: Record<string, unknown>;
            problems: Record<string, { status: string; message?: string; dependency?: string }>;
        };

        expect(data.file).toBe(`${root}/src/feature/internal.ts`);
        expect(data.settings.repoRoot).toBeNull();
        expect(data.settings.aliases).toBeNull();
        expect(data.settings.tsconfig).toBe('tsconfig.json');
        expect(data.settings.srcDir).toBe('/src');
        expect(data.problems).toEqual({
            repoRoot: {
                status: 'invalid',
                message: 'settings.weld.repoRoot must be a string, got number',
            },
            aliases: { status: 'unresolved', dependency: 'repoRoot' },
        });
    });

    it('кривая секция: файл через ранний выход repoRoot, все настройки unresolved, код 1', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': BAD_SECTION_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [
                `file:   ${root}/src/feature/internal.ts`,
                `config: ${root}/eslint.config.mjs`,
                'settings.weld: settings.weld must be an object',
                '  repoRoot:       (unresolved: settings.weld)',
                '  aliasesBaseUrl: (unresolved: settings.weld)',
                '  tsconfig:       (unresolved: settings.weld)',
                '  aliases:        (unresolved: settings.weld)',
                '  srcDir:         (unresolved: settings.weld)',
                '  modulesDir:     (unresolved: settings.weld)',
                '  layers:         (unresolved: settings.weld)',
                '  moduleLayers:   (unresolved: settings.weld)',
                '  flatModules:    (unresolved: settings.weld)',
            ].join('\n') + '\n',
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([1]);

        const { program: jprogram, out: jout } = capture(root);
        await jprogram.parseAsync(['--json', 'config', 'src/feature/internal.ts'], {
            from: 'user',
        });

        const data = JSON.parse(printed(jout)) as {
            file: string;
            settings: Record<string, unknown>;
            problems: Record<string, { status: string; message?: string; dependency?: string }>;
        };

        expect(data.file).toBe(`${root}/src/feature/internal.ts`);
        expect(Object.values(data.settings)).toEqual(Array(9).fill(null));
        expect(data.problems).toEqual({
            repoRoot: { status: 'unresolved', dependency: 'settings.weld' },
            aliasesBaseUrl: { status: 'unresolved', dependency: 'settings.weld' },
            tsconfig: { status: 'unresolved', dependency: 'settings.weld' },
            aliases: { status: 'unresolved', dependency: 'settings.weld' },
            srcDir: { status: 'unresolved', dependency: 'settings.weld' },
            modulesDir: { status: 'unresolved', dependency: 'settings.weld' },
            layers: { status: 'unresolved', dependency: 'settings.weld' },
            moduleLayers: { status: 'unresolved', dependency: 'settings.weld' },
            flatModules: { status: 'unresolved', dependency: 'settings.weld' },
            'settings.weld': { status: 'invalid', message: 'settings.weld must be an object' },
        });
    });

    it('несколько независимых проблем: каждая своя, без повторения каскадной', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': MULTI_PROBLEM_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [
                `file:   ${root}/src/feature/internal.ts`,
                `config: ${root}/eslint.config.mjs`,
                'settings.weld:',
                '  repoRoot:       settings.weld.repoRoot must be a string, got number',
                '  aliasesBaseUrl: .',
                '  tsconfig:       settings.weld.tsconfig must be a string, got number',
                "  aliases:        settings.weld.aliases['@a'] must be a string or an array of strings",
                '  srcDir:         /src',
                '  modulesDir:     modules',
                '  layers:         settings.weld.layers must be an array of strings, got string',
                '  moduleLayers:   (not set)',
                '  flatModules:    false',
            ].join('\n') + '\n',
        );
        expect(codes).toEqual([1]);

        const { program: jprogram, out: jout } = capture(root, {});
        await jprogram.parseAsync(['--json', 'config', 'src/feature/internal.ts'], {
            from: 'user',
        });

        const data = JSON.parse(printed(jout)) as {
            settings: Record<string, unknown>;
            problems: Record<string, { status: string }>;
        };

        expect(data.settings.repoRoot).toBeNull();
        expect(data.settings.tsconfig).toBeNull();
        expect(data.settings.aliases).toBeNull();
        expect(data.settings.layers).toBeNull();
        expect(data.settings.srcDir).toBe('/src');
        // Четыре собственные проблемы, без дублирующего `unresolved: repoRoot` для aliases.
        expect(Object.keys(data.problems).sort()).toEqual([
            'aliases',
            'layers',
            'repoRoot',
            'tsconfig',
        ]);
        expect(data.problems.aliases).toEqual({
            status: 'invalid',
            message: "settings.weld.aliases['@a'] must be a string or an array of strings",
        });
    });

    it('отсутствующая схема: (not set), problems пуст, код 0', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': NO_SCHEME_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['--json', 'config', 'src/feature/internal.ts'], { from: 'user' });

        const data = JSON.parse(printed(out)) as {
            settings: Record<string, unknown>;
            problems: Record<string, unknown>;
        };

        expect(data.settings.layers).toBeNull();
        expect(data.settings.moduleLayers).toBeNull();
        expect(data.settings.aliases).toEqual([{ prefix: '@', anchor: '/src', star: true }]);
        expect(data.problems).toEqual({});
        expect(codes).toEqual([]);
        expect(err).toEqual([]);

        const text = await (async () => {
            const { program: tprogram, out: tout } = capture(root);
            await tprogram.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });
            return printed(tout);
        })();

        expect(text).toContain('  layers:         (not set)');
        expect(text).toContain('  moduleLayers:   (not set)');
    });

    it('имя алиаса с управляющим символом: текст очищен, JSON сохраняет значение', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONTROL_ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        const text = printed(out);
        expect(text).toContain('@a?/* → /a/*');
        expect(out.join('')).not.toContain('\u0007');
        expect(codes).toEqual([]);

        const { program: jprogram, out: jout } = capture(root);
        await jprogram.parseAsync(['--json', 'config', 'src/feature/internal.ts'], {
            from: 'user',
        });

        const data = JSON.parse(printed(jout)) as {
            settings: { aliases: { prefix: string }[] };
        };
        expect(data.settings.aliases[0]!.prefix).toBe('@a\u0007');
    });
});

describe('hasOwnError: код 1 только при собственной ошибке', () => {
    const value = (
        v: string | string[] | boolean | { prefix: string; anchor: string; star: boolean }[],
    ): SettingState<never> => ({ status: 'value', value: v }) as SettingState<never>;

    const base = (over: Partial<ConfigData['settings']> = {}): ConfigData => ({
        file: 'src/a.ts',
        configFile: 'eslint.config.mjs',
        settings: {
            repoRoot: value('/repo'),
            aliasesBaseUrl: value('.'),
            tsconfig: value('tsconfig.json'),
            aliases: value([]),
            srcDir: value('/src'),
            modulesDir: value('modules'),
            layers: value([]),
            moduleLayers: value([]),
            flatModules: value(false),
            ...over,
        } as ConfigData['settings'],
        sectionError: null,
    });

    it('валидная конфигурация — false (код 0)', () => {
        expect(hasOwnError(base())).toBe(false);
    });

    it('отсутствующая схема — false (код 0)', () => {
        expect(
            hasOwnError(
                base({
                    layers: { status: 'not-set' } as SettingState<readonly string[]>,
                    moduleLayers: { status: 'not-set' } as SettingState<readonly string[]>,
                }),
            ),
        ).toBe(false);
    });

    it('только unresolved, без invalid и ошибки секции — false (код 0)', () => {
        expect(
            hasOwnError(
                base({
                    aliases: {
                        status: 'unresolved',
                        dependency: 'aliasesBaseUrl',
                    } as SettingState<never>,
                }),
            ),
        ).toBe(false);
    });

    it('хотя бы одна invalid — true (код 1)', () => {
        expect(
            hasOwnError(
                base({
                    repoRoot: { status: 'invalid', message: 'bad root' } as SettingState<never>,
                    aliases: {
                        status: 'unresolved',
                        dependency: 'repoRoot',
                    } as SettingState<never>,
                }),
            ),
        ).toBe(true);
    });

    it('ошибка секции — true (код 1), даже если все поля unresolved', () => {
        const data = base({
            repoRoot: { status: 'unresolved', dependency: 'settings.weld' } as SettingState<never>,
        });
        data.sectionError = 'settings.weld must be an object';
        expect(hasOwnError(data)).toBe(true);
    });
});

describe('weld config: ошибки', () => {
    it('несуществующий путь → ошибка и код 1', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['config', 'src/missing.ts'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe('error: path does not exist: src/missing.ts\n');
        expect(codes).toEqual([1]);
    });

    it('проект без ESLint-конфига → ошибка про конфиг', async () => {
        const root = makeCliProject({ 'src/a.ts': '' });
        const { program, err, codes } = capture(root);

        await program.parseAsync(['config', 'src/a.ts'], { from: 'user' });

        expect(printed(err)).toBe('error: no eslint config found for src/a.ts\n');
        expect(codes).toEqual([1]);
    });

    it('путь вне корня репозитория → ошибка', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': OUTSIDE_ROOT_CONFIG,
            'packages/app/placeholder.ts': '',
            'src/a.ts': '',
        });
        const { program, err, codes } = capture(root);

        await program.parseAsync(['config', 'src/a.ts'], { from: 'user' });

        expect(printed(err)).toBe('error: src/a.ts is outside the repository root\n');
        expect(codes).toEqual([1]);
    });

    it('при --json ошибка уходит в stdout как { "error": ... }', async () => {
        const root = makeCliProject({ 'src/a.ts': '' });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['--json', 'config', 'src/a.ts'], { from: 'user' });

        expect(JSON.parse(printed(out))).toEqual({
            error: 'no eslint config found for src/a.ts',
        });
        expect(err).toEqual([]);
        expect(codes).toEqual([1]);
    });
});
