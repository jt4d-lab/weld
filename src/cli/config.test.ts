import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpProjects } from '@/testing/index.js';

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

/** Алиасы заданы опциями правила — как у проекта, который настраивает WELD на правиле. */
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

afterEach(() => {
    cleanupTmpProjects();
});

describe('weld config: файл', () => {
    it('печатает корень, базу алиасов, имя tsconfig и разобранные алиасы', async () => {
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
        const { program, out } = capture(root);

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
            ].join('\n') + '\n',
        );
    });

    it('опции правила из конфига перекрывают settings.weld, как и при линте', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': RULE_OPTIONS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out } = capture(root);

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
            ].join('\n') + '\n',
        );
    });
});

describe('weld config: директория', () => {
    it('показывает сэмпл директории и помечает его', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
            'src/feature/index.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['config', 'src/feature'], { from: 'user' });

        expect(printed(out)).toContain('file:   src/feature/index.ts (sample of src/feature)\n');
    });

    it('--json отдает sampleOf и настройки в машинной форме', async () => {
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
        });
    });
});

describe('weld config: --json у файла', () => {
    it('не содержит sampleOf', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['--json', 'config', 'src/feature/internal.ts'], { from: 'user' });

        const data = JSON.parse(printed(out)) as Record<string, unknown>;
        expect(data).not.toHaveProperty('sampleOf');
        expect(data.file).toBe('src/feature/internal.ts');
        expect(data.configFile).toBe('eslint.config.mjs');
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
