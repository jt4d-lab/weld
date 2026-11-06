/**
 * Рендер вывода CLI: текст с цветом и машинный JSON. Модуль не знает ни про ESLint, ни про резолв
 * конфигурации — он получает уже собранные данные, а форму этих данных объявляют сами команды
 * (`InspectData` в `inspect.ts`, `ConfigData` в `config.ts`).
 */

import pc from 'picocolors';

import type { Alias, SettingState } from '@/settings/index.js';

import type { ConfigData, ConfigSettingName } from './config.js';
import { CONFIG_SETTING_NAMES } from './config.js';
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

/**
 * Очистка управляющих символов: все символы < ' ' и DEL (0x7F) заменяются на `?`.
 * Используется и для сообщений об ошибках CLI, и для значений и путей отчета, которые могут
 * нести управляющие символы из аргументов.
 */
export function sanitizeText(text: string): string {
    return [...text].map((char) => (char < ' ' || char === '\u007f' ? '?' : char)).join('');
}

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
 * `weld inspect`: путь файла и путь импорта. Значение `alias`
 * печатается как есть; при `alias: null` (алиаса нет) печатается `virtualPath`. Печатается
 * очищенный текст: путь из аргумента может нести управляющие символы.
 */
export function renderInspect(data: InspectData, options: RenderOptions): string {
    const c = pc.createColors(options.color);
    const rows = [
        { label: 'file:', value: sanitizeText(data.file) },
        { label: 'alias:', value: c.cyan(sanitizeText(data.alias)) },
    ];
    const width = widthOf(rows);

    return rows.map(({ label, value }) => row(c, label, value, width)).join('\n');
}

/**
 * `weld config`: файл (или сэмпл директории), примененный ESLint-конфиг и разобранные настройки.
 * Состояния `invalid` и `unresolved` печатаются маркерами. Печатается очищенный текст:
 * пути и сообщения отчета могут нести управляющие символы.
 */
export function renderConfig(data: ConfigData, options: RenderOptions): string {
    const c = pc.createColors(options.color);
    const rows = [
        { label: 'file:', value: withSample(data, c) },
        { label: 'config:', value: sanitizeText(data.configFile) },
    ];
    const width = widthOf(rows);

    // Ширина колонки подписей настроек берется из подписей, а не из значений: `aliases` под собой
    // несет список и в ширину не входит, текст значения считается один раз — в строках печати.
    const settingsWidth = widthOf(
        CONFIG_SETTING_NAMES.filter((name) => name !== 'aliases').map((name) => ({
            label: `${name}:`,
        })),
    );

    const sectionHeader =
        data.sectionError !== null
            ? `${c.dim('settings.weld:')} ${c.red(sanitizeText(data.sectionError))}`
            : c.dim('settings.weld:');

    // Строки настроек в порядке `CONFIG_SETTING_NAMES`; `aliases` раскрывается в список на своем
    // месте, остальные печатаются одной строкой.
    const settingsLines = CONFIG_SETTING_NAMES.flatMap((name) =>
        name === 'aliases'
            ? renderAliases(data.settings.aliases, c, settingsWidth)
            : [
                  `${SETTINGS_INDENT}${row(
                      c,
                      `${name}:`,
                      rowValue(name, data.settings[name], c),
                      settingsWidth,
                  )}`,
              ],
    );

    return [
        ...rows.map(({ label, value }) => row(c, label, value, width)),
        sectionHeader,
        ...settingsLines,
    ].join('\n');
}

/**
 * Текст строки настройки: значение как строка, а маркеры состояний — красная ошибка или желтый
 * unresolved.
 */
function rowValue(name: ConfigSettingName, state: SettingState<unknown>, c: Colors): string {
    if (state.status === 'invalid') {
        return c.red(sanitizeText(state.message));
    }

    if (state.status === 'unresolved') {
        return c.yellow(`(unresolved: ${state.dependency})`);
    }

    return sanitizeText(state.value as string);
}

/**
 * Алиасы: при пустом списке — явное `(none)` в строке подписи, иначе подпись и список под ней.
 * Запись печатается в той форме, в которой объявляется в `paths`: `<prefix>/* → <anchor>/*`, а у
 * точного ключа хвоста `/*` нет ни с одной стороны.
 */
function renderAliases(state: SettingState<Alias[]>, c: Colors, width: number): string[] {
    if (state.status === 'value') {
        if (state.value.length === 0) {
            return [`${SETTINGS_INDENT}${row(c, 'aliases:', c.dim('(none)'), width)}`];
        }
        return [
            `${SETTINGS_INDENT}${c.dim('aliases:')}`,
            ...state.value.map((alias) => `${ALIAS_INDENT}${c.cyan(formatAlias(alias))}`),
        ];
    }

    const marker =
        state.status === 'invalid'
            ? c.red(sanitizeText(state.message))
            : c.yellow(`(unresolved: ${state.dependency})`);
    return [`${SETTINGS_INDENT}${row(c, 'aliases:', marker, width)}`];
}

function withSample(data: ConfigData, c: Colors): string {
    if (data.sampleOf === undefined) {
        return sanitizeText(data.file);
    }

    return `${sanitizeText(data.file)} ${c.dim(`(sample of ${sanitizeText(data.sampleOf)})`)}`;
}

/**
 * `star` — признак хвоста в ключе записи: звездная запись печатается с `/*` с обеих сторон, точная —
 * как есть. `anchor` — всегда директория виртуального пути, поэтому звезде хвост дописывается, если
 * его нет. Управляющие символы в имени алиаса заменяются на `?`.
 */
function formatAlias(alias: Alias): string {
    const prefix = sanitizeText(alias.prefix);
    const anchor = sanitizeText(alias.anchor);

    return alias.star ? `${withStar(prefix)} → ${withStar(anchor)}` : `${prefix} → ${anchor}`;
}

function withStar(value: string): string {
    return value.endsWith('/') ? `${value}*` : `${value}/*`;
}

/** Машинный вывод: только `JSON.stringify`, без подписей и цветов. */
export function renderJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}
