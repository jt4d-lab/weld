/**
 * Рендер вывода CLI: текст с цветом и машинный JSON. Модуль не знает ни про ESLint, ни про резолв
 * конфигурации — он получает уже собранные данные, а форму этих данных объявляют сами команды
 * (`InspectData` в `inspect.ts`, `ConfigData` в `config.ts`).
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

/** Отступ строк внутри блока `settings.weld`. */
const SETTINGS_INDENT = '  ';

/** Список алиасов — ступень вложенности внутри того же блока. */
const ALIAS_INDENT = `${SETTINGS_INDENT}${SETTINGS_INDENT}`;

function paddedLabel(c: Colors, text: string, width: number): string {
    return c.dim(text) + ' '.repeat(Math.max(0, width - text.length));
}

function row(c: Colors, text: string, value: string, width: number): string {
    return `${paddedLabel(c, text, width)} ${value}`;
}

/** Ширина колонки подписи по строкам одного блока. */
function widthOf(rows: readonly { label: string }[]): number {
    return Math.max(...rows.map((entry) => entry.label.length));
}

/**
 * `weld inspect`: путь файла и путь импорта. Значение `alias` печатается как есть — команда уже
 * подставила виртуальный путь, если алиаса нет.
 */
export function renderInspect(data: InspectData, options: RenderOptions): string {
    const c = pc.createColors(options.color);
    const rows = [
        { label: 'file:', value: data.file },
        { label: 'alias:', value: c.cyan(data.alias) },
    ];
    const width = widthOf(rows);

    return rows.map(({ label, value }) => row(c, label, value, width)).join('\n');
}

/**
 * `weld config`: файл (или сэмпл директории), примененный ESLint-конфиг и разобранные настройки.
 */
export function renderConfig(data: ConfigData, options: RenderOptions): string {
    const c = pc.createColors(options.color);
    const rows = [
        { label: 'file:', value: withSample(data, c) },
        { label: 'config:', value: data.configFile },
    ];
    const width = widthOf(rows);

    return [
        ...rows.map(({ label, value }) => row(c, label, value, width)),
        c.dim('settings.weld:'),
        ...settingsRows(c, data.settings).map((text) => `${SETTINGS_INDENT}${text}`),
        ...renderAliases(data.settings.aliases, c),
    ].join('\n');
}

function settingsRows(c: Colors, settings: ConfigData['settings']): string[] {
    const rows = [
        { label: 'repoRoot:', value: settings.repoRoot },
        { label: 'aliasesBaseUrl:', value: settings.aliasesBaseUrl },
        { label: 'tsconfig:', value: settings.tsconfig },
    ];
    const width = widthOf(rows);

    return rows.map(({ label, value }) => row(c, label, value, width));
}

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

/** Машинный вывод: только `JSON.stringify`, без подписей и цветов. */
export function renderJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}
