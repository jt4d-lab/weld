/**
 * Рендер вывода CLI: текст с цветом и машинный JSON. Модуль не знает ни про ESLint, ни про резолв
 * конфигурации — он получает уже собранные данные и превращает их в строку, поэтому его можно
 * тестировать без временных проектов на диске.
 *
 * Цвет здесь — только оформление: подписи и пометки приглушенные, значение алиаса акцентное.
 * Выключенный цвет обязан давать ровно тот же текст без escape-последовательностей, поэтому
 * собирается он теми же функциями, а не отдельной веткой.
 */

import pc from 'picocolors';

import type { Alias } from '@/settings/index.js';

/** Формат `picocolors`: `createColors(false)` — те же функции, но без escape-последовательностей. */
type Colors = ReturnType<typeof pc.createColors>;

export type RenderOptions = {
    /** `undefined` — решение за `picocolors` (`NO_COLOR`/`FORCE_COLOR`/TTY), флаг его перекрывает. */
    color?: boolean;
};

/**
 * Данные `weld inspect`. `alias` — уже готовый к печати путь импорта: алиас, а если файл не покрыт
 * ни одним алиасом, то виртуальный путь. Машинный вывод отличает эти случаи, поэтому JSON собирает
 * команда, а не рендер.
 */
export type InspectData = {
    file: string;
    alias: string;
};

/** Данные `weld config`: эффективная конфигурация — ровно то, что видит правило. */
export type ConfigData = {
    file: string;
    /** Аргумент директории в том виде, как его ввели; у файла отсутствует. */
    sampleOf?: string;
    settings: {
        repoRoot: string;
        aliasesBaseUrl: string;
        tsconfig: string;
        aliases: Alias[];
    };
};

/** Ширина колонки подписи у `file:`/`alias:` — одна на обе команды, чтобы вывод не разъезжался. */
const TOP_LABEL_WIDTH = 'alias:'.length;

/** Подпись приглушенным цветом, добитая пробелами до общей ширины колонки. */
function label(c: Colors, text: string, width: number): string {
    return c.dim(text) + ' '.repeat(width - text.length);
}

/** Строка «подпись + значение»: подписи одного блока выровнены по самой длинной. */
function row(c: Colors, text: string, value: string, width: number): string {
    return `${label(c, text, width)} ${value}`;
}

function widest(labels: string[]): number {
    return labels.reduce((width, text) => Math.max(width, text.length), 0);
}

function createColors(options: RenderOptions): Colors {
    return pc.createColors(options.color);
}

/**
 * `weld inspect`: путь файла и путь импорта. Значение `alias` печатается как есть — команда уже
 * подставила виртуальный путь, если алиаса нет.
 */
export function renderInspect(data: InspectData, options: RenderOptions): string {
    const c = createColors(options);

    return [
        row(c, 'file:', data.file, TOP_LABEL_WIDTH),
        row(c, 'alias:', c.cyan(data.alias), TOP_LABEL_WIDTH),
    ].join('\n');
}

/**
 * `weld config`: файл (или сэмпл директории) и разобранные настройки. Пометок происхождения
 * (`(default)`, `(from tsconfig.json)`) нет: они потребовали бы предиката присутствия ключа в
 * `src/settings/`.
 */
export function renderConfig(data: ConfigData, options: RenderOptions): string {
    const c = createColors(options);
    const { settings } = data;
    const width = widest(['repoRoot:', 'aliasesBaseUrl:', 'tsconfig:']);

    const rows = [
        row(c, 'repoRoot:', settings.repoRoot, width),
        row(c, 'aliasesBaseUrl:', settings.aliasesBaseUrl, width),
        row(c, 'tsconfig:', settings.tsconfig, width),
    ];

    return [
        row(c, 'file:', withSample(data, c), TOP_LABEL_WIDTH),
        c.dim('settings.weld:'),
        ...rows.map((text) => `  ${text}`),
        ...renderAliases(settings.aliases, c),
    ].join('\n');
}

/** Первая строка: путь сэмпла и пометка, чей это сэмпл. */
function withSample(data: ConfigData, c: Colors): string {
    if (data.sampleOf === undefined) {
        return data.file;
    }

    return `${data.file} ${c.dim(`(sample of ${data.sampleOf})`)}`;
}

/**
 * Алиасы: при пустом списке — явное `(none)` в строке подписи, иначе подпись и список под ней.
 * Запись печатается в той форме, в которой объявляется в `paths`: `<prefix>/* → <anchor>/*`.
 */
function renderAliases(aliases: Alias[], c: Colors): string[] {
    if (aliases.length === 0) {
        return [`  ${c.dim('aliases:')} ${c.dim('(none)')}`];
    }

    return [
        `  ${c.dim('aliases:')}`,
        ...aliases.map((alias) => `    ${c.cyan(formatAlias(alias))}`),
    ];
}

/** `anchor` — всегда директория виртуального пути, поэтому хвост `/*` дописывается, если его нет. */
function formatAlias(alias: Alias): string {
    return `${withStar(alias.prefix)} → ${withStar(alias.anchor)}`;
}

function withStar(value: string): string {
    return value.endsWith('/') ? `${value}*` : `${value}/*`;
}

/**
 * Машинный вывод: только `JSON.stringify`, без подписей и цветов. Форму объекта собирает вызывающий:
 * `alias: null` у `inspect` без алиаса и отсутствующий `sampleOf` у файла — его решение, а не
 * рендера.
 */
export function renderJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}
