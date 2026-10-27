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
 *
 * Остальные ошибки отдаются как есть: причину знает сам ESLint, а обертка скрыла бы ее от пользователя.
 *
 * Экспортируется ради unit-теста: настоящая ошибка загрузки зависит от версии ESLint и Node, а
 * отображение текста — нет.
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

/** Секция `settings.weld` из сырых `settings` конфига: остальные ключи CLI не читает. */
function weldSettingsOf(config: Linter.Config): unknown {
    return config.settings?.weld;
}

/**
 * Задает ли эффективный конфиг файла настройки WELD: `settings.weld` или опции правил `weld/*`. Это и
 * есть признак «файл попал под тот слой конфига, который описывает настройки директории». Глобальный
 * слой (`weld.configs.recommended`, общий `{ rules }`) доходит до любого линтуемого файла, но настроек
 * в нем нет — этим tool-конфиг от файлов директории и отличается.
 */
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
 * Предикат обхода директории за сэмплом. Политика выбора живет здесь, а не в `loadLintSettings` и не
 * в обходе: `sample.ts` отвечает за порядок и бюджет, `loadLintSettings` — за путь, конфиг и
 * инстансы ESLint.
 *
 * Сэмплом становится файл, которому примененный конфиг задает настройки WELD; все отказы — следствия
 * этого требования:
 *
 * - `eslint.config.*` — конфиг, а не файл проекта: он сортируется раньше `src/`, и `weld config
 *   <директория>` печатал бы настройки самого конфига. Исключается любой `eslint.config.*` по имени,
 *   а не только найденный: под конфиг без `files` попадает любой `.mjs` рядом, включая не входящий в
 *   `CONFIG_FILE_NAMES`.
 * - файл под чужим конфигом: конфиг выбирается по пути, поэтому прямой запрос `weld config <файл>`
 *   нашел бы вложенный конфиг пакета, и пара `file:`/`config:` описывала бы разные конфиги одного
 *   файла. С `--config` расхождения нет: указанный конфиг применяется к любому пути под `cwd`.
 * - файл, к которому конфиг ничего не добавляет, не годится даже отложенным кандидатом: настроек
 *   директории он не несет.
 *
 * Файл без `settings.weld` и без опций `weld/*` откладывается и уступает любому файлу, которому
 * настройки достаются: глобальный слой (`weld.configs.recommended`, общий `{ rules }`) делает
 * непустым конфиг любого линтуемого файла, поэтому `jest.config.js` из корня проекта иначе стал бы
 * сэмплом.
 */
function createSampleLookup(options: SampleLookupOptions): SampleLookup {
    const { userCwd, baseDir, configFile, searched, eslint } = options;

    // Ответ инстанса без конфига — чистые значения ESLint по умолчанию, с которыми сравнивается
    // конфиг файла. Нужен только отложенной ветке, поэтому и создается при первой надобности: файлу
    // с настройками WELD он ничего не скажет.
    let withoutConfig: Promise<ESLint> | null = null;

    // Ближайший конфиг спрашивается на каждый файл, а обход идет по тысячам записей: без запоминания
    // подъем до корня ФС повторялся бы для каждого кандидата из одной директории.
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

        // Файл, к которому выбранный конфиг ничего не добавляет: для файлов вне шаблонов `files` (и
        // без глобального слоя) ESLint отдает ровно те же значения, что и без конфига вовсе, —
        // настроек директории такой файл не представляет. Проверка стоит только здесь: файлу с
        // настройками WELD она отказать не может, потому что в конфиге без конфига этих настроек нет.
        withoutConfig ??= createEslint(userCwd, { cwd: baseDir, overrideConfigFile: true });
        const defaults = await configForFile(await withoutConfig, configFile, filePath);

        if (isDeepStrictEqual(config, defaults)) {
            return undefined;
        }

        // Глобальный слой конфига (`weld.configs.recommended`, общий `{ rules }`) делает непустым
        // конфиг любого линтуемого файла, поэтому проверки выше tool-конфиг в корне проекта не
        // отсеивают: `jest.config.js` сортируется раньше `src/` и печатал бы `aliases: (none)` вместо
        // настроек директории. Представителя директории определяет то, что он несет: файл без
        // `settings.weld` и без опций `weld/*` откладывается и уступает любому такому файлу.
        withoutSettings ??= { filePath, result: config };

        return undefined;
    };

    return { lookup, remembered: () => withoutSettings };
}

/**
 * Настройки ESLint для файла или директории. Путь резолвится от `cwd`, конфиг ищется вверх от
 * директории цели (у файла — от его директории): для директории он выбирается по самому пути, а
 * сэмпл — лишь представительский файл, чьи настройки читаются. Сэмпл обязан нести настройки WELD
 * выбранного конфига, а не просто быть линтуемым: иначе `file:` и `config:` описывали бы разные
 * конфиги одного файла либо настройки другого файла (см. `createSampleLookup`). `config` (флаг
 * `--config`) отменяет поиск и ведет себя как `eslint --config`.
 *
 * `cwd` инстанса — директория найденного конфига: тогда `basePath` шаблонов `files`/`ignores`
 * совпадает с тем, что ESLint нашел бы сам, а найденный нами конфиг гарантированно применяется.
 * Без этого на ESLint 9 из корня монорепа действовал бы корневой конфиг вместо пакетного.
 * Явный `--config` оставляет `cwd` пользователя — ровно как `eslint --config`: файл под `cwd` всё
 * равно получает его настройки, а путь вне `cwd` конфиг не покрывает — об этом и сообщается.
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

    // База шаблонов `files`/`ignores`: директория конфига при поиске, `cwd` при явном `--config`.
    // При поиске цель всегда внутри базы (конфиг найден выше нее), а при `--config` — нет.
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

    // Отложенный кандидат отвечает, только если годного с настройками WELD не нашлось нигде, — в том
    // числе когда обход просто закончился, ничего не отметив.
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
