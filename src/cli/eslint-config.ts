/**
 * Единственное место CLI, которое знает про ESLint: путь → `settings` эффективного ESLint-конфига.
 * Наружу отдается `LintSettings`, а не `Linter.Config`.
 */

import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import type { ESLint, Linter } from 'eslint';

import type { WeldResolveOptions } from '@/config/index.js';

import { findConfigFile, isConfigFileName, resolveConfigFile } from './config-file.js';
import type { Sample } from './sample.js';
import { findSample, messageOf, statOf } from './sample.js';
import { isInside } from './target.js';

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

const ESLINT_MISSING = 'eslint is not installed in this project';

const ESLINT_PACKAGE = 'eslint';

/** Якорь для `createRequire`: важен только путь, от которого ищется `node_modules`. */
const REQUIRE_ANCHOR = 'noop.js';

function isNotFoundModuleError(error: unknown): boolean {
    const code = (error as { code?: unknown }).code;
    return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
}

/** `eslint` из проекта пользователя: путь резолвится от `cwd`, импортируется найденный файл. */
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
async function createEslint(
    userCwd: string,
    eslintOptions: { cwd: string; overrideConfigFile: string | true },
): Promise<ESLint> {
    const { loadESLint } = await importEslint(userCwd);
    const ESLintCtor = await loadESLint();

    return new ESLintCtor(eslintOptions);
}

/**
 * Ошибка загрузки конфига в понятном виде. Обе причины отказа от TS-конфига приходят из движка
 * строкой без объяснения, что делать пользователю CLI:
 *
 * - `Unknown file extension ".ts"` — нативный `import()` не умеет TypeScript. Так ведет себя ESLint 9
 *   на Node без нативной поддержки TS (до 22.18): сам ESLint грузит `.ts`-конфиг только по флагу
 *   `unstable_ts_config`, а флаги ESLint через `weld` не пробрасываются.
 * - `The 'jiti' library is required…` — ESLint 10 грузит TS-конфиг через `jiti`, а тот подключен
 *   необязательным peer-ом и в пакет ESLint не входит.
 */
export function explainConfigLoadError(error: unknown, configFile: string): Error {
    if (!(error instanceof Error)) {
        return new Error(messageOf(error));
    }

    if (/unknown file extension "\.[mc]?ts"/i.test(error.message)) {
        return new Error(
            `eslint config ${configFile} is a TypeScript file and this Node.js version cannot import ` +
                'it: point `--config` at a JavaScript config, or run on a Node.js version that imports ' +
                'TypeScript natively (22.18+)',
            { cause: error },
        );
    }

    if (/the 'jiti' library is required/i.test(error.message)) {
        return new Error(
            `eslint config ${configFile} is a TypeScript file and ESLint needs the ` +
                "'jiti' library to load it: install `jiti`, or point `--config` at a JavaScript config",
            { cause: error },
        );
    }

    return error;
}

/** Конфиг файла; ошибки загрузки отображаются в понятный текст. */
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

/** Опции правила WELD из эффективного конфига; из нескольких правил `weld/*` берется первое. */
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

function settingsOf(config: Linter.Config): Omit<LintSettings, 'filePath' | 'configFile'> {
    const options = weldOptions(config);

    return options === undefined
        ? { settings: config.settings }
        : { settings: config.settings, options };
}

function weldSettingsOf(config: Linter.Config): unknown {
    return config.settings?.weld;
}

/** Задает ли конфиг файла настройки WELD: `settings.weld` или опции правил `weld/*`. */
function hasWeldSettings(config: Linter.Config): boolean {
    return weldSettingsOf(config) !== undefined || weldOptions(config) !== undefined;
}

/** Что предикату обхода нужно знать о проекте, кроме самого файла. */
type SampleLookupOptions = {
    /** `cwd` пользователя: якорь поиска пакета `eslint`, к выбору сэмпла отношения не имеет. */
    userCwd: string;
    /** База шаблонов `files`/`ignores` — `cwd` обоих инстансов ESLint. */
    baseDir: string;
    configFile: string;
    /** Конфиг искали мы сами (без `--config`): только тогда вложенный конфиг — граница. */
    searched: boolean;
    /** ESLint с выбранным конфигом. */
    eslint: ESLint;
};

/** Предикат обхода и то, что он отложил: отложенное берется, только если годного не нашлось. */
type SampleLookup = {
    lookup: (filePath: string) => Promise<Linter.Config | undefined>;
    remembered: () => Sample<Linter.Config> | null;
};

/**
 * Предикат обхода директории за сэмплом: сэмплом становится файл, которому примененный конфиг задает
 * настройки WELD. Глобальный слой конфига доходит до любого линтуемого файла, поэтому файл без
 * `settings.weld` и без опций `weld/*` откладывается и уступает любому такому файлу.
 */
function createSampleLookup(options: SampleLookupOptions): SampleLookup {
    const { userCwd, baseDir, configFile, searched, eslint } = options;

    let withoutConfig: Promise<ESLint> | null = null;

    const configsByDir = new Map<string, string | null>();
    const configOfDir = (dir: string): string | null => {
        if (!configsByDir.has(dir)) {
            configsByDir.set(dir, findConfigFile(dir));
        }

        return configsByDir.get(dir) ?? null;
    };

    let withoutSettings: Sample<Linter.Config> | null = null;

    const lookup = async (filePath: string): Promise<Linter.Config | undefined> => {
        if (isConfigFileName(basename(filePath))) {
            return undefined;
        }

        if (searched && configOfDir(dirname(filePath)) !== configFile) {
            return undefined;
        }

        const config = await configForFile(eslint, configFile, filePath);

        if (config === undefined) {
            return undefined;
        }

        if (hasWeldSettings(config)) {
            return config;
        }

        withoutConfig ??= createEslint(userCwd, { cwd: baseDir, overrideConfigFile: true });
        const defaults = await configForFile(await withoutConfig, configFile, filePath);

        if (isDeepStrictEqual(config, defaults)) {
            return undefined;
        }

        withoutSettings ??= { filePath, result: config };

        return undefined;
    };

    return { lookup, remembered: () => withoutSettings };
}

/**
 * Настройки ESLint для файла или директории. Путь резолвится от `cwd`, конфиг ищется вверх от
 * директории цели, для директории читаются настройки сэмпла. `cwd` инстанса — директория конфига,
 * поэтому `basePath` шаблонов `files`/`ignores` тот же, что вычислил бы ESLint. `config` (флаг
 * `--config`) отменяет поиск и ведет себя как `eslint --config`.
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

    const isDirectory = stats.isDirectory();
    const searched = config === undefined;
    const configFile = searched
        ? findConfigFile(isDirectory ? target : dirname(target))
        : resolveConfigFile(config, cwd);

    if (configFile === null) {
        throw new Error(`no eslint config found for ${path}`);
    }

    const baseDir = searched ? dirname(configFile) : cwd;

    if (!isInside(baseDir, target)) {
        throw new Error(
            `${path} is outside the config base directory: files and ignores are counted from ${baseDir}`,
        );
    }

    const eslint = await createEslint(cwd, { cwd: baseDir, overrideConfigFile: configFile });

    if (!isDirectory) {
        const fileConfig = await configForFile(eslint, configFile, target);

        if (fileConfig === undefined) {
            throw new Error(`eslint ignores ${path}`);
        }

        return { filePath: target, configFile, ...settingsOf(fileConfig) };
    }

    const { lookup, remembered } = createSampleLookup({
        userCwd: cwd,
        baseDir,
        configFile,
        searched,
        eslint,
    });

    const sample = (await findSample(target, path, lookup, remembered)) ?? remembered();

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
