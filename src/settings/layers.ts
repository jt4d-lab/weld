/**
 * Схема слоев проекта: разбор `srcDir`, `modulesDir`, `layers`, `moduleLayers` и `flatModules` и
 * проверка их совместности.
 *
 * Схема — не набор независимых настроек, а один объект: `layers` и `moduleLayers` осмысленны только
 * вместе (метка `@modules` связывает списки, имена не повторяются между ними), поэтому проверяются
 * они вместе, а наружу слой отдает разобранную схему целиком. Чтение значений из `settings.weld` /
 * опций и кэш успешного разбора живут в `src/settings/weld.ts` — здесь чистый разбор уже добытых
 * значений.
 */

import { resolvePath } from '@/path/index.js';
import type { SettingState } from './state.js';

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
    /** Плоские корневые модули: корневые модули живут прямо в `srcDir`, а не в контейнере. */
    flatModules: boolean;
};

/** Поля схемы: по ним же называются источники значений в сообщениях об ошибках. */
export type SchemeField = keyof Scheme;

/** Те же поля списком — для обходов в рантайме: из него собирается ключ кэша схемы. */
export const SCHEME_FIELDS: readonly SchemeField[] = [
    'srcDir',
    'modulesDir',
    'layers',
    'moduleLayers',
    'flatModules',
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

/** Отчет по схеме: состояние каждого поля. */
export type SchemeReport = {
    srcDir: SettingState<string>;
    modulesDir: SettingState<string>;
    layers: SettingState<readonly string[]>;
    moduleLayers: SettingState<readonly string[]>;
    flatModules: SettingState<boolean>;
};

/** Результат общего обхода списка: отсутствие (отчет решит, что с ним делать), ошибка или разобранные имена. */
type ParsedLayerList =
    { kind: 'not-set' } | { kind: 'error'; message: string } | { kind: 'value'; names: string[] };

/** Элемент списка: имя или метка либо собственный текст ошибки. */
type ParsedLayerItem =
    { ok: true; name: string; marker: LayerMarker | null } | { ok: false; message: string };

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
    const flatModulesSource = sourceOf('flatModules');

    const srcDir = parseSrcDir(raw.srcDir, srcDirSource);
    const modulesDir = parseModulesDir(raw.modulesDir, modulesDirSource);
    const layers = readLayerList(raw.layers, layersSource, modulesDir, true);
    const moduleLayers = readLayerList(raw.moduleLayers, moduleLayersSource, modulesDir, false);
    const flatModules = parseFlatModules(raw.flatModules, flatModulesSource);

    // Сводные проверки — только когда оба списка разобрались: отсутствие одного
    // не делает другой ошибкой.
    const markerProblem = checkModulesMarker(layers, layersSource);
    if (markerProblem !== null) {
        throw new Error(markerProblem);
    }

    const sharedProblem = checkSharedNames(layers, layersSource, moduleLayers, moduleLayersSource);
    if (sharedProblem !== null) {
        throw new Error(sharedProblem);
    }

    return { srcDir, modulesDir, layers, moduleLayers, flatModules };
}

/** `flatModules` — флаг, без него контейнер в корне не распознается. */
function parseFlatModules(value: unknown, source: string): boolean {
    if (typeof value !== 'boolean') {
        throw new Error(`${source} must be a boolean, got ${typeof value}`);
    }

    return value;
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
 * Общий для обоих разборов обход списка. Слои проекта: повторы обычных имен разрешены и
 * сохраняются в исходном порядке — будущее правило прочитает повтор как диапазон, а не как
 * ошибку; метки допустимы, каждая не более одного раза. Слои модулей: метки сюда не пишутся —
 * их место в `layers`. Порядок проверок на элемент один для обеих форм: собственный формат
 * (тип, имя, метка), затем зависимость от `modulesDir` — она пропускается, когда та не
 * разрешилась (`null`): небросающий разбор помечит поле `unresolved`.
 */
function parseLayerList(
    value: unknown,
    source: string,
    modulesDir: string | null,
    isProjectLayers: boolean,
): ParsedLayerList {
    if (value === undefined) {
        return { kind: 'not-set' };
    }

    if (!Array.isArray(value)) {
        return {
            kind: 'error',
            message: `${source} must be an array of strings, got ${typeof value}`,
        };
    }

    if (value.length === 0) {
        return { kind: 'error', message: `${source} must not be empty` };
    }

    const names: string[] = [];
    const seenMarkers = new Set<LayerMarker>();

    for (let i = 0; i < value.length; i++) {
        const item = value[i];
        const parsed = parseLayerItem(item, i, source, modulesDir);
        if (!parsed.ok) {
            return { kind: 'error', message: parsed.message };
        }

        if (parsed.marker !== null) {
            const markerProblem = markerError(
                parsed.marker,
                i,
                source,
                isProjectLayers,
                seenMarkers,
            );
            if (markerProblem !== null) {
                return { kind: 'error', message: markerProblem };
            }
        }

        names.push(parsed.name);
    }

    return { kind: 'value', names };
}

/** Элемент `value[index]`: строка допустимой формы, не совпадающая с `modulesDir`; метка — как есть. */
function parseLayerItem(
    item: unknown,
    index: number,
    source: string,
    modulesDir: string | null,
): ParsedLayerItem {
    if (typeof item !== 'string') {
        return { ok: false, message: `${source}[${index}] must be a string, got ${typeof item}` };
    }

    if (isMarker(item)) {
        return { ok: true, name: item, marker: item };
    }

    if (!LAYER_NAME.test(item)) {
        return { ok: false, message: `${source}[${index}] is not a valid layer name: "${item}"` };
    }

    if (modulesDir !== null && item === modulesDir) {
        return {
            ok: false,
            message: `${source}[${index}]: "${item}" must not be the modulesDir name`,
        };
    }

    return { ok: true, name: item, marker: null };
}

/** Метка в списке: в `moduleLayers` недопустима вовсе, в `layers` — не более одного раза. */
function markerError(
    marker: LayerMarker,
    index: number,
    source: string,
    isProjectLayers: boolean,
    seenMarkers: Set<LayerMarker>,
): string | null {
    if (!isProjectLayers) {
        return `${source}[${index}]: "${marker}" marker is not allowed here`;
    }

    if (seenMarkers.has(marker)) {
        return `${source}[${index}]: "${marker}" marker is allowed only once`;
    }

    seenMarkers.add(marker);
    return null;
}

/** Бросающий читатель списка: отсутствие — «is required», ошибка обхода — исключение с тем же текстом. */
function readLayerList(
    value: unknown,
    source: string,
    modulesDir: string,
    isProjectLayers: boolean,
): string[] {
    const parsed = parseLayerList(value, source, modulesDir, isProjectLayers);

    if (parsed.kind === 'not-set') {
        throw new Error(`${source} is required`);
    }

    if (parsed.kind === 'error') {
        throw new Error(parsed.message);
    }

    return parsed.names;
}

/** Слоям модулей нужна позиция в схеме проекта: без `@modules` их некуда поставить. */
function checkModulesMarker(layers: readonly string[], source: string): string | null {
    if (!layers.includes(MODULES_MARKER)) {
        return `${source} must contain the "${MODULES_MARKER}" marker`;
    }

    return null;
}

/** Одно имя в обоих списках неразличимо в дереве: директория читалась бы то так, то иначе. */
function checkSharedNames(
    layers: readonly string[],
    layersSource: string,
    moduleLayers: readonly string[],
    moduleLayersSource: string,
): string | null {
    const projectNames = new Set(layers.filter((name) => !isMarker(name)));

    for (const [index, name] of moduleLayers.entries()) {
        if (projectNames.has(name)) {
            return `${moduleLayersSource}[${index}]: "${name}" is also listed in ${layersSource}`;
        }
    }

    return null;
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
    const flatModulesSource = sourceOf('flatModules');

    const srcDirState = tryValue(() => parseSrcDir(raw.srcDir, srcDirSource));

    const modulesDirState = tryValue(() => parseModulesDir(raw.modulesDir, modulesDirSource));
    const modulesDirValue = modulesDirState.status === 'value' ? modulesDirState.value : null;

    // Списки: собственный формат → зависимость от modulesDir
    let layersState = parseListReport(raw.layers, layersSource, modulesDirValue, true);
    let moduleLayersState = parseListReport(
        raw.moduleLayers,
        moduleLayersSource,
        modulesDirValue,
        false,
    );

    // Совместные проверки — только когда оба списка в состоянии value; те же хелперы
    // и тот же порядок, что и в бросающем `parseScheme`.
    if (layersState.status === 'value' && moduleLayersState.status === 'value') {
        const markerProblem = checkModulesMarker(layersState.value, layersSource);
        if (markerProblem !== null) {
            layersState = { status: 'invalid', message: markerProblem };
        } else {
            const sharedProblem = checkSharedNames(
                layersState.value,
                layersSource,
                moduleLayersState.value,
                moduleLayersSource,
            );
            if (sharedProblem !== null) {
                moduleLayersState = { status: 'invalid', message: sharedProblem };
            }
        }
    }

    const flatModulesState = tryValue(() => parseFlatModules(raw.flatModules, flatModulesSource));

    return {
        srcDir: srcDirState,
        modulesDir: modulesDirState,
        layers: layersState,
        moduleLayers: moduleLayersState,
        flatModules: flatModulesState,
    };
}

/**
 * Бросающий разбор поля в состояние отчета: `value` с результатом либо `invalid` с текстом ошибки.
 */
function tryValue<T>(compute: () => T): SettingState<T> {
    try {
        return { status: 'value', value: compute() };
    } catch (e) {
        return { status: 'invalid', message: (e as Error).message };
    }
}

/**
 * Небросающий разбор списка слоев: тот же `parseLayerList`, что и бросающий `parseScheme`, в
 * состояниях. `unresolved` — когда список сам валиден, но `modulesDir` не разрешился: проверка
 * имен против `modulesDir` не выполнялась.
 */
function parseListReport(
    value: unknown,
    source: string,
    modulesDir: string | null,
    isProjectLayers: boolean,
): SettingState<readonly string[]> {
    const parsed = parseLayerList(value, source, modulesDir, isProjectLayers);

    if (parsed.kind === 'not-set') {
        return { status: 'not-set' };
    }

    if (parsed.kind === 'error') {
        return { status: 'invalid', message: parsed.message };
    }

    if (modulesDir === null) {
        return { status: 'unresolved', dependency: 'modulesDir' };
    }

    return { status: 'value', value: parsed.names };
}
