/**
 * Команда `weld config`: диагностический отчет эффективной конфигурации WELD для файла или
 * директории. Отчет строит `reportForFile`; команда только определяет пути и отдает отчет наружу.
 */

import { reportForFile, resolveForFile } from '@/config/index.js';
import type { ConfigReport } from '@/config/index.js';
import type { SettingState } from '@/settings/index.js';

import { sanitizeText } from './render.js';
import type { LintSettings } from './eslint-config.js';
import { assertInsideRoot, repoPath } from './target.js';

/**
 * Данные `weld config`: состояния эффективных настроек из отчета `src/config/` плюс пути. Граф
 * зависимостей живёт в отчёте, здесь он не пересобирается. Текстовую и JSON-форму собирают
 * `renderConfig` и `configJson`.
 */
export type ConfigData = {
    /** Путь файла от корня репозитория; абсолютный исходный путь, если корень не получен. */
    file: string;
    /** Путь примененного ESLint-конфига тем же правилами; абсолютный, если корень не получен. */
    configFile: string;
    /** Аргумент директории в том виде, как его ввели; у файла отсутствует. */
    sampleOf?: string;
    /** Состояния эффективных настроек из диагностического отчета. */
    settings: ConfigReport['settings'];
    /** Собственная проблема секции `settings.weld`, если она задана и невалидна. */
    sectionError: string | null;
};

/** Имена настроек отчета в порядке печати и сериализации. */
export const CONFIG_SETTING_NAMES = [
    'repoRoot',
    'aliasesBaseUrl',
    'tsconfig',
    'aliases',
    'srcDir',
    'modulesDir',
    'layers',
    'moduleLayers',
] as const;

/**
 * Отчет для команды `weld config`. Файл внутри корня проверяется только тогда, когда эффективный
 * корень получен: иначе `file` и `configFile` печатаются абсолютными исходными путями, а файл вне
 * вычисленного корня остается ошибкой команды (код 1), а не состоянием отчета.
 */
export function effectiveConfig(lint: LintSettings, cwd: string, shownPath: string): ConfigData {
    const input = {
        filename: lint.filePath,
        settings: lint.settings,
        cwd,
        options: lint.options,
    };

    const report = reportForFile(input);

    const data: ConfigData = {
        file: lint.filePath,
        configFile: lint.configFile,
        sampleOf: lint.sampleOf,
        settings: cleanSettings(report.settings),
        sectionError: report.sectionError === null ? null : sanitizeText(report.sectionError),
    };

    if (data.settings.repoRoot.status !== 'value') {
        return data;
    }

    // Корень получен: файл обязан лежать внутри него, иначе — ошибка команды, как и прежде.
    const target = resolveForFile(input);
    assertInsideRoot(target, shownPath);

    data.file = repoPath(data.settings.repoRoot.value, lint.filePath);
    data.configFile = repoPath(data.settings.repoRoot.value, lint.configFile);

    return data;
}

/** Машинный вид отчета: простые значения, `null` для недоступных и объект `problems`. */
export function configJson(data: ConfigData): Record<string, unknown> {
    const valueOf = <T>(state: SettingState<T>): T | null =>
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
    json.settings = {
        repoRoot: valueOf(data.settings.repoRoot),
        aliasesBaseUrl: valueOf(data.settings.aliasesBaseUrl),
        tsconfig: valueOf(data.settings.tsconfig),
        aliases: valueOf(data.settings.aliases),
        srcDir: valueOf(data.settings.srcDir),
        modulesDir: valueOf(data.settings.modulesDir),
        layers: valueOf(data.settings.layers),
        moduleLayers: valueOf(data.settings.moduleLayers),
    };
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

/** Управляющие символы в сообщениях отчета заменяются на `?`, как у обычных ошибок CLI. */
function cleanSettings(settings: ConfigReport['settings']): ConfigData['settings'] {
    const clean = <T>(state: SettingState<T>): SettingState<T> =>
        state.status === 'invalid'
            ? { status: 'invalid', message: sanitizeText(state.message) }
            : state;

    return {
        repoRoot: clean(settings.repoRoot),
        aliasesBaseUrl: clean(settings.aliasesBaseUrl),
        tsconfig: clean(settings.tsconfig),
        aliases: clean(settings.aliases),
        srcDir: clean(settings.srcDir),
        modulesDir: clean(settings.modulesDir),
        layers: clean(settings.layers),
        moduleLayers: clean(settings.moduleLayers),
    };
}
