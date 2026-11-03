/**
 * Схема слоев проекта: разбор `srcDir`, `modulesDir`, `layers` и `moduleLayers` и проверка их
 * совместности.
 *
 * Схема — не набор независимых настроек, а один объект: `layers` и `moduleLayers` осмысленны только
 * вместе (метка `@modules` связывает списки, имена не повторяются между ними), поэтому проверяются
 * они вместе, а наружу слой отдает разобранную схему целиком. Чтение значений из `settings.weld` /
 * опций и кэш успешного разбора живут в `src/settings/weld.ts` — здесь чистый разбор уже добытых
 * значений.
 */

import { resolvePath } from '@/path/index.js';

/** Метка места слоев модулей в `layers` — не имя директории. */
const MODULES_MARKER = '@modules';

/** Метка кода, не относящегося ни к одному слою проекта. */
export const UNKNOWN_MARKER = '@unknown';

type LayerMarker = typeof MODULES_MARKER | typeof UNKNOWN_MARKER;

/** Разобранная схема слоев. */
export type Scheme = {
    /** Виртуальный путь директории исходного кода от корня репозитория. */
    srcDir: string;
    /** Имя директории-контейнера модулей — и в `srcDir`, и внутри каждого модуля. */
    modulesDir: string;
    /** Слои проекта сверху вниз; метки стоят в том же списке на своих позициях. */
    layers: readonly string[];
    /** Слои модулей сверху вниз — одинаковые для всех модулей и на любой глубине вложенности. */
    moduleLayers: readonly string[];
};

/** Поля схемы: по ним же называются источники значений в сообщениях об ошибках. */
export type SchemeField = keyof Scheme;

/** Те же поля списком — для обходов в рантайме: из него собирается ключ кэша схемы. */
export const SCHEME_FIELDS: readonly SchemeField[] = [
    'srcDir',
    'modulesDir',
    'layers',
    'moduleLayers',
];

/** Сырые значения полей схемы: типы проверяются при разборе. */
export type RawScheme = Record<SchemeField, unknown>;

/** Имя слоя: буква, дальше буквы, цифры, `.`, `-`, `_`. */
const LAYER_NAME = /^[\p{L}][\p{L}\p{N}._-]*$/u;

/**
 * В имени директории модулей недопустимы разделители пути, `@` (занят метками) и `:` (разделитель
 * имен модулей в выводе).
 */
const INVALID_DIR_CHARS = /[/\\@:]/;

/** Состояние значения в диагностическом отчете. */
export type SettingState<T = unknown> =
    | { status: 'value'; value: T }
    | { status: 'invalid'; message: string }
    | { status: 'unresolved'; dependency: string }
    | { status: 'not-set' };

/** Отчет по схеме: состояние каждого поля. */
export type SchemeReport = {
    srcDir: SettingState<string>;
    modulesDir: SettingState<string>;
    layers: SettingState<readonly string[]>;
    moduleLayers: SettingState<readonly string[]>;
};

/**
 * Разбирает схему из уже добытых значений. `sourceOf` называет место значения в конфиге
 * (`settings.weld.layers` или `options.layers`) — источники полей могут быть разными, поэтому имя
 * спрашивается на каждое поле отдельно. Значения по умолчанию подставляет вызывающий: у `srcDir` и
 * `modulesDir` они есть, у списков — нет, и отсутствие списка здесь ошибка.
 */
export function parseScheme(raw: RawScheme, sourceOf: (field: SchemeField) => string): Scheme {
    const srcDirSource = sourceOf('srcDir');
    const modulesDirSource = sourceOf('modulesDir');
    const layersSource = sourceOf('layers');
    const moduleLayersSource = sourceOf('moduleLayers');

    const srcDir = parseSrcDir(raw.srcDir, srcDirSource);
    const modulesDir = parseModulesDir(raw.modulesDir, modulesDirSource);
    const layers = parseProjectLayers(raw.layers, layersSource, modulesDir);
    const moduleLayers = parseModuleLayers(raw.moduleLayers, moduleLayersSource, modulesDir);

    checkModuleLayersPlacement(layers, layersSource);
    checkSharedNames(layers, layersSource, moduleLayers, moduleLayersSource);

    return { srcDir, modulesDir, layers, moduleLayers };
}

function isMarker(name: string): name is LayerMarker {
    return name === MODULES_MARKER || name === UNKNOWN_MARKER;
}

/** `srcDir` — путь от корня репозитория; `null` от `resolvePath` — выход выше корня. */
function parseSrcDir(value: unknown, source: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${source} must be a string, got ${typeof value}`);
    }

    const resolved = resolvePath('/', value);
    if (resolved === null) {
        throw new Error(`${source} must not point above the repository root, got "${value}"`);
    }

    return resolved;
}

/** `modulesDir` — имя одной директории: точка внутри имени разрешена, `.` и `..` — нет. */
function parseModulesDir(value: unknown, source: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${source} must be a string, got ${typeof value}`);
    }

    if (value === '') {
        throw new Error(`${source} must not be empty`);
    }

    if (value === '.' || value === '..' || INVALID_DIR_CHARS.test(value)) {
        throw new Error(
            `${source} must be a single directory name without "/", "\\", "@" or ":", not "." or "..", got "${value}"`,
        );
    }

    return value;
}

/**
 * Слои проекта: повторы обычных имен разрешены и сохраняются в исходном порядке — будущее правило
 * прочитает повтор как диапазон, а не как ошибку. Метки допустимы, каждая не более одного раза.
 */
function parseProjectLayers(value: unknown, source: string, modulesDir: string): string[] {
    const seenMarkers = new Set<LayerMarker>();

    return readLayerList(value, source).map((item, index) => {
        const name = parseLayerName(item, index, source, modulesDir);

        if (isMarker(name)) {
            if (seenMarkers.has(name)) {
                throw new Error(`${source}[${index}]: "${name}" marker is allowed only once`);
            }

            seenMarkers.add(name);
        }

        return name;
    });
}

/** Слои модулей: метки сюда не пишутся — их место в `layers`. */
function parseModuleLayers(value: unknown, source: string, modulesDir: string): string[] {
    return readLayerList(value, source).map((item, index) => {
        const name = parseLayerName(item, index, source, modulesDir);

        if (isMarker(name)) {
            throw new Error(`${source}[${index}]: "${name}" marker is not allowed here`);
        }

        return name;
    });
}

/** Сырой список слоев: обязателен, массив и не пуст. Тип элементов проверяет {@link parseLayerName}. */
function readLayerList(value: unknown, source: string): readonly unknown[] {
    if (value === undefined) {
        throw new Error(`${source} is required`);
    }

    if (!Array.isArray(value)) {
        throw new Error(`${source} must be an array of strings, got ${typeof value}`);
    }

    if (value.length === 0) {
        throw new Error(`${source} must not be empty`);
    }

    return value as readonly unknown[];
}

/** Имя из `value[index]`: строка допустимой формы, не совпадающая с `modulesDir`. */
function parseLayerName(item: unknown, index: number, source: string, modulesDir: string): string {
    if (typeof item !== 'string') {
        throw new Error(`${source}[${index}] must be a string, got ${typeof item}`);
    }

    if (!isMarker(item) && !LAYER_NAME.test(item)) {
        throw new Error(`${source}[${index}] is not a valid layer name: "${item}"`);
    }

    if (item === modulesDir) {
        throw new Error(`${source}[${index}]: "${item}" must not be the modulesDir name`);
    }

    return item;
}

/** Слоям модулей нужна позиция в схеме проекта: без `@modules` их некуда поставить. */
function checkModuleLayersPlacement(layers: readonly string[], layersSource: string): void {
    if (!layers.includes(MODULES_MARKER)) {
        throw new Error(`${layersSource} must contain the "${MODULES_MARKER}" marker`);
    }
}

/** Одно имя в обоих списках неразличимо в дереве: директория читалась бы то так, то иначе. */
function checkSharedNames(
    layers: readonly string[],
    layersSource: string,
    moduleLayers: readonly string[],
    moduleLayersSource: string,
): void {
    const projectNames = new Set(layers.filter((name) => !isMarker(name)));

    for (const [index, name] of moduleLayers.entries()) {
        if (projectNames.has(name)) {
            throw new Error(
                `${moduleLayersSource}[${index}]: "${name}" is also listed in ${layersSource}`,
            );
        }
    }
}

/**
 * Небросающий разбор схемы: каждое поле получает состояние `value`, `invalid`, `unresolved`
 * или `not-set`. Правила и порядок проверок совпадают с бросающим `parseScheme`; отличие —
 * ошибки собираются, а не бросаются.
 *
 * Порядок проверок на элемент: собственный формат (тип, имя, метки), затем зависимость от
 * `modulesDir`. Совместные проверки (`@modules`, общие имена) выполняются, только когда оба
 * списка разрешились в `value`.
 */
export function parseSchemeReport(
    raw: RawScheme,
    sourceOf: (field: SchemeField) => string,
): SchemeReport {
    const srcDirSource = sourceOf('srcDir');
    const modulesDirSource = sourceOf('modulesDir');
    const layersSource = sourceOf('layers');
    const moduleLayersSource = sourceOf('moduleLayers');

    // srcDir — независимое поле
    let srcDirState: SettingState<string>;
    try {
        srcDirState = { status: 'value', value: parseSrcDir(raw.srcDir, srcDirSource) };
    } catch (e) {
        srcDirState = { status: 'invalid', message: (e as Error).message };
    }

    // modulesDir — независимое поле
    let modulesDirState: SettingState<string>;
    let modulesDirValue: string | null = null;
    try {
        modulesDirValue = parseModulesDir(raw.modulesDir, modulesDirSource);
        modulesDirState = { status: 'value', value: modulesDirValue };
    } catch (e) {
        modulesDirState = { status: 'invalid', message: (e as Error).message };
    }

    // Списки: собственный формат → зависимость от modulesDir
    let layersState = parseListReport(raw.layers, layersSource, modulesDirValue, true);
    let moduleLayersState = parseListReport(
        raw.moduleLayers,
        moduleLayersSource,
        modulesDirValue,
        false,
    );

    // Совместные проверки — только когда оба списка в состоянии value
    if (layersState.status === 'value' && moduleLayersState.status === 'value') {
        if (!layersState.value.includes(MODULES_MARKER)) {
            layersState = {
                status: 'invalid',
                message: `${layersSource} must contain the "${MODULES_MARKER}" marker`,
            };
        } else {
            const projectNames = new Set(layersState.value.filter((n) => !isMarker(n)));
            for (const [i, name] of moduleLayersState.value.entries()) {
                if (projectNames.has(name)) {
                    moduleLayersState = {
                        status: 'invalid',
                        message: `${moduleLayersSource}[${i}]: "${name}" is also listed in ${layersSource}`,
                    };
                    break;
                }
            }
        }
    }

    return {
        srcDir: srcDirState,
        modulesDir: modulesDirState,
        layers: layersState,
        moduleLayers: moduleLayersState,
    };
}

/**
 * Небросающий разбор списка слоев. `isProjectLayers` определяет, допускаются ли метки.
 * Порядок проверок на элемент совпадает с `parseLayerName` + маркерной проверкой.
 */
function parseListReport(
    value: unknown,
    source: string,
    modulesDir: string | null,
    isProjectLayers: boolean,
): SettingState<readonly string[]> {
    if (value === undefined) {
        return { status: 'not-set' };
    }

    if (!Array.isArray(value)) {
        return {
            status: 'invalid',
            message: `${source} must be an array of strings, got ${typeof value}`,
        };
    }

    if (value.length === 0) {
        return { status: 'invalid', message: `${source} must not be empty` };
    }

    const parsed: string[] = [];
    const seenMarkers = new Set<LayerMarker>();

    for (let i = 0; i < value.length; i++) {
        const item = value[i];

        if (typeof item !== 'string') {
            return {
                status: 'invalid',
                message: `${source}[${i}] must be a string, got ${typeof item}`,
            };
        }

        if (isMarker(item)) {
            if (isProjectLayers) {
                if (seenMarkers.has(item as LayerMarker)) {
                    return {
                        status: 'invalid',
                        message: `${source}[${i}]: "${item}" marker is allowed only once`,
                    };
                }
                seenMarkers.add(item as LayerMarker);
            } else {
                return {
                    status: 'invalid',
                    message: `${source}[${i}]: "${item}" marker is not allowed here`,
                };
            }
        } else {
            if (!LAYER_NAME.test(item)) {
                return {
                    status: 'invalid',
                    message: `${source}[${i}] is not a valid layer name: "${item}"`,
                };
            }
            if (modulesDir !== null && item === modulesDir) {
                return {
                    status: 'invalid',
                    message: `${source}[${i}]: "${item}" must not be the modulesDir name`,
                };
            }
        }

        parsed.push(item);
    }

    if (modulesDir === null) {
        return { status: 'unresolved', dependency: 'modulesDir' };
    }

    return { status: 'value', value: parsed };
}
