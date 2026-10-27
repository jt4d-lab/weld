import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpProjects, makeTmpProject } from '@/testing/index.js';

import type { ProgramDeps } from './program.js';
import { createProgram } from './program.js';

const { version: PACKAGE_VERSION } = createRequire(import.meta.url)('../../package.json') as {
    version: string;
};

/** ESLint на реальном диске: `settings.weld` приходит из эффективного конфига проекта. */
const CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliasesBaseUrl: '.', aliases: { '@/*': ['src/*'] } } },
    },
];
`;

/** Корень уже, чем директория проекта: файл в `src/` оказывается вне него. */
const OUTSIDE_ROOT_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { repoRoot: 'packages/app', aliases: { '@/*': ['src/*'] } } },
    },
];
`;

afterEach(() => {
    cleanupTmpProjects();
});

/** `ESC` из литерала не собрать: правило `no-control-regex` запрещает control-символы в регэкспе. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

type Captured = {
    program: ReturnType<typeof createProgram>;
    out: string[];
    err: string[];
    codes: number[];
};

/** Программа с перехваченным выводом: терминал и `process.exitCode` тесту не нужны. */
function capture(root: string, overrides: Partial<ProgramDeps> = {}): Captured {
    const out: string[] = [];
    const err: string[] = [];
    const codes: number[] = [];

    const program = createProgram({
        cwd: root,
        write: (text) => void out.push(text),
        writeError: (text) => void err.push(text),
        setExitCode: (code) => void codes.push(code),
        ...overrides,
    });

    return { program, out, err, codes };
}

/** Напечатанное без color-escape-последовательностей. */
function printed(chunks: string[]): string {
    return chunks.join('').replace(ANSI, '');
}

describe('weld config: файл', () => {
    it('печатает корень, базу алиасов, имя tsconfig и разобранные алиасы', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['config', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [
                `file:  ${root}/src/feature/internal.ts`,
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
});

describe('weld config: директория', () => {
    it('показывает сэмпл директории и помечает его', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/feature/internal.ts': '',
            'src/feature/index.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['config', 'src/feature'], { from: 'user' });

        expect(printed(out)).toContain(
            `file:  ${root}/src/feature/index.ts (sample of src/feature)\n`,
        );
    });

    it('--json отдает sampleOf и настройки в машинной форме', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/feature/internal.ts': '',
            'src/feature/index.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['--json', 'config', 'src/feature'], { from: 'user' });

        expect(JSON.parse(printed(out))).toEqual({
            file: `${root}/src/feature/index.ts`,
            sampleOf: 'src/feature',
            settings: {
                repoRoot: root,
                aliasesBaseUrl: '.',
                tsconfig: 'tsconfig.json',
                aliases: [{ prefix: '@', anchor: '/src' }],
            },
        });
    });
});

describe('weld config: --json у файла', () => {
    it('не содержит sampleOf', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['--json', 'config', 'src/feature/internal.ts'], { from: 'user' });

        const data = JSON.parse(printed(out)) as Record<string, unknown>;
        expect(data).not.toHaveProperty('sampleOf');
        expect(data.file).toBe(`${root}/src/feature/internal.ts`);
    });
});

describe('weld config: ошибки', () => {
    it('несуществующий путь → ошибка и код 1', async () => {
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG, 'src/feature/internal.ts': '' });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['config', 'src/missing.ts'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe('error: path does not exist: src/missing.ts\n');
        expect(codes).toEqual([1]);
    });

    it('проект без ESLint-конфига → ошибка про конфиг', async () => {
        const root = makeTmpProject({ 'src/a.ts': '' });
        const { program, err, codes } = capture(root);

        await program.parseAsync(['config', 'src/a.ts'], { from: 'user' });

        expect(printed(err)).toBe('error: no eslint config found for src/a.ts\n');
        expect(codes).toEqual([1]);
    });

    it('путь вне корня репозитория → ошибка', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': OUTSIDE_ROOT_CONFIG,
            'packages/app/placeholder.ts': '',
            'src/a.ts': '',
        });
        const { program, err, codes } = capture(root);

        await program.parseAsync(['config', 'src/a.ts'], { from: 'user' });

        expect(printed(err)).toBe(`error: ${root}/src/a.ts is outside the repository root\n`);
        expect(codes).toEqual([1]);
    });

    it('при --json ошибка уходит в stdout как { "error": ... }', async () => {
        const root = makeTmpProject({ 'src/a.ts': '' });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['--json', 'config', 'src/a.ts'], { from: 'user' });

        expect(JSON.parse(printed(out))).toEqual({
            error: 'no eslint config found for src/a.ts',
        });
        expect(err).toEqual([]);
        expect(codes).toEqual([1]);
    });
});

describe('createProgram: версия', () => {
    it('--version печатает версию из package.json', async () => {
        const root = makeTmpProject();
        const { program, out } = capture(root);

        // `exitOverride` не дает commander завершить процесс; `--version` — не ошибка, а выход с 0.
        program.exitOverride();

        await expect(program.parseAsync(['--version'], { from: 'user' })).rejects.toMatchObject({
            exitCode: 0,
        });

        expect(printed(out).trim()).toBe(PACKAGE_VERSION);
    });
});
