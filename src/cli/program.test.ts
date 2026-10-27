import { createRequire } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTmpProjects } from '@/testing/index.js';

import type * as PackageModule from '../package.js';
import { packageVersion } from '../package.js';
import type { ProgramDeps } from './program.js';
import { runCli } from './program.js';
import { capture, makeCliProject, printed, runCliCapture } from './program.testing.js';

/**
 * Шов на чтение версии: сломанный `package.json` виден только ошибкой, а иначе его не показать. По
 * умолчанию мок делегирует настоящей реализации; путь относительный — по той же причине, что и в
 * `src/config/resolve.test.ts`.
 */
vi.mock('../package.js', async (importOriginal) => {
    const actual = await importOriginal<typeof PackageModule>();

    return { ...actual, packageVersion: vi.fn(actual.packageVersion) };
});

const { version: PACKAGE_VERSION } = createRequire(import.meta.url)('../../package.json') as {
    version: string;
};

afterEach(() => {
    cleanupTmpProjects();
});

describe('runCli: версия и справка', () => {
    it('--version печатает версию из package.json без кода ошибки', async () => {
        const root = makeCliProject();
        const { out, err, codes } = await runCliCapture(['--version'], root);

        expect(printed(out).trim()).toBe(PACKAGE_VERSION);
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('--help печатает справку и не считается ошибкой', async () => {
        const root = makeCliProject();
        const { out, err, codes } = await runCliCapture(['--help'], root);

        expect(printed(out)).toContain('Usage: weld');
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });
});

describe('runCli: ошибки использования', () => {
    it('пропущенный аргумент → текст в stderr и код 1', async () => {
        const root = makeCliProject();
        const { out, err, codes } = await runCliCapture(['config'], root);

        expect(out).toEqual([]);
        expect(printed(err)).toBe("error: missing required argument 'path'\n");
        expect(codes).toEqual([1]);
    });

    it('пропущенный аргумент при --json → JSON в stdout, без текста в stderr', async () => {
        const root = makeCliProject();
        const { out, err, codes } = await runCliCapture(['--json', 'config'], root);

        expect(JSON.parse(printed(out))).toEqual({
            error: "missing required argument 'path'",
        });
        expect(err).toEqual([]);
        expect(codes).toEqual([1]);
    });

    it('без команды → ошибка missing command, а не только справка', async () => {
        const root = makeCliProject();
        const { out, err, codes } = await runCliCapture([], root);

        // Справка от commander — не ошибка сама по себе, но запуск без команды — ошибка.
        expect(out).toEqual([]);
        expect(printed(err)).toContain('Usage: weld');
        expect(printed(err)).toContain('error: missing command');
        expect(codes).toEqual([1]);
    });

    it('без команды при --json → JSON в stdout без внутреннего сентинела commander', async () => {
        const root = makeCliProject();
        const { out, err, codes } = await runCliCapture(['--json'], root);

        expect(JSON.parse(printed(out))).toEqual({ error: 'missing command' });
        expect(err).toEqual([]);
        expect(codes).toEqual([1]);
    });

    it('неизвестная команда → код 1', async () => {
        const root = makeCliProject();
        const { out, err, codes } = await runCliCapture(['bogus'], root);

        expect(out).toEqual([]);
        expect(printed(err)).toContain("error: unknown command 'bogus'");
        expect(codes).toEqual([1]);
    });
});

describe('runCli: сборка программы', () => {
    it('сломанное чтение версии — ошибка с кодом 1, а не отклоненный промис', async () => {
        const root = makeCliProject();
        vi.mocked(packageVersion).mockImplementationOnce(() => {
            throw new Error('version is broken');
        });

        const { out, err, codes } = await runCliCapture(['--version'], root);

        expect(out).toEqual([]);
        expect(printed(err)).toBe('error: version is broken\n');
        expect(codes).toEqual([1]);
    });
});

describe('createProgram: код возврата по умолчанию', () => {
    it('ставит process.exitCode, когда шов не подставлен', async () => {
        const root = makeCliProject();
        const deps: Partial<ProgramDeps> = {
            cwd: root,
            write: () => {},
            writeError: () => {},
        };
        const previous = process.exitCode;

        try {
            await runCli(['node', 'weld', '--json', 'config'], deps);
            expect(process.exitCode).toBe(1);
        } finally {
            process.exitCode = previous;
        }
    });
});

describe('createProgram: шов loadLintSettings', () => {
    it('настройки можно подставить без диска и ESLint', async () => {
        const root = makeCliProject();
        const { program, out } = capture(root, {
            loadLintSettings: async (path) => ({
                filePath: `${root}/${path}`,
                settings: { weld: { aliases: { '@/*': ['src/*'] } } },
            }),
        });

        await program.parseAsync(['inspect', 'src/a.ts'], { from: 'user' });

        expect(printed(out)).toBe([`file:  ${root}/src/a.ts`, 'alias: @/a.ts'].join('\n') + '\n');
    });
});

describe('createProgram: цвет', () => {
    it('--no-color выключает escape-последовательности в выводе команды', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': `export default [{ files: ['**/*.ts'], settings: { weld: {} } }];\n`,
            'src/feature/index.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['config', '--no-color', 'src/feature'], { from: 'user' });

        expect(out.join('')).not.toContain(String.fromCharCode(27));
        expect(printed(out)).toContain(
            `file:  ${root}/src/feature/index.ts (sample of src/feature)`,
        );
    });
});
