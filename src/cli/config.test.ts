import { afterEach, describe, expect, it } from 'vitest';

import { rules } from '@/rules/index.js';
import type { Alias, SettingState } from '@/settings/index.js';
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

const INVALID_RULE_OPTION_CONFIG = `const weld = {
    rules: {
        'no-barrel-bypass': { meta: { schema: ${JSON.stringify(rules['no-barrel-bypass'].meta?.schema)} }, create: () => ({}) },
    },
};
export default [{
    files: ['**/*.ts'],
    plugins: { weld },
    rules: { 'weld/no-barrel-bypass': ['error', { repoRoot: 42 }] },
    settings: { weld: { aliases: 42 } },
}];
`;

const BAD_REPO_ROOT_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { repoRoot: 42 } },
    },
];
`;

const BAD_SECTION_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: 'nope' },
    },
];
`;

const MULTI_PROBLEM_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: {
            weld: {
                repoRoot: 42,
                tsconfig: 42,
                aliases: { '@a': 42 },
            },
        },
    },
];
`;

/**
 * Имя алиаса с управляющим символом: в файле конфига — JS-экранирование, после загрузки —
 * реальный символ `\u0007` внутри ключа.
 */
const CONTROL_ALIAS_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@a\\u0007/*': ['a/*'] } } },
    },
];
`;

/** Тот же управляющий символ в имени ключа, но ключ невалиден: символ попадает в текст ошибки. */
const CONTROL_ERROR_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@a\\u0007': 42 } } },
    },
];
`;

afterEach(() => {
    cleanupTmpProjects();
});

describe('weld config: файл', () => {
    it('ошибка схемы опций ESLint не дает построить отчет', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': INVALID_RULE_OPTION_CONFIG,
            'src/a.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['--json', 'config', 'src/a.ts'], { from: 'user' });

        const result = JSON.parse(printed(out)) as Record<string, unknown>;
        expect(result.error).toEqual(expect.stringContaining('Value 42 should be string'));
        expect(result).not.toHaveProperty('settings');
        expect(err).toEqual([]);
        expect(codes).toEqual([1]);
    });

    it('печатает корень, базу алиасов, имя tsconfig и алиасы, код 0', async () => {
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
                '  aliases:',
                '    @/* → /src/*',
                '  aliasesBaseUrl: .',
                `  repoRoot:       ${root}`,
                '  tsconfig:       tsconfig.json',
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
                '  aliases:',
                '    @/* → /src/*',
                '  aliasesBaseUrl: .',
                `  repoRoot:       ${root}`,
                '  tsconfig:       tsconfig.json',
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
                '  aliases:',
                '    @/* → /src/*',
                '  aliasesBaseUrl: .',
                `  repoRoot:       ${root}`,
                '  tsconfig:       tsconfig.custom.json',
            ].join('\n') + '\n',
        );
        expect(codes).toEqual([]);
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

    it('--json отдает sampleOf, настройки и пустые problems', async () => {
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
                '  aliases:        (unresolved: repoRoot)',
                '  aliasesBaseUrl: .',
                '  repoRoot:       settings.weld.repoRoot must be a string, got number',
                '  tsconfig:       tsconfig.json',
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
        expect(data.problems).toEqual({
            repoRoot: {
                status: 'invalid',
                message: 'settings.weld.repoRoot must be a string, got number',
            },
            aliases: { status: 'unresolved', dependency: 'repoRoot' },
        });
    });

    it('кривая секция: все настройки unresolved, код 1', async () => {
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
                '  aliases:        (unresolved: settings.weld)',
                '  aliasesBaseUrl: (unresolved: settings.weld)',
                '  repoRoot:       (unresolved: settings.weld)',
                '  tsconfig:       (unresolved: settings.weld)',
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
        expect(Object.values(data.settings)).toEqual(Array(4).fill(null));
        expect(data.problems).toEqual({
            repoRoot: { status: 'unresolved', dependency: 'settings.weld' },
            aliasesBaseUrl: { status: 'unresolved', dependency: 'settings.weld' },
            tsconfig: { status: 'unresolved', dependency: 'settings.weld' },
            aliases: { status: 'unresolved', dependency: 'settings.weld' },
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
                "  aliases:        settings.weld.aliases['@a'] must be a string or an array of strings",
                '  aliasesBaseUrl: .',
                '  repoRoot:       settings.weld.repoRoot must be a string, got number',
                '  tsconfig:       settings.weld.tsconfig must be a string, got number',
            ].join('\n') + '\n',
        );
        expect(codes).toEqual([1]);

        const { program: jprogram, out: jout } = capture(root);
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
        expect(Object.keys(data.problems).sort()).toEqual(['aliases', 'repoRoot', 'tsconfig']);
        expect(data.problems.aliases).toEqual({
            status: 'invalid',
            message: "settings.weld.aliases['@a'] must be a string or an array of strings",
        });
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

    it('сообщение об ошибке настройки: текст очищен, JSON сохраняет символ', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONTROL_ERROR_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toContain(
            "  aliases:        settings.weld.aliases['@a?'] must be a string or an array of strings",
        );
        expect(out.join('')).not.toContain('\u0007');
        expect(codes).toEqual([1]);

        const { program: jprogram, out: jout } = capture(root);
        await jprogram.parseAsync(['--json', 'config', 'src/feature/internal.ts'], {
            from: 'user',
        });

        const data = JSON.parse(printed(jout)) as {
            problems: { aliases: { message: string } };
        };
        expect(data.problems.aliases.message).toBe(
            "settings.weld.aliases['@a\u0007'] must be a string or an array of strings",
        );
    });
});

describe('hasOwnError: код 1 только при собственной ошибке', () => {
    const text = (value: string): SettingState<string> => ({ status: 'value', value });
    const aliasList = (value: Alias[]): SettingState<Alias[]> => ({ status: 'value', value });

    const base = (over: Partial<ConfigData['settings']> = {}): ConfigData => ({
        file: 'src/a.ts',
        configFile: 'eslint.config.mjs',
        settings: {
            repoRoot: text('/repo'),
            aliasesBaseUrl: text('.'),
            tsconfig: text('tsconfig.json'),
            aliases: aliasList([]),
            ...over,
        },
        sectionError: null,
    });

    it('валидная конфигурация — false (код 0)', () => {
        expect(hasOwnError(base())).toBe(false);
    });

    it('только unresolved, без invalid и ошибки секции — false (код 0)', () => {
        expect(
            hasOwnError(
                base({
                    aliases: {
                        status: 'unresolved',
                        dependency: 'aliasesBaseUrl',
                    },
                }),
            ),
        ).toBe(false);
    });

    it('хотя бы одна invalid — true (код 1)', () => {
        expect(
            hasOwnError(
                base({
                    repoRoot: { status: 'invalid', message: 'bad root' },
                    aliases: {
                        status: 'unresolved',
                        dependency: 'repoRoot',
                    },
                }),
            ),
        ).toBe(true);
    });

    it('ошибка секции — true (код 1), даже если все поля unresolved', () => {
        const data = base({
            repoRoot: { status: 'unresolved', dependency: 'settings.weld' },
        });
        expect(hasOwnError({ ...data, sectionError: 'settings.weld must be an object' })).toBe(
            true,
        );
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
