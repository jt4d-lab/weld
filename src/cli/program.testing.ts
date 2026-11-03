/** Общий каркас тестов слоя CLI: временный проект, программа с перехваченным выводом и фикстуры конфигов. */

import { linkRepoNodeModules, makeTmpProject } from '@/testing/index.js';

import type { ProgramDeps } from './program.js';
import { createProgram, runCli } from './program.js';

/**
 * Схема слоев тестов CLI: проект `app`, модули `features` — как в таблице примеров
 * `docs/cli/inspect.md`. `weld inspect` без нее не работает, а `weld config` печатает ее поля в
 * отчете.
 */
export const SCHEME_SETTINGS = {
    layers: ['app', '@modules', '@unknown'],
    moduleLayers: ['features'],
};

/** Та же схема строкой — для конфигов, которые тесты пишут на диск. */
export const SCHEME_FIELDS = Object.entries(SCHEME_SETTINGS)
    .map(([field, names]) => `${field}: ${renderNames(names)}`)
    .join(', ');

/** Список в форме исходника конфига: JSON дал бы двойные кавычки. */
function renderNames(names: readonly string[]): string {
    return `[${names.map((name) => `'${name}'`).join(', ')}]`;
}

/**
 * ESLint-конфиг тестов CLI на реальном диске. `files` объявлен, потому что без совпадающей записи
 * flat config считает файл игнорируемым, а `settings.weld.aliases` — то, что показывают команды.
 */
export const ALIAS_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: {
            weld: { aliasesBaseUrl: '.', aliases: { '@/*': ['src/*'] }, ${SCHEME_FIELDS} },
        },
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
 * нашел, и объявляет свои настройки — выбор конфига видно по выводу.
 */
export const OTHER_CONFIG_PATH = 'configs/other.config.mjs';

export const OTHER_CONFIG = `export default [
    {
        files: ['**/*.ts', '**/*.js'],
        settings: {
            weld: { aliasesBaseUrl: '.', aliases: { '@other/*': ['src/*'] }, ${SCHEME_FIELDS} },
        },
    },
];
`;

/**
 * Проект с `node_modules`: `weld` грузит `eslint` из проекта, как в бою. `package.json` добавлен
 * всегда: он делает корень проекта (`findRepoRoot`) предсказуемым.
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

export function plain(text: string): string {
    return text.replace(ANSI, '');
}

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

export function capture(root: string, overrides: Partial<ProgramDeps> = {}): Captured {
    const { out, err, codes, write, writeError, setExitCode } = makeSinks();
    const program = createProgram({ cwd: root, ...overrides, write, writeError, setExitCode });

    return { program, out, err, codes };
}

type CapturedRun = Omit<Captured, 'program'>;

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
