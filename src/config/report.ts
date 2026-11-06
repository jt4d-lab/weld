/**
 * Диагностический отчет эффективной конфигурации: что печатает `weld config`, когда часть
 * конфигурации не вычисляется.
 */

import type { FsHost } from '@/host/index.js';
import type { Alias, SettingState } from '@/settings/index.js';
import {
    checkAliasesFormat,
    getAliasesBaseUrl,
    getAliasesRaw,
    getRepoRoot,
    getSectionError,
    getTsconfigName,
    hasAliases,
} from '@/settings/index.js';

import type { WeldResolveInput, WeldResolveOptions, WeldTarget } from './resolve.js';
import { resolveForFile } from './resolve.js';

/** Состояние каждой эффективной настройки в отчете. */
export type ConfigReport = {
    settings: {
        /** Эффективный корень: реальный путь, резолвнутый от `cwd`. */
        repoRoot: SettingState<string>;
        aliasesBaseUrl: SettingState<string>;
        tsconfig: SettingState<string>;
        aliases: SettingState<Alias[]>;
    };
    /** Собственная проблема секции: `null`, если секция валидна или отсутствует. */
    sectionError: string | null;
};

export type ConfigReportResult = {
    report: ConfigReport;
    target: WeldTarget;
};

export function reportForFile(
    input: WeldResolveInput,
    fsHostOverride?: FsHost,
): ConfigReportResult {
    const settings = input.settings;
    const options = input.options ?? {};
    const sectionError = getSectionError(settings);
    const target = resolveForFile(input, fsHostOverride);

    // Собственные значения проверяются до вычисления эффективных: даже при одновременной
    // невалидности двух настроек каждая получает собственную ошибку.
    const repoRootOwn = ownStringSetting(
        () => getRepoRoot(settings, options.repoRoot),
        sectionError,
        options.repoRoot !== undefined,
    );
    const aliasesBaseUrl = ownStringSetting(
        () => getAliasesBaseUrl(settings, options.aliasesBaseUrl),
        sectionError,
        options.aliasesBaseUrl !== undefined,
    );
    const tsconfig = ownStringSetting(
        () => getTsconfigName(settings, options.tsconfig),
        sectionError,
        options.tsconfig !== undefined,
    );

    // `hasAliases` читает секцию, поэтому зовется только когда секция читаема.
    const aliasesExplicit =
        options.aliases !== undefined || (sectionError === null && hasAliases(settings));

    const repoRoot = effectiveRoot({
        fsHostOverride,
        own: repoRootOwn,
        sectionError,
        aliasesExplicit,
        tsconfig,
        target,
    });

    return {
        report: {
            settings: {
                repoRoot,
                aliasesBaseUrl,
                tsconfig,
                aliases: effectiveAliases({
                    settings,
                    sectionError,
                    aliasesExplicit,
                    aliasesBaseUrl,
                    tsconfig,
                    repoRoot,
                    fsHostOverride,
                    options,
                    target,
                }),
            },
            sectionError,
        },
        target,
    };
}

/**
 * Собственное состояние строковой настройки: override проверяется независимо от секции, а
 * невалидная секция — не собственная ошибка настройки, а неразрешенная зависимость.
 */
function ownStringSetting<T extends string | undefined>(
    read: () => T,
    sectionError: string | null,
    hasOverride: boolean,
): SettingState<T> {
    if (!hasOverride && sectionError !== null) {
        return { status: 'unresolved', dependency: 'settings.weld' };
    }

    try {
        return { status: 'value', value: read() };
    } catch (error) {
        return { status: 'invalid', message: (error as Error).message };
    }
}

function effectiveRoot(args: {
    fsHostOverride: FsHost | undefined;
    own: SettingState<string | undefined>;
    sectionError: string | null;
    aliasesExplicit: boolean;
    tsconfig: SettingState<string>;
    target: WeldTarget;
}): SettingState<string> {
    const { fsHostOverride, own, sectionError, aliasesExplicit, tsconfig, target } = args;

    if (fsHostOverride !== undefined) {
        return { status: 'unresolved', dependency: 'fsHost' };
    }

    if (own.status === 'invalid' || own.status === 'unresolved') {
        return own;
    }

    let dependency: string | null = null;
    if (sectionError !== null && !aliasesExplicit) {
        dependency = 'settings.weld';
    } else if (!aliasesExplicit && tsconfig.status === 'invalid') {
        dependency = 'tsconfig';
    }

    if (dependency !== null) {
        return { status: 'unresolved', dependency };
    }

    // `getRoot()` не бросает; `null` бывает только при инъекции хоста — ветка сужает тип.
    const root = target.getRoot();
    if (root === null) {
        return { status: 'unresolved', dependency: 'fsHost' };
    }

    return { status: 'value', value: root };
}

function effectiveAliases(args: {
    settings: unknown;
    sectionError: string | null;
    aliasesExplicit: boolean;
    aliasesBaseUrl: SettingState<string>;
    tsconfig: SettingState<string>;
    repoRoot: SettingState<string>;
    fsHostOverride: FsHost | undefined;
    options: WeldResolveOptions;
    target: WeldTarget;
}): SettingState<Alias[]> {
    const {
        settings,
        sectionError,
        aliasesExplicit,
        aliasesBaseUrl,
        tsconfig,
        repoRoot,
        fsHostOverride,
        options,
        target,
    } = args;

    if (options.aliases !== undefined) {
        return explicitAliases(options.aliases, 'options.aliases', aliasesBaseUrl, target);
    }

    if (sectionError !== null) {
        return { status: 'unresolved', dependency: 'settings.weld' };
    }

    if (aliasesExplicit) {
        return explicitAliases(
            getAliasesRaw(settings),
            'settings.weld.aliases',
            aliasesBaseUrl,
            target,
        );
    }

    if (fsHostOverride !== undefined) {
        return { status: 'value', value: [] };
    }

    if (tsconfig.status === 'invalid') {
        return { status: 'unresolved', dependency: 'tsconfig' };
    }

    if (repoRoot.status !== 'value') {
        return { status: 'unresolved', dependency: 'repoRoot' };
    }

    return { status: 'value', value: target.getAliases() };
}

function explicitAliases(
    raw: unknown,
    source: string,
    aliasesBaseUrl: SettingState<string>,
    target: WeldTarget,
): SettingState<Alias[]> {
    const format = checkAliasesFormat(raw, source);
    if (format.status === 'invalid') {
        return format;
    }

    if (aliasesBaseUrl.status !== 'value') {
        return { status: 'unresolved', dependency: 'aliasesBaseUrl' };
    }

    return { status: 'value', value: target.getAliases() };
}
