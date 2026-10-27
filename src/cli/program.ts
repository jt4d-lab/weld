/**
 * Сборка CLI на commander: глобальные флаги, две команды и печать результата.
 *
 * Команды не знают, откуда берется ESLint-конфиг и куда идет вывод: и то, и другое приходит через
 * {@link ProgramDeps}. Единственная точка, где команда встречается с терминалом, — этот модуль,
 * поэтому тесты не перехватывают `process.stdout` и не зависят от реального ESLint.
 *
 * Ошибка действия печатается здесь же и не выбрасывается: текстовая форма уходит в stderr как
 * `error: <текст>` с кодом возврата 1, а `--json` — в stdout как `{ "error": "..." }` с тем же кодом,
 * чтобы машинный потребитель не разбирал текст.
 */

import { createRequire } from 'node:module';

import { Command } from 'commander';

import { PACKAGE_NAME } from '@/debug.js';

import { effectiveConfig } from './config.js';
import type { LintSettings } from './eslint-config.js';
import { loadLintSettings } from './eslint-config.js';
import { inspectFile } from './inspect.js';
import { renderConfig, renderInspect, renderJson } from './render.js';

/**
 * Версия проставляется release-workflow перед упаковкой, поэтому читается из `package.json`.
 *
 * Ссылка на собственный пакет, а не относительный путь к файлу: `src/cli/program.ts` лежит на два
 * уровня ниже корня, а после сборки тот же код оказывается в `dist/bin.js` — на уровень ниже. Имя
 * пакета из `exports` резолвится одинаково из обоих мест.
 */
const { version: VERSION } = createRequire(import.meta.url)(`${PACKAGE_NAME}/package.json`) as {
    version: string;
};

/**
 * Швы CLI: откуда берутся настройки файла, куда пишется вывод и как сообщается код возврата. Без них
 * тесты зависели бы от реального ESLint-конфига и от `process.exitCode`.
 */
export type ProgramDeps = {
    /** База для относительных аргументов; в бою — `process.cwd()`. */
    cwd: string;
    loadLintSettings: (path: string, cwd: string) => Promise<LintSettings>;
    write: (text: string) => void;
    writeError: (text: string) => void;
    setExitCode: (code: number) => void;
};

/** То, что читает действие: глобальные флаги плюс `color`, объявленный отрицательной опцией. */
type GlobalOptions = { json?: boolean; color?: boolean };

/**
 * Цвет по умолчанию не навязывается: `--no-color` объявлен отрицательной опцией, поэтому commander
 * отдает `true`, даже когда флаг не передан. `undefined` оставляет решение за `picocolors` —
 * `NO_COLOR`/`FORCE_COLOR`/TTY тогда работают штатно.
 */
function colorOption(options: GlobalOptions): boolean | undefined {
    return options.color === false ? false : undefined;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Программа `weld`. Зависимости необязательны: `src/bin.ts` зовет `createProgram()` без аргументов
 * и получает боевые, тесты подставляют свои.
 */
export function createProgram(overrides: Partial<ProgramDeps> = {}): Command {
    const deps: ProgramDeps = {
        cwd: overrides.cwd ?? process.cwd(),
        loadLintSettings: overrides.loadLintSettings ?? loadLintSettings,
        write: overrides.write ?? ((text) => void process.stdout.write(text)),
        writeError: overrides.writeError ?? ((text) => void process.stderr.write(text)),
        setExitCode:
            overrides.setExitCode ??
            ((code) => {
                process.exitCode = code;
            }),
    };

    const program = new Command('weld')
        .description('effective WELD configuration of a file or a directory')
        .version(VERSION)
        .option('--json', 'print the result as JSON')
        .option('--no-color', 'disable colored output')
        .configureOutput({ writeOut: deps.write, writeErr: deps.writeError });

    /** Общая обвязка действий: ошибка → сообщение и код 1, в какой бы форме ни просили вывод. */
    const action =
        (run: (path: string, options: GlobalOptions) => Promise<void>) =>
        async (path: string, _options: unknown, command: Command): Promise<void> => {
            const options = command.optsWithGlobals() as GlobalOptions;

            try {
                await run(path, options);
            } catch (error) {
                const message = errorText(error);

                if (options.json === true) {
                    deps.write(`${renderJson({ error: message })}\n`);
                } else {
                    deps.writeError(`error: ${message}\n`);
                }

                deps.setExitCode(1);
            }
        };

    program
        .command('inspect')
        .description('print the file path and the import path written with an alias')
        .argument('<file>', 'file to inspect')
        .action(
            action(async (path, options) => {
                const lint = await deps.loadLintSettings(path, deps.cwd);
                const result = inspectFile(lint, deps.cwd);
                const text =
                    options.json === true
                        ? renderJson({ file: result.data.file, alias: result.alias })
                        : renderInspect(result.data, { color: colorOption(options) });

                deps.write(`${text}\n`);
            }),
        );

    program
        .command('config')
        .description('print the effective WELD settings of a file or a directory')
        .argument('<path>', 'file or directory')
        .action(
            action(async (path, options) => {
                const lint = await deps.loadLintSettings(path, deps.cwd);
                const data = effectiveConfig(lint, deps.cwd);
                const text =
                    options.json === true
                        ? renderJson(data)
                        : renderConfig(data, { color: colorOption(options) });

                deps.write(`${text}\n`);
            }),
        );

    return program;
}
