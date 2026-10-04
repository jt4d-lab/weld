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
    /**
     * Развёрнутый порядок слоёв слева направо: читаемая форма схемы и поверхность тестов. Сам
     * вердикт считается по {@link LayerSchema.first}/{@link LayerSchema.last}.
     */
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

/** Какой из двух списков проверяется: от этого зависит и место в конфиге, и совет вместо имени. */
type LayerList = 'layers' | 'moduleLayers';

/**
 * Всё, что проверкам и советам нужно знать о разбираемой схеме помимо самого имени. Оба места в
 * конфиге ездят вместе: сообщение называет либо своё (`<список>[i]`), либо чужое (`@modules`
 * объявляется в `layers`, и туда ссылаются и совет про него, и запрет на него в `moduleLayers`), —
 * поэтому они лежат одним словарём по тому же ключу, которым выбирается и совет.
 *
 * Совет обязан вести в конфиг, который разбор примет, а это зависит не только от списка, но и от
 * того, что в `layers` уже написано, — отсюда `hasModules`.
 */
type SchemaContext = {
    /** Место каждого из двух списков в конфиге: `settings.weld.<имя>` либо `options.<имя>`. */
    source: Record<LayerList, string>;
    /** Объявлен ли `@modules` в `layers`: второго разбор не примет, и совет об этом знает. */
    hasModules: boolean;
};

/** Совет вместо зарезервированного имени — свой на каждый список. */
type ReservedAdvice = Record<LayerList, (context: SchemaContext) => string>;

/**
 * Обычные имена, занятые развёрткой спец-слоёв, и совет вместо каждого из них. Оба имени — то, как
 * {@link plainLayerName} называет спец-слой в сообщениях, поэтому объявленный слой с таким именем
 * оказался бы с ним неразличим:
 *
 * - `unknown` дал бы ровно тот же квалификатор, что и `@unknown`, и молча занял бы в индексах место
 *   кода без слоя — проверка «слой не объявлен» перестала бы срабатывать;
 * - `module` даёт отдельный ключ (`root:module`), но в сообщениях называется так же, как модуль
 *   целиком, — вердикт вышел бы самопротиворечивым («'module' must not import from 'module'») и
 *   вдобавок читался бы как горизонталь, которой он не является.
 *
 * Совет у `module` зависит и от списка, и от уже написанного в `layers`: `@modules` допустим только
 * в `layers` и только один раз. В `moduleLayers` совет объявить `@modules` вёл бы ровно в ту
 * запись, которую отвергает следующая же проверка ({@link checkModuleLayerNames}), — замены имени
 * внутри модуля нет вовсе: место модулям объявляется один раз, в `layers`, и действует на любой
 * глубине вложенности. В самом `layers` тот же совет упирался бы во второй `@modules`, если один
 * уже объявлен (а он объявлен в самом частом случае — схема с модулями плюс лишнее имя `module`),
 * поэтому при `hasModules` совет остаётся один: взять другое имя. У `unknown` замена одна на оба
 * списка — `@unknown` законен в каждом из них.
 *
 * По `hasModules` ветвится и совет в `moduleLayers`, хотя замены имени там нет ни при каком
 * значении: имена проверяются раньше, чем схема целиком, поэтому без `@modules` в `layers` совет
 * «возьми другое имя» упёрся бы в следующую же ошибку («`moduleLayers` задан, а класть его некуда»),
 * а сам текст утверждал бы про конфиг то, чего в нём нет. Шагов в этом случае два, и названы оба.
 */
const RESERVED_NAMES = new Map<string, ReservedAdvice>([
    [UNKNOWN.slice(1), inBothLists(`use '${UNKNOWN}' for code without a layer`)],
    [
        MODULE,
        {
            layers: ({ hasModules }) =>
                hasModules
                    ? `pick another name: '${MODULES}' already places modules in the order, and it may be declared only once`
                    : `use '${MODULES}' to place modules in the order`,
            moduleLayers: ({ hasModules, source }) =>
                hasModules
                    ? `pick another name: the place for modules is declared once, as '${MODULES}' in ${source.layers}, and it applies to modules at any depth`
                    : `pick another name, and declare '${MODULES}' in ${source.layers}: that is where modules get their place, once, and it applies to modules at any depth`,
        },
    ],
]);

/** Совет, не зависящий ни от списка, ни от схемы. */
function inBothLists(advice: string): ReservedAdvice {
    return { layers: () => advice, moduleLayers: () => advice };
}

const DEFAULT_MODULE_DIR = 'modules';

/** Слой проекта. Имена из {@link RESERVED_NAMES} сюда не доходят — их отвергает валидация схемы. */
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
 * Уровень слоя: слои модуля (`module:<имя>`, включая `module:unknown`) живут внутри модуля, все
 * прочие — на уровне проекта, включая сам `module`: модуль как целое объявляется в `layers` и
 * стоит в порядке проекта.
 *
 * Нужен сообщениям правил: {@link plainLayerName} уровень не различает намеренно (пользователь
 * писал в конфиг простые имена), и одно и то же имя `@unknown` может прийти с обоих уровней —
 * назвать в одном сообщении оба конца такой пары можно только добавив уровень. Заодно уровень
 * отвечает на вопрос, в каком списке слой объявлен: `moduleLayers` против `layers`. Живёт здесь по
 * той же причине, что и разбор простого имени: формат квалификатора знает только `src/settings/`.
 */
export function isModuleLevel(layer: Qualified): boolean {
    return layer.startsWith(`${MODULE}:`);
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

    // Счёт `@modules` нужен раньше проверки имён: от него зависит совет вместо зарезервированного
    // `module`, а сама проверка количества идёт после — она про схему целиком, а не про имя.
    const modulesCount = layers.filter((name) => name === MODULES).length;
    const context: SchemaContext = {
        source: { layers: raw.layers.source, moduleLayers: raw.moduleLayers.source },
        hasModules: modulesCount > 0,
    };

    checkLayerNames(layers, context);
    checkModuleLayerNames(moduleLayerNames, context);

    if (modulesCount > 1) {
        throw new Error(`${raw.layers.source} must not contain '${MODULES}' more than once`);
    }
    if (hasModuleLayers && modulesCount === 0) {
        throw new Error(
            `${raw.moduleLayers.source} is set, but ${raw.layers.source} has no '${MODULES}' to put it into`,
        );
    }

    const projectLayers = collectPlainNames(layers);
    checkNoOverlap(moduleLayerNames, projectLayers, context);

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

/** Имена слоёв проекта: оба спец-слоя здесь уместны, прочие проверки — общие. */
function checkLayerNames(names: string[], context: SchemaContext): void {
    names.forEach((name, index) => checkName(name, index, 'layers', context));
}

/**
 * Имена слоёв модуля: то же самое плюс запрет `@modules` — вкладывать модуль в себя незачем. Место
 * `layers` в конфиге просит и текст этой ошибки (там `@modules` уместен), и совет вместо
 * зарезервированного `module` (см. {@link RESERVED_NAMES}).
 */
function checkModuleLayerNames(names: string[], context: SchemaContext): void {
    names.forEach((name, index) => {
        if (name === MODULES) {
            throw new Error(
                `${context.source.moduleLayers}[${index}]: '${MODULES}' may only be used in ${context.source.layers}`,
            );
        }

        checkName(name, index, 'moduleLayers', context);
    });
}

/**
 * Проверки, общие для обоих списков: имя не занято развёрткой спец-слоя (см.
 * {@link RESERVED_NAMES}), имя слоя — имя директории, а не путь и не ссылка на неё (`.`/`..`
 * сегментами пути не бывают — их схлопывает резолв, — и такое имя не совпало бы ни с одним
 * сегментом: слой молча не существовал бы, а файлы, которые он должен был покрыть, шумели бы
 * `undeclaredLayer`), а неизвестное `@`-имя — опечатка, а не слой.
 */
function checkName(name: string, index: number, list: LayerList, context: SchemaContext): void {
    // Место элемента в конфиге: список, которому он принадлежит, называет и свой источник, и совет.
    const at = `${context.source[list]}[${index}]`;

    const reserved = RESERVED_NAMES.get(name);
    if (reserved !== undefined) {
        throw new Error(`${at}: '${name}' is reserved; ${reserved[list](context)}`);
    }

    if (name.includes('/') || name === '.' || name === '..') {
        throw new Error(`${at}: '${name}' must be a directory name, not a path`);
    }

    if (!name.startsWith('@') || name === UNKNOWN || name === MODULES) {
        return;
    }

    throw new Error(
        `${at}: unknown special layer '${name}'; only '${MODULES}' and '${UNKNOWN}' may start with "@"`,
    );
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
    context: SchemaContext,
): void {
    moduleLayerNames.forEach((name, index) => {
        if (projectLayers.has(name)) {
            throw new Error(
                `${context.source.moduleLayers}[${index}]: '${name}' is already declared in ${context.source.layers}`,
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
