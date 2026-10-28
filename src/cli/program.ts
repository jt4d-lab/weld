/**
 * Сборка CLI на commander: глобальные флаги, две команды и печать результата.
 *
 * Ошибка печатается здесь же с кодом возврата 1: текст уходит в stderr как `error: <текст>`, а при
 * `--json` — в stdout как `{ "error": "..." }`. Ошибки использования `commander` печатает сам,
 * поэтому разбор аргументов обернут в {@link runCli}.
 */

import { Command, CommanderError } from 'commander';

import { packageVersion } from '@/package.js';

import { effectiveConfig } from './config.js';
import type { LintSettings } from './eslint-config.js';
import { loadLintSettings } from './eslint-config.js';
import { inspectFile } from './inspect.js';
import { renderConfig, renderInspect, renderJson } from './render.js';

/**
 * Швы CLI: откуда берутся настройки файла, куда пишется вывод и как сообщается код возврата.
 */
export type ProgramDeps = {
    /** База для относительных аргументов; в бою — `process.cwd()`. */
    cwd: string;
    /**
     * Настройки цели. Третий аргумент — путь из `--config`: он отменяет поиск конфига.
     */
    loadLintSettings: (path: string, cwd: string, config?: string) => Promise<LintSettings>;
    write: (text: string) => void;
    writeError: (text: string) => void;
    setExitCode: (code: number) => void;
};

/** Боевые значения швов: всё, что не подставили тесты. */
function resolveDeps(overrides: Partial<ProgramDeps>): ProgramDeps {
    return {
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
}

/**
 * То, что читает действие: глобальные флаги плюс `color`, объявленный отрицательной опцией.
 * `config` — путь ESLint-конфига, который отменяет поиск ближайшего к аргументу.
 */
type GlobalOptions = { json?: boolean; color?: boolean; config?: string };

/**
 * Цвет по умолчанию не навязывается: `--no-color` объявлен отрицательной опцией, поэтому commander
 * отдает `true`, даже когда флаг не передан. `undefined` оставляет решение за `picocolors` —
 * `NO_COLOR`/`FORCE_COLOR`/TTY тогда работают штатно.
 */
function colorOption(options: GlobalOptions): boolean | undefined {
    return options.color === false ? false : undefined;
}

function errorText(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    return [...message].map((char) => (char < ' ' || char === '\u007f' ? '?' : char)).join('');
}

/** Печать ошибки в той форме, которую просил пользователь: `--json` → stdout, иначе stderr. */
function reportError(deps: ProgramDeps, message: string, json: boolean): void {
    if (json) {
        deps.write(`${renderJson({ error: message })}\n`);
    } else {
        deps.writeError(`error: ${message}\n`);
    }

    deps.setExitCode(1);
}

export function createProgram(overrides: Partial<ProgramDeps> = {}): Command {
    return buildProgram(resolveDeps(overrides));
}

function buildProgram(deps: ProgramDeps): Command {
    const program = new Command('weld')
        .description('effective WELD configuration of a file or a directory')
        .version(packageVersion())
        .option('--json', 'print the result as JSON')
        .option('--no-color', 'disable colored output')
        .option('--config <path>', 'eslint config file to use instead of searching');

    /** Глобальные флаги текущего разбора — нужны и печати ошибок, и действиям. */
    const globalOptions = (): GlobalOptions => program.opts<GlobalOptions>();

    program.configureOutput({
        writeOut: deps.write,
        // В `--json` любой текст commander'а (ошибка использования, справка вместо ошибки при
        // пропущенной команде) ушел бы в stderr мимо машиночитаемого вывода: ошибку печатает
        // `runCli` как JSON, а справка в машинном режиме — шум. Текстовый режим не трогаем.
        writeErr: (text) => {
            if (!globalOptions().json) {
                deps.writeError(text);
            }
        },
    });

    // Ошибки использования не должны завершать процесс мимо `deps`: `exitOverride` превращает их в
    // исключение, которое ловит `runCli`. До объявления команд — подкоманды наследуют настройку.
    program.exitOverride();

    /** Общая обвязка действий: ошибка → сообщение и код 1, в какой бы форме ни просили вывод. */
    const action =
        (run: (path: string, options: GlobalOptions) => Promise<void>) =>
        async (path: string, _options: unknown, command: Command): Promise<void> => {
            const options = command.optsWithGlobals() as GlobalOptions;

            try {
                await run(path, options);
            } catch (error) {
                reportError(deps, errorText(error), options.json === true);
            }
        };

    program
        .command('inspect')
        .description('print the file path and the import path written with an alias')
        .argument('<file>', 'file to inspect')
        .action(
            action(async (path, options) => {
                const lint = await deps.loadLintSettings(path, deps.cwd, options.config);
                const { file, virtualPath, alias } = inspectFile(lint, deps.cwd, path);
                const text =
                    options.json === true
                        ? renderJson({ file, alias })
                        : renderInspect(
                              { file, alias: alias ?? virtualPath },
                              { color: colorOption(options) },
                          );

                deps.write(`${text}\n`);
            }),
        );

    program
        .command('config')
        .description('print the effective WELD settings of a file or a directory')
        .argument('<path>', 'file or directory')
        .action(
            action(async (path, options) => {
                const lint = await deps.loadLintSettings(path, deps.cwd, options.config);
                const data = effectiveConfig(lint, deps.cwd, path);
                const text =
                    options.json === true
                        ? renderJson(data)
                        : renderConfig(data, { color: colorOption(options) });

                deps.write(`${text}\n`);
            }),
        );

    return program;
}

/**
 * Разбор аргументов и запуск команды. Ошибки действий сюда не доходят — их печатает действие.
 */
export async function runCli(
    argv: readonly string[],
    overrides: Partial<ProgramDeps> = {},
): Promise<void> {
    const deps = resolveDeps(overrides);
    let program: Command | null = null;

    try {
        program = buildProgram(deps);
        await program.parseAsync([...argv], { from: 'node' });
    } catch (error) {
        if (error instanceof CommanderError && error.exitCode === 0) {
            return;
        }

        const json = program !== null && program.opts<GlobalOptions>().json === true;

        if (error instanceof CommanderError) {
            // `commander` печатает справку вместо ошибки, когда команда не указана. Своего текста у
            // такого исключения нет (внутренний сентинел `(outputHelp)`), поэтому сообщение
            // подставляется здесь: иначе в `--json` уходило бы `{"error": "(outputHelp)"}`, а в
            // текстовом режиме не было бы строки `error:` вовсе.
            if (error.code === 'commander.help') {
                reportError(deps, 'missing command', json);

                return;
            }

            if (json) {
                reportError(deps, errorText(error).replace(/^error: /, ''), true);
            } else {
                deps.setExitCode(error.exitCode);
            }

            return;
        }

        reportError(deps, errorText(error), json);
    }
}
