/**
 * Единственное место CLI, которое знает про ESLint: путь → `settings` эффективного ESLint-конфига.
 * Наружу отдается минимум (`{ filePath, configFile, settings, options?, sampleOf? }`), а не
 * `Linter.Config`, поэтому `eslint` не течет ни в рендер вывода, ни в команды.
 *
 * `eslint` грузится динамически: статический `import` упал бы на загрузке модуля, до любой
 * диагностики, и в проекте без ESLint пользователь увидел бы стектрейс вместо сообщения. Ищется он
 * в проекте пользователя (от `cwd`), а не рядом с файлом плагина: глобально установленный `weld` или
 * `npx` из другой директории обязан найти тот `eslint`, который в проекте действительно есть.
 *
 * Обход директории за сэмплом и `stat` живут отдельно, в `sample.ts`: у этого модуля одна работа —
 * загрузка `eslint` и чтение его конфига. Поиск самого конфига — в `config-file.ts`.
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ESLint, Linter } from 'eslint';

import type { WeldResolveOptions } from '@/config/index.js';

import { findConfigFile, resolveConfigFile } from './config-file.js';
import { findSample, messageOf, statOf } from './sample.js';

/**
 * То, что CLI получает от ESLint-конфига. `settings` — сырая секция, ее формат знает
 * `src/settings/`; `options` — опции правила WELD из того же конфига, которые при линте перекрывают
 * `settings.weld`; `sampleOf` — аргумент директории в том виде, как его ввели.
 */
export type LintSettings = {
    filePath: string;
    /**
     * Абсолютный путь конфига, чьи настройки ушли наружу. Его печатает `weld config`, и он же —
     * `cwd` инстанса ESLint: шаблоны `files`/`ignores` считаются от директории конфига.
     */
    configFile: string;
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

/**
 * `ESLint` из проекта: `loadESLint()` берет flat-конфиг и на ESLint 9, и на ESLint 10.
 * `userCwd` — только якорь поиска пакета `eslint`; `eslintOptions` — что видит сам ESLint.
 */
async function createEslint(
    userCwd: string,
    eslintOptions: { cwd: string; overrideConfigFile: string },
): Promise<ESLint> {
    const { loadESLint } = await importEslint(userCwd);
    const ESLintCtor = await loadESLint();

    return new ESLintCtor(eslintOptions);
}

/**
 * Ошибка загрузки конфига в понятном виде. На ESLint 9 TS-конфиг падает на нативном `import()`
 * (`Unknown file extension ".ts"`): находить его поиском правильно — так же поступает ESLint 10, — но
 * пользователю нужна причина и выход, а не текст движка. Остальные ошибки отдаются как есть.
 */
export function explainConfigLoadError(error: unknown, configFile: string): Error {
    if (!(error instanceof Error)) {
        return new Error(messageOf(error));
    }

    if (!/unknown file extension "\.[mc]?ts"/i.test(error.message)) {
        return error;
    }

    return new Error(
        `eslint config ${configFile} is a TypeScript file and this ESLint version cannot load it: ` +
            'enable `unstable_ts_config` or point `--config` at a JavaScript config',
        { cause: error },
    );
}

/**
 * Конфиг конкретного файла. Наличие конфига в проекте проверено до создания ESLint, поэтому здесь
 * остаются только ошибки загрузки и `undefined` — файл, который ESLint игнорирует.
 */
async function configForFile(
    eslint: ESLint,
    configFile: string,
    filePath: string,
): Promise<Linter.Config | undefined> {
    try {
        return await eslint.calculateConfigForFile(filePath);
    } catch (error) {
        throw explainConfigLoadError(error, configFile);
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
function settingsOf(config: Linter.Config): Omit<LintSettings, 'filePath' | 'configFile'> {
    const options = weldOptions(config);

    return options === undefined
        ? { settings: config.settings }
        : { settings: config.settings, options };
}

/**
 * Настройки ESLint для файла или директории. Путь резолвится от `cwd`, конфиг ищется вверх от
 * директории цели (у файла — от его директории): для директории он выбирается по самому пути, а
 * сэмпл — лишь представительский файл, чьи настройки читаются. `config` (флаг `--config`) отменяет
 * поиск и ведет себя как `eslint --config`.
 */
export async function loadLintSettings(
    path: string,
    cwd: string,
    config?: string,
): Promise<LintSettings> {
    const target = resolve(cwd, path);
    const stats = statOf(target);

    if (stats === null) {
        throw new Error(`path does not exist: ${path}`);
    }

    const configFile =
        config === undefined
            ? findConfigFile(stats.isDirectory() ? target : dirname(target))
            : resolveConfigFile(config, cwd);

    if (configFile === null) {
        throw new Error(`no eslint config found for ${path}`);
    }

    // `cwd` инстанса — директория найденного конфига: тогда `basePath` шаблонов `files`/`ignores`
    // совпадает с тем, что ESLint нашел бы сам, а найденный нами конфиг гарантированно применяется.
    // Без этого на ESLint 9 из корня монорепа действовал бы корневой конфиг вместо пакетного.
    // Явный `--config` оставляет `cwd` пользователя — ровно как `eslint --config`: файл вне
    // директории конфига все равно получает его настройки.
    const eslint = await createEslint(cwd, {
        cwd: config === undefined ? dirname(configFile) : cwd,
        overrideConfigFile: configFile,
    });

    if (!stats.isDirectory()) {
        const fileConfig = await configForFile(eslint, configFile, target);

        if (fileConfig === undefined) {
            throw new Error(`eslint ignores ${path}`);
        }

        return { filePath: target, configFile, ...settingsOf(fileConfig) };
    }

    const sample = await findSample(target, path, (filePath) =>
        configForFile(eslint, configFile, filePath),
    );

    if (sample === null) {
        throw new Error(`no lintable files in ${path}`);
    }

    return {
        filePath: sample.filePath,
        configFile,
        ...settingsOf(sample.result),
        sampleOf: path,
    };
}
