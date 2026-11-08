/**
 * Диагностический отчет эффективной конфигурации: состояния настроек вместо исключения.
 */

import type { RepoFs } from '@/repo-fs/index.js';
import type {
    Alias,
    RawScheme,
    SchemeField,
    SchemeReport,
    SettingState,
} from '@/settings/index.js';
import {
    SCHEME_FIELDS,
    checkAliasesFormat,
    getAliasesBaseUrl,
    getAliasesRaw,
    getRepoRoot,
    getSchemeRaw,
    getSectionError,
    getTsconfigName,
    hasAliases,
    parseSchemeReport,
    schemeSourceOf,
} from '@/settings/index.js';

import type { WeldResolveInput, WeldResolveOptions, WeldTarget } from './resolve.js';
import { resolveForFile } from './resolve.js';

export type ConfigReport = {
    settings: {
        /** Эффективный корень: реальный путь, резолвнутый от `cwd`. */
        repoRoot: SettingState<string>;
        aliasesBaseUrl: SettingState<string>;
        tsconfig: SettingState<string>;
        aliases: SettingState<Alias[]>;
        srcDir: SettingState<string>;
        modulesDir: SettingState<string>;
        layers: SettingState<readonly string[]>;
        moduleLayers: SettingState<readonly string[]>;
        flatModules: SettingState<boolean>;
    };
    /** Собственная проблема секции: `null`, если секция валидна или отсутствует. */
    sectionError: string | null;
};

export type ConfigReportResult = {
    report: ConfigReport;
    target: WeldTarget;
};

/**
 * Диагностический отчет эффективной конфигурации: состояние каждой настройки вместо исключения.
 *
 * Спекулятивных подстановок нет: заблокированная настройка остается `unresolved` с именем
 * зависимости.
 *
 * @param repoFsOverride Шов для тестов: подменяет `RepoFs` целиком.
 */
export function reportForFile(
    input: WeldResolveInput,
    repoFsOverride?: RepoFs,
): ConfigReportResult {
    const settings = input.settings;
    const options = input.options ?? {};
    const sectionError = getSectionError(settings);
    const target = resolveForFile(input, repoFsOverride);

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
        repoFsOverride,
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
                    repoFsOverride,
                    options,
                    target,
                }),
                ...schemeStates(settings, options),
            },
            sectionError,
        },
        target,
    };
}

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
    repoFsOverride: RepoFs | undefined;
    own: SettingState<string | undefined>;
    sectionError: string | null;
    aliasesExplicit: boolean;
    tsconfig: SettingState<string>;
    target: WeldTarget;
}): SettingState<string> {
    const { repoFsOverride, own, sectionError, aliasesExplicit, tsconfig, target } = args;

    if (repoFsOverride !== undefined) {
        return { status: 'unresolved', dependency: 'repoFs' };
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

    // `getRoot()` не падает; `null` бывает только при инъекции хоста — ветка сужает тип.
    const root = target.getRoot();
    if (root === null) {
        return { status: 'unresolved', dependency: 'repoFs' };
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
    repoFsOverride: RepoFs | undefined;
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
        repoFsOverride,
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

    if (repoFsOverride !== undefined) {
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

/**
 * Состояния полей схемы `settings.weld`.
 *
 * `parseSchemeReport` разбирает сырые значения в порядке «override > секция > дефолт»; поля,
 * которые нельзя прочитать из невалидной секции и не перекрыты опцией, получают `unresolved` с
 * именем секции.
 */
function schemeStates(settings: unknown, options: WeldResolveOptions): SchemeReport {
    const sectionRaw = getSchemeRaw(settings);
    const raw: RawScheme = {
        srcDir: undefined,
        modulesDir: undefined,
        layers: undefined,
        moduleLayers: undefined,
        flatModules: undefined,
    };
    const blocked = new Set<SchemeField>();

    for (const field of SCHEME_FIELDS) {
        const override = options[field];
        if (override !== undefined) {
            raw[field] = override;
        } else if (sectionRaw !== null) {
            raw[field] = sectionRaw[field];
        } else {
            // `raw[field]` уже `undefined` по инициализации — поле просто не заполняется.
            blocked.add(field);
        }
    }

    const report = parseSchemeReport(raw, schemeSourceOf(options));

    for (const field of blocked) {
        report[field] = { status: 'unresolved', dependency: 'settings.weld' };
    }

    return report;
}
