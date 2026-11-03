/**
 * Диагностический отчет эффективной конфигурации: что печатает `weld config`, когда часть
 * конфигурации не вычисляется.
 *
 * Собирается поверх того же `resolveForFile`: эффективные значения берутся из ленивых частей
 * резолва, а каждое состояние определяется по фактическому графу зависимостей. Отчет не бросает:
 * собственная ошибка значения получает `invalid` с сообщением, неразрешенная зависимость —
 * `unresolved` с именем зависимости, допустимое отсутствие списка — `not-set`. Собственные
 * значения проверяются независимо от зависимостей, поэтому две сломанные настройки дают две
 * ошибки, а не каскад, и эффективный корень не подставляется при ошибке его зависимости.
 *
 * Ленивый контракт `WeldTarget` и адаптер правил `src/rules/context.ts` не меняются: правило
 * по-прежнему получает исключение на первой сломанной части.
 */

import type { FsHost } from '@/host/index.js';
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
        srcDir: SettingState<string>;
        modulesDir: SettingState<string>;
        layers: SettingState<readonly string[]>;
        moduleLayers: SettingState<readonly string[]>;
    };
    /** Собственная проблема секции: `null`, если секция валидна или отсутствует. */
    sectionError: string | null;
};

/**
 * Отчет и тот самый резолв, по которому он собран: потребителю, которому нужна другая ленивая
 * часть `WeldTarget`, `target` позволяет не пересчитывать тот же вход.
 */
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
    // При нечитабельной секции `aliasesExplicit` равен просто «заданы ли options.aliases».
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
                ...schemeStates(settings, options),
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

/**
 * Эффективный корень. Порядок неразрешенных зависимостей совпадает с оценкой `resolveForFile`:
 * `coverDirs` считается аргументом **до** вызова `resolveRoot` — сначала вопрос об явности
 * алиасов (читает секцию), затем имя tsconfig; собственный `repoRoot` при этом уже проверен.
 * Инжектированный фейковый хост реального корня не имеет.
 */
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

    // `invalid` — собственная ошибка `repoRoot`; `unresolved` — секция нечитабельна.
    if (own.status === 'invalid' || own.status === 'unresolved') {
        return own;
    }

    // Явность алиасов — вопрос, который решается чтением секции, поэтому нечитабельная секция
    // блокирует корень, пока не заданы `options.aliases`. При валидной секции `aliasesExplicit`
    // учитывает и явные алиасы секции, и зависимость не возникает.
    let dependency: string | null = null;
    if (sectionError !== null && !aliasesExplicit) {
        dependency = 'settings.weld';
    } else if (!aliasesExplicit && tsconfig.status === 'invalid') {
        dependency = 'tsconfig';
    }

    if (dependency !== null) {
        return { status: 'unresolved', dependency };
    }

    // Дальше `getRoot()` не бросает: собственный `repoRoot` валиден, а секция и имя tsconfig
    // разрешены выше. `null` он отдает только при инъекции хоста, а та отсекена в начале,
    // — ответ ниже остается только для сужения типа.
    const root = target.getRoot();
    if (root === null) {
        return { status: 'unresolved', dependency: 'fsHost' };
    }

    return { status: 'value', value: root };
}

/**
 * Алиасы. Явные проверяются собственным форматом и `aliasesBaseUrl` — независимо от корня
 * (разбираются без рабочего корня); собственная ошибка формата показывается даже при невалидной
 * базе. Автоматические — из tsconfig: зависимость называется в порядке оценки резолва (сначала
 * имя tsconfig, затем корень), чтобы отчет не маскировал причину ошибки.
 */
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

    // Секция нечитабельна и override нет: не определить даже явность алиасов.
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

    // `unresolved` корня сюда не доходит: инъекция хоста и нечитабельная секция отсечены в
    // начале функции, а кривой tsconfig — строкой выше; остается только `invalid`.
    if (repoRoot.status !== 'value') {
        return { status: 'unresolved', dependency: 'repoRoot' };
    }

    return { status: 'value', value: target.getAliases() };
}

/**
 * Явные алиасы: сначала собственный формат (не зависит от базы), затем база, затем разбор тем же
 * вызовом, что и резолв.
 */
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
 * Схема: `parseSchemeReport` по сырым значениям «override > секция > дефолт», а поля, которые
 * нельзя прочитать из невалидной секции и не перекрыты опцией, получают `unresolved` с именем
 * секции.
 */
function schemeStates(settings: unknown, options: WeldResolveOptions): SchemeReport {
    const sectionRaw = getSchemeRaw(settings);
    const raw: RawScheme = {
        srcDir: undefined,
        modulesDir: undefined,
        layers: undefined,
        moduleLayers: undefined,
    };
    const blocked = new Set<SchemeField>();

    for (const field of SCHEME_FIELDS) {
        const override = options[field];
        if (override !== undefined) {
            raw[field] = override;
        } else if (sectionRaw !== null) {
            raw[field] = sectionRaw[field];
        } else {
            raw[field] = undefined;
            blocked.add(field);
        }
    }

    const report = parseSchemeReport(raw, (field) =>
        options[field] !== undefined ? `options.${field}` : `settings.weld.${field}`,
    );

    for (const field of blocked) {
        report[field] = { status: 'unresolved', dependency: 'settings.weld' };
    }

    return report;
}
