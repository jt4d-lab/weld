import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpProjects, makeTmpProject } from '@/testing/index.js';

import type { ProgramDeps } from './program.js';
import { createProgram } from './program.js';

/**
 * ESLint на реальном диске: настройки приходят из эффективного конфига проекта, а не подставляются
 * руками, — иначе тест проверял бы не CLI, а собственную заглушку. `.ts` объявлен в `files`, потому
 * что без совпадающей записи flat config файл считается игнорируемым.
 */
const CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@/*': ['src/*'] } } },
    },
];
`;

/** Тот же проект, но без алиасов: автопоиск tsconfig в tmp-директории ничего не найдет. */
const NO_ALIASES_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliasesBaseUrl: '.' } },
    },
];
`;

/** Границы корня: файл в `src/` заведомо вне явного root `packages/app`. */
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

describe('weld inspect', () => {
    it('печатает абсолютный путь файла и путь импорта по алиасу', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [`file:  ${root}/src/feature/internal.ts`, 'alias: @/feature/internal.ts'].join('\n') +
                '\n',
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('index.<ext> схлопывается в директорию модуля', async () => {
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG, 'src/feature/index.ts': '' });
        const { program, out } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/index.ts'], { from: 'user' });

        expect(printed(out)).toContain('alias: @/feature\n');
    });

    it('без алиасов печатает виртуальный путь', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': NO_ALIASES_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [`file:  ${root}/src/feature/internal.ts`, 'alias: /src/feature/internal.ts'].join(
                '\n',
            ) + '\n',
        );
    });

    it('--json печатает только JSON, без текстовых подписей', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['--json', 'inspect', 'src/feature/internal.ts'], {
            from: 'user',
        });

        expect(JSON.parse(printed(out))).toEqual({
            file: `${root}/src/feature/internal.ts`,
            alias: '@/feature/internal.ts',
        });
    });

    it('--json без алиаса печатает alias: null', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': NO_ALIASES_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['inspect', '--json', 'src/feature/internal.ts'], {
            from: 'user',
        });

        expect(JSON.parse(printed(out))).toEqual({
            file: `${root}/src/feature/internal.ts`,
            alias: null,
        });
    });

    it('директория вместо файла → ошибка expected a file', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe('error: expected a file, got a directory: src/feature\n');
        expect(codes).toEqual([1]);
    });

    it('несуществующий путь → ошибка, при --json она уходит в stdout', async () => {
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG, 'src/feature/internal.ts': '' });

        const text = capture(root);
        await text.program.parseAsync(['inspect', 'src/missing.ts'], { from: 'user' });
        expect(printed(text.err)).toBe('error: path does not exist: src/missing.ts\n');
        expect(text.out).toEqual([]);
        expect(text.codes).toEqual([1]);

        const json = capture(root);
        await json.program.parseAsync(['--json', 'inspect', 'src/missing.ts'], { from: 'user' });
        expect(JSON.parse(printed(json.out))).toEqual({
            error: 'path does not exist: src/missing.ts',
        });
        expect(json.err).toEqual([]);
        expect(json.codes).toEqual([1]);
    });

    it('файл вне корня репозитория → ошибка', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': OUTSIDE_ROOT_CONFIG,
            'packages/app/placeholder.ts': '',
            'src/feature/internal.ts': '',
        });
        const { program, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(err)).toBe(
            `error: ${root}/src/feature/internal.ts is outside the repository root\n`,
        );
        expect(codes).toEqual([1]);
    });
});
