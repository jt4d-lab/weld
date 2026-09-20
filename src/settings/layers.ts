/**
 * Схема слоёв: разбор `layers` / `moduleLayers` / `moduleDir` в один плоский упорядоченный список
 * квалифицированных слоёв. Весь вердикт правила направления зависимостей сводится к сравнению двух
 * позиций в этом списке, поэтому арифметика порядка живёт здесь, а не в правиле.
 *
 * Квалификатор — часть имени слоя: `root:<имя>` (слой проекта), `module:<имя>` (слой модуля),
 * `module` (модуль как целое — его публичный интерфейс), `root:unknown` / `module:unknown` (код без
 * слоя на соответствующем уровне). Два уровня живут в одном списке именно потому, что квалификатор
 * их различает: `entities` проекта и `entities` внутри модуля — разные слои.
 *
 * `@modules` разворачивается в `module`, затем слои модуля, затем снова `module`: модуль как целое
 * получает диапазон, обрамляющий его слои. Отсюда без единого особого случая следует, что баррель
 * модуля двунаправлен со слоями модулей, а до `pages`/`app` не достаёт.
 *
 * Кэша у разбора нет намеренно: он не читает диск, не логирует и не отдаёт наружу ничего, что
 * сравнивалось бы по ссылке, — проход по десятку строк дешевле поиска в кэше.
 */

/**
 * Слой с квалификатором — элемент развёрнутого порядка и ключ индексов. Строка, а не union: набор
 * имён задаёт пользователь, закрытым типом он не выражается.
 */
export type Qualified = string;

export type LayerSchema = {
    /** Развёрнутый порядок слоёв слева направо: поверхность тестов и debug-лога. */
    order: Qualified[];
    /** Первая позиция имени в `order` — левая граница диапазона повторяющегося слоя. */
    first: Map<Qualified, number>;
    /** Последняя позиция имени в `order` — правая граница того же диапазона. */
    last: Map<Qualified, number>;
    /** Обычные имена из `layers`: с ними сверяются сегменты пути вне модулей. */
    projectLayers: Set<string>;
    /** Обычные имена из `moduleLayers`: с ними сверяются сегменты пути внутри модуля. */
    moduleLayers: Set<string>;
    /** Имя директории, поддиректории которой считаются модулями. */
    moduleDir: string;
};

/**
 * Значение настройки вместе с именем её места в конфиге. Имя нужно только сообщениям об ошибках:
 * одно и то же значение приходит либо из `settings.weld.<имя>`, либо из опций правила
 * (`options.<имя>`), и пользователь должен узнать в тексте своё место в конфиге. Три настройки
 * схемы перекрываются порознь, поэтому источник у каждой свой.
 */
export type SettingValue = { value: unknown; source: string };

export type RawLayerSchema = {
    layers: SettingValue;
    moduleLayers: SettingValue;
    moduleDir: SettingValue;
};

/** Место слоёв модуля в порядке проекта. В `moduleLayers` запрещён: вкладывать модуль в себя незачем. */
const MODULES = '@modules';

/** Код, слой которого определить не удалось. Допустим в обоих списках — это разные слои. */
const UNKNOWN = '@unknown';

/** Модуль как целое: его публичный интерфейс и обе границы диапазона слоёв модуля. */
export const MODULE: Qualified = 'module';

const DEFAULT_MODULE_DIR = 'modules';

/** Слой проекта. Имя `unknown` даст тот же квалификатор, что и `@unknown`, — совпадение безобидное. */
export function rootLayer(name: string): Qualified {
    return `root:${name}`;
}

/** Слой внутри модуля. */
export function moduleLayer(name: string): Qualified {
    return `module:${name}`;
}

/** Код вне модулей, слой которого не определён. */
export const ROOT_UNKNOWN: Qualified = rootLayer('unknown');

/** Код внутри модуля, слой которого не определён. */
export const MODULE_UNKNOWN: Qualified = moduleLayer('unknown');

/**
 * Простое имя слоя — то, как слой назван в конфиге: `root:common` и `module:entities` дают `common`
 * и `entities`, оба неразмеченных слоя — `@unknown`, модуль как целое — `module`. Нужно сообщениям
 * правил: квалификатор различает слои, а пользователь писал в конфиг простые имена и узнаёт в тексте
 * именно их.
 *
 * Обратный разбор живёт здесь по той же причине, что и сборка: формат квалификатора знает только
 * `src/settings/`, и снятие префикса во втором месте развело бы два знания об одном формате.
 */
export function plainLayerName(layer: Qualified): string {
    if (layer === ROOT_UNKNOWN || layer === MODULE_UNKNOWN) {
        return UNKNOWN;
    }

    const separator = layer.indexOf(':');

    return separator === -1 ? layer : layer.slice(separator + 1);
}

/**
 * Разворачивает и проверяет схему слоёв. Любая проблема значения — исключение с указанием места в
 * конфиге: схема задана явно, и подставленная вместо неё пустая схема означала бы зелёный линт без
 * единой проверки направления.
 */
export function parseLayerSchema(raw: RawLayerSchema): LayerSchema {
    const layers = requireNames(raw.layers);
    const hasModuleLayers = raw.moduleLayers.value !== undefined;
    const moduleLayerNames = hasModuleLayers ? requireNames(raw.moduleLayers) : [];

    checkSpecialNames(layers, raw.layers.source);
    checkSpecialNames(moduleLayerNames, raw.moduleLayers.source, raw.layers.source);

    const modulesCount = layers.filter((name) => name === MODULES).length;
    if (modulesCount > 1) {
        throw new Error(`${raw.layers.source} must not contain '${MODULES}' more than once`);
    }
    if (hasModuleLayers && modulesCount === 0) {
        throw new Error(
            `${raw.moduleLayers.source} is set, but ${raw.layers.source} has no '${MODULES}' to put it into`,
        );
    }

    const projectLayers = collectPlainNames(layers);
    checkNoOverlap(moduleLayerNames, projectLayers, raw.moduleLayers.source, raw.layers.source);

    const order = expand(layers, moduleLayerNames);

    return {
        order,
        ...indexRanges(order),
        projectLayers,
        moduleLayers: collectPlainNames(moduleLayerNames),
        moduleDir: parseModuleDir(raw.moduleDir),
    };
}

/** Список имён слоёв: массив непустых строк. Сам состав имён проверяется дальше. */
function requireNames({ value, source }: SettingValue): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`${source} must be an array`);
    }

    return value.map((item, index) => {
        if (typeof item !== 'string') {
            throw new Error(`${source}[${index}] must be a non-empty string, got ${typeof item}`);
        }
        if (item === '') {
            throw new Error(`${source}[${index}] must be a non-empty string`);
        }

        return item;
    });
}

/**
 * Имена с `@` зарезервированы под спец-слои: неизвестное `@`-имя — опечатка, а не слой проекта.
 * `layersSource` передаётся только для `moduleLayers` и называет место, где `@modules` уместен; у
 * самого списка `layers` он не задан, и `@modules` там разрешён.
 */
function checkSpecialNames(names: string[], source: string, layersSource?: string): void {
    names.forEach((name, index) => {
        if (!name.startsWith('@') || name === UNKNOWN) {
            return;
        }

        if (name === MODULES) {
            if (layersSource === undefined) {
                return;
            }

            throw new Error(
                `${source}[${index}]: '${MODULES}' may only be used in ${layersSource}`,
            );
        }

        throw new Error(
            `${source}[${index}]: unknown special layer '${name}'; only '${MODULES}' and '${UNKNOWN}' may start with "@"`,
        );
    });
}

/** Обычные имена списка, без спец-слоёв и без повторов. */
function collectPlainNames(names: string[]): Set<string> {
    return new Set(names.filter((name) => !name.startsWith('@')));
}

/**
 * Одно обычное имя в обоих списках — слой проекта и слой модуля, которые в порядке стоят в разных
 * местах, а в дереве неотличимы: директория `app` внутри модуля читалась бы то так, то эдак.
 * `@unknown` из проверки исключён: `root:unknown` и `module:unknown` — разные слои, и объявить «код
 * без слоя» на обоих уровнях законно.
 */
function checkNoOverlap(
    moduleLayerNames: string[],
    projectLayers: Set<string>,
    source: string,
    layersSource: string,
): void {
    moduleLayerNames.forEach((name, index) => {
        if (projectLayers.has(name)) {
            throw new Error(
                `${source}[${index}]: '${name}' is already declared in ${layersSource}`,
            );
        }
    });
}

/**
 * Поэлементная развёртка: `@modules` → `module`, слои модуля, снова `module`; `@unknown` →
 * `root:unknown`; прочее → `root:<имя>`. Пустой `moduleLayers` даёт смежный повтор `module, module`
 * — ожидаемое поведение проекта с модулями без слоёв.
 */
function expand(layers: string[], moduleLayerNames: string[]): Qualified[] {
    const order: Qualified[] = [];

    for (const name of layers) {
        if (name === MODULES) {
            order.push(MODULE);
            for (const moduleName of moduleLayerNames) {
                order.push(moduleName === UNKNOWN ? MODULE_UNKNOWN : moduleLayer(moduleName));
            }
            order.push(MODULE);
            continue;
        }

        order.push(name === UNKNOWN ? ROOT_UNKNOWN : rootLayer(name));
    }

    return order;
}

/**
 * Границы диапазона каждого имени. Имя, встречающееся в порядке несколько раз, занимает всё между
 * своим первым и последним вхождением — этим и записывается осознанное исключение из направления.
 */
function indexRanges(order: Qualified[]): Pick<LayerSchema, 'first' | 'last'> {
    const first = new Map<Qualified, number>();
    const last = new Map<Qualified, number>();

    order.forEach((name, index) => {
        if (!first.has(name)) {
            first.set(name, index);
        }
        last.set(name, index);
    });

    return { first, last };
}

/** `moduleDir` — имя директории, а не путь: модули опознаются на любой глубине. */
function parseModuleDir({ value, source }: SettingValue): string {
    if (value === undefined) {
        return DEFAULT_MODULE_DIR;
    }
    if (typeof value !== 'string') {
        throw new Error(`${source} must be a string, got ${typeof value}`);
    }
    if (value === '') {
        throw new Error(`${source} must not be empty`);
    }
    if (value.includes('/')) {
        throw new Error(`${source} must be a directory name, not a path: '${value}'`);
    }

    return value;
}
