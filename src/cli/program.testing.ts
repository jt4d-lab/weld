/**
 * Общий каркас тестов слоя CLI: временный проект с установленными зависимостями, программа (или
 * запуск `runCli`) с перехваченным выводом и общие фикстуры конфигов.
 *
 * `makeCliProject` нужен потому, что `eslint` CLI ищет в проекте-потребителе (там же, где его
 * видит пользователь), а не рядом с файлом плагина. `capture` прячет терминал и `process.exitCode`
 * за `ProgramDeps`, поэтому тесты не перехватывают потоки процесса.
 */

import { linkRepoNodeModules, makeTmpProject } from '@/testing/index.js';

import type { ProgramDeps } from './program.js';
import { createProgram, runCli } from './program.js';

/**
 * ESLint-конфиг тестов CLI на реальном диске. `files` объявлен, потому что без совпадающей записи
 * flat config считает файл игнорируемым, а `settings.weld.aliases` — то, что показывают команды.
 */
export const ALIAS_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliasesBaseUrl: '.', aliases: { '@/*': ['src/*'] } } },
    },
];
`;

/** Корень уже директории проекта: файл в `src/` оказывается вне него. */
export const OUTSIDE_ROOT_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { repoRoot: 'packages/app', aliases: { '@/*': ['src/*'] } } },
    },
];
`;

/**
 * Конфиг, который передают флагом `--config`: лежит в поддиректории, чтобы поиск от цели его не
 * нашел, и объявляет свои настройки — выбор конфига видно по выводу. Расширения — те же, что в
 * проектах тестов, чтобы одна фикстура годилась и слою CLI, и загрузке настроек.
 */
export const OTHER_CONFIG_PATH = 'configs/other.config.mjs';

export const OTHER_CONFIG = `export default [
    {
        files: ['**/*.ts', '**/*.js'],
        settings: { weld: { aliasesBaseUrl: '.', aliases: { '@other/*': ['src/*'] } } },
    },
];
`;

/**
 * Проект с `node_modules`: `weld` грузит `eslint` из проекта, как в бою. `package.json` добавлен
 * всегда: он делает корень проекта (`findRepoRoot`) предсказуемым, а не зависящим от того, что
 * лежит в директориях над временной.
 */
export function makeCliProject(files: Record<string, string> = {}): string {
    const root = makeTmpProject({
        'package.json': '{ "name": "weld-cli-test", "private": true, "type": "module" }\n',
        ...files,
    });
    linkRepoNodeModules(root);

    return root;
}

/** `ESC` из литерала не собрать: правило `no-control-regex` запрещает control-символы в регэкспе. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** Напечатанное без color-escape-последовательностей: так проверяется, что цвет не меняет текст. */
export function plain(text: string): string {
    return text.replace(ANSI, '');
}

/** То, что напечатали кусками: склеенное и без escape-последовательностей. */
export function printed(chunks: string[]): string {
    return plain(chunks.join(''));
}

type Captured = {
    program: ReturnType<typeof createProgram>;
    out: string[];
    err: string[];
    codes: number[];
};

/** Собираемое швами: вывод, ошибки и коды возврата — одни и те же для обоих способов запуска. */
type Sinks = {
    out: string[];
    err: string[];
    codes: number[];
    write: (text: string) => void;
    writeError: (text: string) => void;
    setExitCode: (code: number) => void;
};

function makeSinks(): Sinks {
    const out: string[] = [];
    const err: string[] = [];
    const codes: number[] = [];

    return {
        out,
        err,
        codes,
        write: (text) => void out.push(text),
        writeError: (text) => void err.push(text),
        setExitCode: (code) => void codes.push(code),
    };
}

/** Программа с перехваченным выводом: терминал и `process.exitCode` тесту не нужны. */
export function capture(root: string, overrides: Partial<ProgramDeps> = {}): Captured {
    const { out, err, codes, write, writeError, setExitCode } = makeSinks();
    const program = createProgram({ cwd: root, ...overrides, write, writeError, setExitCode });

    return { program, out, err, codes };
}

type CapturedRun = Omit<Captured, 'program'>;

/**
 * Запуск через `runCli` — тот же путь, которым идет `src/bin.ts`: разбор аргументов, ошибки
 * использования и код возврата. Вывод и код собираются теми же швами `ProgramDeps`.
 */
export async function runCliCapture(
    argv: readonly string[],
    root: string,
    overrides: Partial<ProgramDeps> = {},
): Promise<CapturedRun> {
    const { out, err, codes, write, writeError, setExitCode } = makeSinks();

    await runCli(['node', 'weld', ...argv], {
        cwd: root,
        ...overrides,
        write,
        writeError,
        setExitCode,
    });

    return { out, err, codes };
}
