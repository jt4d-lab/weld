/**
 * Единственное место CLI, которое знает про ESLint: путь → `settings` эффективного ESLint-конфига.
 * Наружу отдается минимум (`{ filePath, settings, options?, sampleOf? }`), а не `Linter.Config`,
 * поэтому `eslint` не течет ни в рендер вывода, ни в команды.
 *
 * `eslint` грузится динамически: статический `import` упал бы на загрузке модуля, до любой
 * диагностики, и в проекте без ESLint пользователь увидел бы стектрейс вместо сообщения. Ищется он
 * в проекте пользователя (от `cwd`), а не рядом с файлом плагина: глобально установленный `weld` или
 * `npx` из другой директории обязан найти тот `eslint`, который в проекте действительно есть.
 *
 * Обход директории за сэмплом и `stat` живут отдельно, в `sample.ts`: у этого модуля одна работа —
 * загрузка `eslint` и чтение его конфига.
 */

import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ESLint, Linter } from 'eslint';

import type { WeldResolveOptions } from '@/config/index.js';

import { findSample, messageOf, statOf } from './sample.js';

/**
 * То, что CLI получает от ESLint-конфига. `settings` — сырая секция, ее формат знает
 * `src/settings/`; `options` — опции правила WELD из того же конфига, которые при линте перекрывают
 * `settings.weld`; `sampleOf` — аргумент директории в том виде, как его ввели.
 */
export type LintSettings = {
    filePath: string;
    settings: unknown;
    options?: WeldResolveOptions;
    sampleOf?: string;
};

/** Сообщение для проекта, в котором `eslint` не установлен: стектрейс тут ничего не объясняет. */
const ESLINT_MISSING = 'eslint is not installed in this project';

/** Имя пакета, который CLI ищет в проекте пользователя. */
const ESLINT_PACKAGE = 'eslint';

/**
 * Якорь для `createRequire`: сам файл не читается, важна только его директория — `createRequire`
 * строит от пути отправную точку поиска `node_modules`, и для этого хватает имени файла, которого
 * заведомо нет. Реальный файл (скажем, `package.json` проекта) навязывал бы лишние условия: его
 * поле `type` меняет вид модуля для резолвера.
 */
const REQUIRE_ANCHOR = 'noop.js';

function isNotFoundModuleError(error: unknown): boolean {
    const code = (error as { code?: unknown }).code;
    return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
}

/**
 * `eslint` из проекта пользователя. Сначала путь резолвится от `cwd` (обычный `require.resolve` из
 * директории проекта), и только найденный файл импортируется: так `ERR_MODULE_NOT_FOUND` означает
 * именно отсутствие пакета, а не промах относительного импорта.
 */
async function importEslint(cwd: string) {
    let entry: string;

    try {
        entry = createRequire(join(cwd, REQUIRE_ANCHOR)).resolve(ESLINT_PACKAGE);
    } catch (error) {
        if (isNotFoundModuleError(error)) {
            throw new Error(ESLINT_MISSING, { cause: error });
        }

        throw new Error(`eslint could not be resolved from ${cwd}: ${messageOf(error)}`, {
            cause: error,
        });
    }

    try {
        return await import(pathToFileURL(entry).href);
    } catch (error) {
        throw new Error(`eslint could not be loaded from ${cwd}: ${messageOf(error)}`, {
            cause: error,
        });
    }
}

/** `ESLint` из проекта: `loadESLint()` берет flat-конфиг и на ESLint 9, и на ESLint 10. */
async function createEslint(cwd: string): Promise<ESLint> {
    const { loadESLint } = await importEslint(cwd);
    const ESLintCtor = await loadESLint();

    return new ESLintCtor({ cwd });
}

/**
 * Отсутствие конфига в проекте ESLint помечает `messageTemplate`, а не только текстом: текст правила
 * еще и переводят, а признак — часть API. Регэксп остается запасным вариантом для версий, где
 * `messageTemplate` у этой ошибки нет.
 */
function isMissingConfigError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const { messageTemplate } = error as { messageTemplate?: unknown };
    return (
        messageTemplate === 'config-file-missing' ||
        /could not find config file/i.test(error.message)
    );
}

/**
 * Конфиг конкретного файла. Отсутствие конфига в проекте и игнорируемый файл — разные ошибки:
 * первое означает, что CLI нечего показать, второе — что файл вне зоны действия ESLint.
 */
async function configForFile(
    eslint: ESLint,
    filePath: string,
    shownPath: string,
): Promise<Linter.Config | undefined> {
    try {
        return await eslint.calculateConfigForFile(filePath);
    } catch (error) {
        if (!isMissingConfigError(error)) {
            throw error;
        }

        throw new Error(`no eslint config found for ${shownPath}`, { cause: error });
    }
}

/**
 * Опции правила WELD из эффективного конфига: при линте они перекрывают `settings.weld`, поэтому
 * CLI обязан передать их в резолв, иначе показал бы не ту конфигурацию, которую видит правило.
 * Несколько правил `weld/*` с разными опциями — редкость; берется первое по порядку конфига.
 */
function weldOptions(config: Linter.Config): WeldResolveOptions | undefined {
    for (const [name, entry] of Object.entries(config.rules ?? {})) {
        if (!name.startsWith('weld/') || !Array.isArray(entry)) {
            continue;
        }

        const [, options] = entry as [unknown, unknown];

        if (options !== null && typeof options === 'object') {
            return options as WeldResolveOptions;
        }
    }

    return undefined;
}

/** Настройки и опции файла: `settings.weld` вместе с опциями правила, если они в конфиге есть. */
function settingsOf(config: Linter.Config): Omit<LintSettings, 'filePath'> {
    const options = weldOptions(config);

    return options === undefined
        ? { settings: config.settings }
        : { settings: config.settings, options };
}

/**
 * Настройки ESLint для файла или директории. Путь резолвится от `cwd`; для директории берется
 * сэмпл — первый линтуемый файл, потому что эффективный конфиг спрашивается у файла, а не у
 * директории.
 */
export async function loadLintSettings(path: string, cwd: string): Promise<LintSettings> {
    const target = resolve(cwd, path);
    const stats = statOf(target);

    if (stats === null) {
        throw new Error(`path does not exist: ${path}`);
    }

    const eslint = await createEslint(cwd);

    if (!stats.isDirectory()) {
        const config = await configForFile(eslint, target, path);

        if (config === undefined) {
            throw new Error(`eslint ignores ${path}`);
        }

        return { filePath: target, ...settingsOf(config) };
    }

    const sample = await findSample(target, path, (filePath) =>
        configForFile(eslint, filePath, path),
    );

    if (sample === null) {
        throw new Error(`no lintable files in ${path}`);
    }

    return { filePath: sample.filePath, ...settingsOf(sample.result), sampleOf: path };
}
