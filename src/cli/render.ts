/**
 * Рендер вывода CLI: текст с цветом и машинный JSON. Модуль не знает ни про ESLint, ни про резолв
 * конфигурации — он получает уже собранные данные, а форму этих данных объявляют сами команды
 * (`InspectData` в `inspect.ts`, `ConfigData` в `config.ts`), поэтому рендер можно тестировать без
 * временных проектов на диске.
 *
 * Цвет здесь — только оформление: подписи и пометки приглушенные, значение алиаса акцентное.
 * Выключенный цвет обязан давать ровно тот же текст без escape-последовательностей, поэтому
 * собирается он теми же функциями, а не отдельной веткой.
 */

import pc from 'picocolors';

import type { Alias } from '@/settings/index.js';

import type { ConfigData } from './config.js';
import type { InspectData } from './inspect.js';

/** Формат `picocolors`: `createColors(false)` — те же функции, но без escape-последовательностей. */
type Colors = ReturnType<typeof pc.createColors>;

export type RenderOptions = {
    /** `undefined` — решение за `picocolors` (`NO_COLOR`/`FORCE_COLOR`/TTY), флаг его перекрывает. */
    color?: boolean;
};

/** Ширина колонки подписи у `file:`/`alias:` — одна на обе команды, чтобы вывод не разъезжался. */
const TOP_LABEL_WIDTH = 'alias:'.length;

/** Отступ строк внутри блока `settings.weld`. */
const SETTINGS_INDENT = '  ';

/** Список алиасов — ступень вложенности внутри того же блока. */
const ALIAS_INDENT = `${SETTINGS_INDENT}${SETTINGS_INDENT}`;

/** Подпись приглушенным цветом, добитая пробелами до общей ширины колонки. */
function paddedLabel(c: Colors, text: string, width: number): string {
    return c.dim(text) + ' '.repeat(Math.max(0, width - text.length));
}

/** Строка «подпись + значение»: подписи одного блока выровнены по самой длинной. */
function row(c: Colors, text: string, value: string, width: number): string {
    return `${paddedLabel(c, text, width)} ${value}`;
}

/**
 * `weld inspect`: путь файла и путь импорта. Значение `alias` печатается как есть — команда уже
 * подставила виртуальный путь, если алиаса нет.
 */
export function renderInspect(data: InspectData, options: RenderOptions): string {
    const c = pc.createColors(options.color);

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
    const c = pc.createColors(options.color);

    return [
        row(c, 'file:', withSample(data, c), TOP_LABEL_WIDTH),
        c.dim('settings.weld:'),
        ...settingsRows(c, data.settings).map((text) => `${SETTINGS_INDENT}${text}`),
        ...renderAliases(data.settings.aliases, c),
    ].join('\n');
}

/**
 * Строки блока настроек — таблицей, а не литералами по месту: ширина колонки считается по самым
 * длинным подписям, и новая настройка добавляется одной строкой, а не правкой нескольких литералов.
 */
function settingsRows(c: Colors, settings: ConfigData['settings']): string[] {
    const rows = [
        { label: 'repoRoot:', value: settings.repoRoot },
        { label: 'aliasesBaseUrl:', value: settings.aliasesBaseUrl },
        { label: 'tsconfig:', value: settings.tsconfig },
    ];
    const width = Math.max(...rows.map((entry) => entry.label.length));

    return rows.map(({ label, value }) => row(c, label, value, width));
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
 * Запись печатается в той форме, в которой объявляется в `paths`: `<prefix>/* → <anchor>/*`, а у
 * точного ключа хвоста `/*` нет ни с одной стороны.
 */
function renderAliases(aliases: Alias[], c: Colors): string[] {
    if (aliases.length === 0) {
        return [`${SETTINGS_INDENT}${c.dim('aliases:')} ${c.dim('(none)')}`];
    }

    return [
        `${SETTINGS_INDENT}${c.dim('aliases:')}`,
        ...aliases.map((alias) => `${ALIAS_INDENT}${c.cyan(formatAlias(alias))}`),
    ];
}

/**
 * `star` — признак хвоста в ключе записи: звездная запись печатается с `/*` с обеих сторон, точная —
 * как есть. `anchor` — всегда директория виртуального пути, поэтому звезде хвост дописывается, если
 * его нет.
 */
function formatAlias(alias: Alias): string {
    return alias.star
        ? `${withStar(alias.prefix)} → ${withStar(alias.anchor)}`
        : `${alias.prefix} → ${alias.anchor}`;
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
