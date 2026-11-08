/**
 * Команда `weld config`: диагностический отчет эффективной конфигурации WELD для файла или
 * директории.
 */

import type { ConfigReport } from '@/config/index.js';
import { reportForFile } from '@/config/index.js';
import type { SettingState } from '@/settings/index.js';

import type { LintSettings } from './eslint-config.js';
import { assertInsideRoot, repoPath } from './target.js';

export type ConfigData = {
    /** Путь файла от корня репозитория; абсолютный исходный путь, если корень не получен. */
    file: string;
    /** Путь примененного ESLint-конфига тем же правилами; абсолютный, если корень не получен. */
    configFile: string;
    /** Аргумент директории в том виде, как его ввели; у файла отсутствует. */
    sampleOf?: string;
    settings: ConfigReport['settings'];
    /** Собственная проблема секции `settings.weld`, если она задана и невалидна. */
    sectionError: string | null;
};

/** Имена настроек отчета в порядке печати и сериализации, как в `docs/rules/settings.md`. */
export const CONFIG_SETTING_NAMES = [
    'layers',
    'moduleLayers',
    'flatModules',
    'modulesDir',
    'srcDir',
    'aliases',
    'aliasesBaseUrl',
    'repoRoot',
    'tsconfig',
] as const;

/**
 * Отчет для команды `weld config`.
 */
export function effectiveConfig(lint: LintSettings, cwd: string, shownPath: string): ConfigData {
    const input = {
        filename: lint.filePath,
        settings: lint.settings,
        cwd,
        options: lint.options,
    };

    const { report, target } = reportForFile(input);

    const data: ConfigData = {
        file: lint.filePath,
        configFile: lint.configFile,
        sampleOf: lint.sampleOf,
        settings: report.settings,
        sectionError: report.sectionError,
    };

    if (data.settings.repoRoot.status !== 'value') {
        return data;
    }

    assertInsideRoot(target, shownPath);

    data.file = repoPath(data.settings.repoRoot.value, lint.filePath);
    data.configFile = repoPath(data.settings.repoRoot.value, lint.configFile);

    return data;
}

export function configJson(data: ConfigData): Record<string, unknown> {
    const valueOf = (state: SettingState<unknown>): unknown =>
        state.status === 'value' ? state.value : null;

    const problems: Record<string, Record<string, string>> = {};
    for (const name of CONFIG_SETTING_NAMES) {
        const state = data.settings[name];
        if (state.status === 'invalid') {
            problems[name] = { status: 'invalid', message: state.message };
        } else if (state.status === 'unresolved') {
            problems[name] = { status: 'unresolved', dependency: state.dependency };
        }
    }
    if (data.sectionError !== null) {
        problems['settings.weld'] = { status: 'invalid', message: data.sectionError };
    }

    const json: Record<string, unknown> = {
        file: data.file,
        configFile: data.configFile,
    };
    if (data.sampleOf !== undefined) {
        json.sampleOf = data.sampleOf;
    }

    const settings: Record<string, unknown> = {};
    for (const name of CONFIG_SETTING_NAMES) {
        settings[name] = valueOf(data.settings[name]);
    }
    json.settings = settings;
    json.problems = problems;

    return json;
}

/** Есть ли в отчете собственная ошибка: хотя бы один `invalid` или ошибка секции. */
export function hasOwnError(data: ConfigData): boolean {
    if (data.sectionError !== null) {
        return true;
    }
    return CONFIG_SETTING_NAMES.some((name) => data.settings[name].status === 'invalid');
}
