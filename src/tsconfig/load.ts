/**
 * Автопоиск ближайшего `tsconfig.json` и извлечение `compilerOptions.paths`.
 *
 * Второй «пограничный» модуль наряду с `src/host/`: знает формат tsconfig **и** читает диск (через
 * `get-tsconfig`). Наружу отдаёт **реальные** пути: виртуализация возможна только после фиксации
 * root, а root у вызывающей стороны сам зависит от найденных здесь якорей.
 *
 * Любая проблема tsconfig (не нашёлся, не распарсился, нет `paths`) — это `null`, а не исключение:
 * кривой tsconfig не должен валить линт, причина уходит в debug.
 */

import path from 'node:path';

import { getTsconfig } from 'get-tsconfig';
import type { TsConfigResult } from 'get-tsconfig';

import { createLogger } from '@/debug.js';
import { segments, toPosix } from '@/path/index.js';
import { hasValidStarShape, stripStarSuffix } from '@/settings/index.js';

const debug = createLogger('tsconfig');

/** Результат поиска: сырые `paths` (валидация — дело `src/settings/`) и реальные пути. */
export type TsconfigPaths = {
    /** `compilerOptions.paths` как есть — формат значений проверяет вызывающая сторона. */
    paths: Record<string, unknown>;
    /** Реальная директория, от которой отсчитываются записи `paths`: директория конфига + его `baseUrl`. */
    realBaseDir: string;
    /** Реальный путь найденного tsconfig — для `source` сообщений разбора и debug. */
    configPath: string;
    /**
     * Реальные якоря записей `paths` — для инварианта «root покрывает якоря»: каждое строковое
     * значение, резолвнутое от `realBaseDir` без хвоста `/*`. Якоря внутри `node_modules` исключены:
     * root они поднимать не должны (в сами алиасы такие записи всё равно попадают — их судьбу решает
     * общая валидация у вызывающего).
     */
    realAnchors: string[];
};

type CacheEntry = { value: TsconfigPaths | null; expiresAt: number };

type LoadTsconfigOptions = {
    /** Шов для тестов TTL — по образцу `createFsHost`. */
    now?: () => number;
    /** Шов для тестов: подмена чтения диска (по умолчанию — `getTsconfig` из `get-tsconfig`). */
    read?: (searchDir: string) => TsConfigResult | null;
};

/**
 * TTL мемоизации «директория файла → результат», то же значение, что `TTL_MS` в `src/host/fs.ts`:
 * tsconfig правят руками чаще, чем создают `index.ts`, а вечный кэш в долгоживущем ESLint
 * редактора неприемлем.
 */
const TTL_MS = 600_000;

const cache = new Map<string, CacheEntry>();

/**
 * Ищет ближайший `tsconfig.json` вверх от директории `realFilePath` (реальный путь линтуемого
 * файла) и возвращает его `paths` с базой. Неабсолютный/синтетический путь (`<input>` из
 * RuleTester) → сразу `null`. Отсев «tsconfig вне явного root» — дело вызывающей стороны.
 */
export function loadTsconfigPaths(
    realFilePath: string,
    options: LoadTsconfigOptions = {},
): TsconfigPaths | null {
    if (!path.isAbsolute(realFilePath)) {
        debug('skip tsconfig lookup: file path is not absolute: %s', realFilePath);
        return null;
    }

    const dir = path.dirname(realFilePath);
    const now = options.now ?? Date.now;

    const time = now();
    const entry = cache.get(dir);
    if (entry && entry.expiresAt > time) {
        return entry.value;
    }

    // Кэш самого `get-tsconfig` (`Map` из его API) живёт **один** промах TTL-кэша: внутри вызова он
    // спасает от повторного чтения `extends`-цепочки, но переживи он TTL-запись — `getTsconfig`
    // после истечения TTL отдавал бы устаревшее содержимое файлов, и правки tsconfig не
    // подхватывались бы до конца жизни процесса.
    const readCache = new Map<string, unknown>();
    const read =
        options.read ?? ((searchDir: string) => getTsconfig(searchDir, 'tsconfig.json', readCache));

    const value = readTsconfigPaths(dir, read);
    cache.set(dir, { value, expiresAt: time + TTL_MS });
    return value;
}

function readTsconfigPaths(
    dir: string,
    read: (searchDir: string) => TsConfigResult | null,
): TsconfigPaths | null {
    let found: TsConfigResult | null;
    try {
        found = read(dir);
    } catch (error) {
        debug('failed to read tsconfig near %s: %s', dir, error);
        return null;
    }

    if (!found) {
        debug('no tsconfig found upwards from %s', dir);
        return null;
    }

    const configPath = found.path;
    const compilerOptions: Record<string, unknown> = found.config.compilerOptions ?? {};
    const paths = compilerOptions['paths'];
    if (typeof paths !== 'object' || paths === null || Object.keys(paths).length === 0) {
        debug('tsconfig %s has no compilerOptions.paths', configPath);
        return null;
    }

    // `get-tsconfig` уже переписал `baseUrl` относительно найденного конфига (включая `extends`
    // и `${configDir}`). Без `baseUrl` записи `paths` по правилам TypeScript отсчитываются от
    // директории конфига, **объявившего** `paths` (при `extends` это не обязательно найденный
    // конфиг) — её `get-tsconfig` отдаёт symbol-свойством `implicitBaseUrl` на `compilerOptions`.
    const baseUrl =
        typeof compilerOptions['baseUrl'] === 'string' ? compilerOptions['baseUrl'] : undefined;
    const realBaseDir =
        baseUrl !== undefined
            ? path.resolve(path.dirname(configPath), baseUrl)
            : (getImplicitBaseUrl(compilerOptions) ?? path.dirname(configPath));

    const record = relativizePathsValues(paths as Record<string, unknown>, realBaseDir);
    debug('found paths in %s, base dir %s', configPath, realBaseDir);
    return {
        paths: record,
        realBaseDir,
        configPath,
        realAnchors: collectRealAnchors(record, realBaseDir),
    };
}

/**
 * `implicitBaseUrl` — приватный symbol `get-tsconfig` на `compilerOptions`: реальная директория
 * конфига, объявившего `paths` (его собственный `createPathsMatcher` резолвит от неё же).
 *
 * Завязка на внутренности `get-tsconfig` осознанная: диапазон `^4.14.3` в `package.json` выбран под
 * это поведение, а его исчезновение поймает тест про `extends` без `baseUrl` в `load.test.ts` —
 * тогда сработал бы fallback на директорию найденного конфига, и якоря записей `paths` из
 * `extends`-базы посчитались бы от чужой директории.
 */
function getImplicitBaseUrl(compilerOptions: object): string | undefined {
    const symbol = Object.getOwnPropertySymbols(compilerOptions).find(
        (candidate) => candidate.description === 'implicitBaseUrl',
    );
    const value =
        symbol === undefined ? undefined : (compilerOptions as Record<symbol, unknown>)[symbol];
    return typeof value === 'string' ? value : undefined;
}

/**
 * Реальный абсолютный путь: unix (`/…`) или Windows-диск (`C:…`). Сосед `isAbsoluteRealPath` из
 * `src/host/fs.ts` отвечает на тот же вопрос, но про уже нормализованные `toPosix`-пути и наружу из
 * слоя не выходит; здесь проверяются сырые строки из tsconfig — два «пограничных» модуля держат по
 * своей проверке.
 */
const ABSOLUTE_REAL_PATH = /^(?:\/|[A-Za-z]:)/;

/**
 * Подстановку `${configDir}` `get-tsconfig` разворачивает в **абсолютные реальные** пути прямо в
 * значениях `paths`. Дальше по конвейеру значения трактуются как записи относительно
 * (виртуализированного) `realBaseDir`, поэтому абсолютные значения переписываются в относительные
 * от него; остальные значения проходят как есть.
 */
function relativizePathsValues(
    paths: Record<string, unknown>,
    realBaseDir: string,
): Record<string, unknown> {
    const relativize = (item: unknown): unknown => {
        if (typeof item !== 'string' || !ABSOLUTE_REAL_PATH.test(item)) {
            return item;
        }

        const relative = toPosix(path.relative(realBaseDir, item));
        if (relative === '') {
            return '.';
        }
        // `${configDir}/*`, указывающий в саму базу, даёт голую `*` — без префикса `./` такая
        // запись не пройдёт проверку формы `/*` и алиас в корень проекта молча потерялся бы.
        return relative.startsWith('*') ? `./${relative}` : relative;
    };

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(paths)) {
        result[key] = Array.isArray(value) ? value.map(relativize) : relativize(value);
    }
    return result;
}

/**
 * Реальные якоря записей `paths` — см. {@link TsconfigPaths.realAnchors}. Нестроковые значения
 * молча пропускаются: их отбраковка с сообщением — дело разбора алиасов, а не расчёта root. Ключи
 * и значения, которые разбор алиасов отбросит по форме `*` (`hasValidStarShape` из
 * `src/settings/`), пропускаются по той же причине: поднимать root ради якоря записи, которую
 * разбор потом отбросит, нельзя.
 */
function collectRealAnchors(paths: Record<string, unknown>, realBaseDir: string): string[] {
    const anchors = new Set<string>();

    for (const [key, value] of Object.entries(paths)) {
        if (!hasValidStarShape(key)) {
            continue;
        }

        // Строка вместо массива — частая опечатка; нестроковое значение отсеет проверка ниже.
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
            if (typeof item !== 'string' || !hasValidStarShape(item)) {
                continue;
            }

            const anchor = path.resolve(realBaseDir, stripStarSuffix(item));
            if (segments(toPosix(anchor)).includes('node_modules')) {
                debug('anchor %s is inside node_modules, excluded from root computation', anchor);
                continue;
            }
            anchors.add(anchor);
        }
    }

    return [...anchors];
}

/** Сбрасывает TTL-кэш — для изоляции тестов. */
export function resetTsconfigCache(): void {
    cache.clear();
}
