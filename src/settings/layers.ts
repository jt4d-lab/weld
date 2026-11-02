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
    layers: string[];
    /** Слои модулей сверху вниз — одинаковые для всех модулей и на любой глубине вложенности. */
    moduleLayers: string[];
};

/** Поля схемы: по ним же называются источники значений в сообщениях об ошибках. */
export type SchemeField = keyof Scheme;

/** Сырые значения полей схемы: типы проверяются при разборе. */
export type RawScheme = Record<SchemeField, unknown>;

/** Имя слоя: буква, дальше буквы, цифры, `.`, `-`, `_`. */
const LAYER_NAME = /^[\p{L}][\p{L}\p{N}._-]*$/u;

/**
 * В имени директории модулей недопустимы разделители пути, `@` (занят метками) и `:` (разделитель
 * цепочки модулей в выводе — `MODULE_SEPARATOR` в `src/layers/locate.ts`).
 */
const INVALID_DIR_CHARS = /[/\\@:]/;

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
    const layers = parseLayerList(raw.layers, layersSource, modulesDir, true);
    const moduleLayers = parseLayerList(raw.moduleLayers, moduleLayersSource, modulesDir, false);

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

    if (value === '' || value === '.' || value === '..' || INVALID_DIR_CHARS.test(value)) {
        throw new Error(
            `${source} must be a single directory name without "/", "\\", "@" or ":", not "." or "..", got "${value}"`,
        );
    }

    return value;
}

/**
 * Список слоев: повторы обычных имен разрешены и сохраняются в исходном порядке — будущее правило
 * прочитает повтор как диапазон, а не как ошибку. Метки допустимы только в `layers` и не более
 * одного раза каждая.
 */
function parseLayerList(
    value: unknown,
    source: string,
    modulesDir: string,
    allowMarkers: boolean,
): string[] {
    if (value === undefined) {
        throw new Error(`${source} is required`);
    }

    if (!Array.isArray(value)) {
        throw new Error(`${source} must be an array of strings, got ${typeof value}`);
    }

    if (value.length === 0) {
        throw new Error(`${source} must not be empty`);
    }

    const names: string[] = [];
    for (const [index, item] of value.entries()) {
        if (typeof item !== 'string') {
            throw new Error(`${source}[${index}] must be a string, got ${typeof item}`);
        }
        names.push(item);
    }

    const seenMarkers = new Set<LayerMarker>();

    for (const [index, name] of names.entries()) {
        if (isMarker(name)) {
            if (!allowMarkers) {
                throw new Error(`${source}[${index}]: "${name}" marker is not allowed here`);
            }
            if (seenMarkers.has(name)) {
                throw new Error(`${source}[${index}]: "${name}" marker is allowed only once`);
            }
            seenMarkers.add(name);
            continue;
        }

        if (!LAYER_NAME.test(name)) {
            throw new Error(`${source}[${index}] is not a valid layer name: "${name}"`);
        }

        if (name === modulesDir) {
            throw new Error(`${source}[${index}]: "${name}" must not be the modulesDir name`);
        }
    }

    return names;
}

/** Слоям модулей нужна позиция в схеме проекта: без `@modules` их некуда поставить. */
function checkModuleLayersPlacement(layers: string[], layersSource: string): void {
    if (!layers.includes(MODULES_MARKER)) {
        throw new Error(`${layersSource} must contain the "${MODULES_MARKER}" marker`);
    }
}

/** Одно имя в обоих списках неразличимо в дереве: директория читалась бы то так, то иначе. */
function checkSharedNames(
    layers: string[],
    layersSource: string,
    moduleLayers: string[],
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
