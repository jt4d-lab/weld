import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveForFile } from '@/config/index.js';
import type * as ConfigLayer from '@/config/index.js';
import { createFakeFsHost } from '@/host/index.js';
import { cleanupTmpProjects } from '@/testing/index.js';

import { inspectFile } from './inspect.js';
import {
    ALIAS_CONFIG,
    OUTSIDE_ROOT_CONFIG,
    capture,
    makeCliProject,
    printed,
} from './program.testing.js';

/**
 * Шов на резолв нужен одному тесту: платформенную разницу реального и виртуального пути иначе не
 * показать (на Linux их basename совпадает всегда). По умолчанию мок делегирует настоящей
 * реализации, поэтому остальные тесты идут через реальный резолв и ESLint. Путь относительный:
 * `vi.mock` с алиасом `@/` в реестр моков не попадает, а резолвится он от самого теста — при этом
 * модуль тот же, что импортирует слой.
 */
vi.mock('../config/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof ConfigLayer>();

    return { ...actual, resolveForFile: vi.fn(actual.resolveForFile) };
});

/** Тот же проект, но без алиасов: автопоиск tsconfig в tmp-директории ничего не найдет. */
const NO_ALIASES_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliasesBaseUrl: '.' } },
    },
];
`;

/** Алиас с собственным хвостом в ключе: голый префикс такой записью не резолвится. */
const FEATURE_ALIAS_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@/feature/*': ['src/feature/*'] } } },
    },
];
`;

/** Точный ключ без звездочки: специфаером становится сам префикс. */
const EXACT_ALIAS_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@/config': ['src/config'] } } },
    },
];
`;

afterEach(() => {
    cleanupTmpProjects();
});

describe('weld inspect', () => {
    it('печатает абсолютный путь файла и путь импорта по алиасу', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
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
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/index.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/index.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [`file:  ${root}/src/feature/index.ts`, 'alias: @/feature'].join('\n') + '\n',
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('алиас с хвостом в ключе: index.<ext> не даёт неразрешимый голый префикс', async () => {
        // У записи `@/feature/*` → `src/feature/*` голый `@/feature` не резолвится: звездочке
        // нечего подставить. Швом алиаса становится имя самого файла.
        const root = makeCliProject({
            'eslint.config.mjs': FEATURE_ALIAS_CONFIG,
            'src/feature/index.ts': '',
            'src/feature/internal.ts': '',
        });

        const index = capture(root);
        await index.program.parseAsync(['inspect', 'src/feature/index.ts'], { from: 'user' });
        expect(printed(index.out)).toBe(
            [`file:  ${root}/src/feature/index.ts`, 'alias: @/feature/index.ts'].join('\n') + '\n',
        );

        const internal = capture(root);
        await internal.program.parseAsync(['inspect', 'src/feature/internal.ts'], {
            from: 'user',
        });
        expect(printed(internal.out)).toBe(
            [`file:  ${root}/src/feature/internal.ts`, 'alias: @/feature/internal.ts'].join('\n') +
                '\n',
        );
    });

    it('точный ключ: index.<ext> печатается как сам префикс, без имени файла', async () => {
        // `paths: { '@/config': ['src/config'] }` резолвит `@/config`, а `@/config/index.ts` — нет:
        // хвост к точной записи не подставляется, поэтому дописывать имя файла к ней нельзя.
        const root = makeCliProject({
            'eslint.config.mjs': EXACT_ALIAS_CONFIG,
            'src/config/index.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/config/index.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [`file:  ${root}/src/config/index.ts`, 'alias: @/config'].join('\n') + '\n',
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('index.<ext> прямо в якоре алиаса печатается с именем файла', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': ALIAS_CONFIG, 'src/index.ts': '' });
        const { program, out } = capture(root);

        await program.parseAsync(['inspect', 'src/index.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [`file:  ${root}/src/index.ts`, 'alias: @/index.ts'].join('\n') + '\n',
        );
    });

    it('index.<ext> в корне репозитория не схлопывается в `/`', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': NO_ALIASES_CONFIG, 'index.ts': '' });
        const { program, out } = capture(root);

        await program.parseAsync(['inspect', 'index.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [`file:  ${root}/index.ts`, 'alias: /index.ts'].join('\n') + '\n',
        );
    });

    it('без алиасов печатает виртуальный путь', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': NO_ALIASES_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            [`file:  ${root}/src/feature/internal.ts`, 'alias: /src/feature/internal.ts'].join(
                '\n',
            ) + '\n',
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('--json печатает только JSON, без текстовых подписей', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
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
        const root = makeCliProject({
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

    it('--no-color печатает тот же текст без escape-последовательностей', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/index.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['--no-color', 'inspect', 'src/feature/index.ts'], {
            from: 'user',
        });

        expect(out.join('')).not.toContain(String.fromCharCode(27));
        expect(printed(out)).toBe(
            [`file:  ${root}/src/feature/index.ts`, 'alias: @/feature'].join('\n') + '\n',
        );
    });

    it('директория вместо файла → ошибка expected a file', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe('error: expected a file, got a directory: src/feature\n');
        expect(codes).toEqual([1]);
    });

    it('директория без линтуемых файлов → ошибка про отсутствие файлов', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/keep.css': '',
            'src/data.json': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe('error: no lintable files in src\n');
        expect(codes).toEqual([1]);
    });

    it('несуществующий путь → ошибка, при --json она уходит в stdout', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });

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
        const root = makeCliProject({
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

describe('inspectFile: имя файла в алиасе', () => {
    it('берется из виртуального пути, а не из реального (Windows)', () => {
        vi.mocked(resolveForFile).mockReturnValueOnce({
            getFromFile: () => '/src/index.ts',
            getRoot: () => 'C:\\repo',
            getFsHost: () => createFakeFsHost([]),
            getAliases: () => [{ prefix: '@', anchor: '/src', star: true }],
        });

        const result = inspectFile(
            { filePath: 'C:\\repo\\src\\index.ts', settings: {} },
            'C:\\repo',
        );

        // На Windows реальный путь пришел бы с `\`, и posix-`basename` вернул бы его целиком:
        // `@/C:\repo\src\index.ts` не резолвится ничем.
        expect(result).toEqual({
            file: 'C:\\repo\\src\\index.ts',
            virtualPath: '/src',
            alias: '@/index.ts',
        });
    });
});
