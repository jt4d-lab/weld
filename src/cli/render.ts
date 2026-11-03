/**
 * Рендер вывода CLI: текст с цветом и машинный JSON. Модуль не знает ни про ESLint, ни про резолв
 * конфигурации — он получает уже собранные данные, а форму этих данных объявляют сами команды
 * (`InspectData` в `inspect.ts`, `ConfigData` в `config.ts`).
 */

import pc from 'picocolors';

import type { SettingState } from '@/settings/index.js';
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

/**
 * Очистка управляющих символов: все символы < ' ' и DEL (0x7F) заменяются на `?`.
 * Используется и для сообщений об ошибках CLI, и для сообщений отчета.
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
 * `weld inspect`: путь файла, путь импорта и метаданные в схеме слоев. Значение `alias`
 * печатается как есть — команда уже подставила виртуальный путь, если алиаса нет.
 */
export function renderInspect(data: InspectData, options: RenderOptions): string {
    const c = pc.createColors(options.color);
    const rows = [
        { label: 'file:', value: data.file },
        { label: 'alias:', value: c.cyan(data.alias) },
        { label: 'module:', value: data.module },
        { label: 'layer:', value: data.layer },
        { label: 'innerPath:', value: data.innerPath },
    ];
    const width = widthOf(rows);

    return rows.map(({ label, value }) => row(c, label, value, width)).join('\n');
}

/**
 * `weld config`: файл (или сэмпл директории), примененный ESLint-конфиг, разобранные настройки
 * и схема слоев. Состояния `invalid`/`unresolved`/`not set` печатаются маркерами.
 */
export function renderConfig(data: ConfigData, options: RenderOptions): string {
    const c = pc.createColors(options.color);
    const rows = [
        { label: 'file:', value: withSample(data, c) },
        { label: 'config:', value: data.configFile },
    ];
    const width = widthOf(rows);
    const s = data.settings;

    const singleLabels = [
        { label: 'repoRoot:', value: stateText(s.repoRoot, c) },
        { label: 'aliasesBaseUrl:', value: stateText(s.aliasesBaseUrl, c) },
        { label: 'tsconfig:', value: stateText(s.tsconfig, c) },
        { label: 'srcDir:', value: stateText(s.srcDir, c) },
        { label: 'modulesDir:', value: stateText(s.modulesDir, c) },
        { label: 'layers:', value: listStateText(s.layers, c) },
        { label: 'moduleLayers:', value: listStateText(s.moduleLayers, c) },
    ];
    const settingsWidth = widthOf(singleLabels);

    const sectionHeader =
        data.sectionError !== null
            ? `${c.dim('settings.weld:')} ${c.red(data.sectionError)}`
            : c.dim('settings.weld:');

    return [
        ...rows.map(({ label, value }) => row(c, label, value, width)),
        sectionHeader,
        ...[
            `${SETTINGS_INDENT}${row(c, 'repoRoot:', stateText(s.repoRoot, c), settingsWidth)}`,
            `${SETTINGS_INDENT}${row(c, 'aliasesBaseUrl:', stateText(s.aliasesBaseUrl, c), settingsWidth)}`,
            `${SETTINGS_INDENT}${row(c, 'tsconfig:', stateText(s.tsconfig, c), settingsWidth)}`,
            ...renderAliases(s.aliases, c, settingsWidth),
            `${SETTINGS_INDENT}${row(c, 'srcDir:', stateText(s.srcDir, c), settingsWidth)}`,
            `${SETTINGS_INDENT}${row(c, 'modulesDir:', stateText(s.modulesDir, c), settingsWidth)}`,
            `${SETTINGS_INDENT}${row(c, 'layers:', listStateText(s.layers, c), settingsWidth)}`,
            `${SETTINGS_INDENT}${row(c, 'moduleLayers:', listStateText(s.moduleLayers, c), settingsWidth)}`,
        ],
    ].join('\n');
}

/** Текст для строковой настройки: значение / красная ошибка / желтый unresolved / серый not set. */
function stateText(state: SettingState<string>, c: Colors): string {
    switch (state.status) {
        case 'value':
            return state.value;
        case 'invalid':
            return c.red(state.message);
        case 'unresolved':
            return c.yellow(`(unresolved: ${state.dependency})`);
        case 'not-set':
            return c.dim('(not set)');
    }
}

/** Текст для списочной настройки: значения через запятую / маркеры как для строковой. */
function listStateText(state: SettingState<readonly string[]>, c: Colors): string {
    if (state.status === 'value') {
        return state.value.join(', ');
    }
    return stateText(state as SettingState<string>, c);
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
    if (state.status === 'invalid') {
        return [`${SETTINGS_INDENT}${row(c, 'aliases:', c.red(state.message), width)}`];
    }
    if (state.status === 'unresolved') {
        return [
            `${SETTINGS_INDENT}${row(c, 'aliases:', c.yellow(`(unresolved: ${state.dependency})`), width)}`,
        ];
    }
    return [`${SETTINGS_INDENT}${row(c, 'aliases:', c.dim('(not set)'), width)}`];
}

function withSample(data: ConfigData, c: Colors): string {
    if (data.sampleOf === undefined) {
        return data.file;
    }

    return `${data.file} ${c.dim(`(sample of ${data.sampleOf})`)}`;
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
