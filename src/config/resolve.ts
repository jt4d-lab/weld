/**
 * Эффективная конфигурация WELD для файла — то, что видит правило.
 *
 * `settings.weld` плюс автопоиск алиасов в tsconfig и подъем корня до якорей.
 *
 * Модуль работает над обычным объектом (`{ filename, settings, cwd, options }`) и не импортирует
 * `eslint`: про `Rule.RuleContext` знает только адаптер `src/rules/context.ts`.
 *
 * Резолв ленивый: каждая часть считается по первому обращению и запоминается, поэтому кривая
 * неиспользуемая часть не валит потребителя, который ее не спрашивал. Порядок зависимостей:
 * tsconfig (нужны `realAnchors` для корня и `paths` для алиасов) → `getRoot`/`getRepoFs` →
 * `getAliases`. Схема слоев (`getScheme`) ни от чего из этого не зависит и тоже читается только
 * по первому обращению.
 */

import { createLogger } from '@/debug.js';
import type { RepoFs } from '@/repo-fs/index.js';
import { getRepoFs, resolveRoot } from '@/repo-fs/index.js';
import type { Alias, Scheme, SchemeOverrides } from '@/raw-settings/index.js';
import {
    getAliases,
    getAliasesFromPaths,
    getRepoRoot,
    getScheme,
    getTsconfigName,
    hasAliases,
} from '@/raw-settings/index.js';
import type { TsconfigPaths } from '@/tsconfig/index.js';
import { loadTsconfigPaths } from '@/tsconfig/index.js';

const debug = createLogger('config');

/**
 * Общие настройки WELD, подставленные вместо `settings.weld` — опции правила или флаги CLI.
 *
 * Поля схемы (`SchemeOverrides`) не сужаются: схема ESLint разрешает для них любые значения, а
 * проверяются они только при запросе `getScheme()`.
 */
export type WeldResolveOptions = {
    repoRoot?: string;
    aliasesBaseUrl?: string;
    aliases?: Record<string, unknown>;
    tsconfig?: string;
} & SchemeOverrides;

/** Вход резолва — всё, что нужно знать о файле, без единого типа ESLint. */
export type WeldResolveInput = {
    /** Реальный путь линтуемого файла: от него ищется tsconfig и считается виртуальный путь. */
    filename: string;
    settings: unknown;
    cwd: string;
    options?: WeldResolveOptions;
};

/** Части эффективной конфигурации: каждая считается по первому обращению. */
export type WeldTarget = {
    /** Виртуальный путь от корня репозитория; `null` — файл вне корня. */
    getFromFile(): string | null;
    /** Реальный корень; `null` только при инъекции `repoFsOverride` — у поддельного хоста его нет. */
    getRoot(): string | null;
    getRepoFs(): RepoFs;
    getAliases(): Alias[];
    /**
     * Схема слоев; отсутствующая или кривая — исключение. Спрашивающий схему без нее работать не
     * может, а потребители, которым она не нужна, ее не читают.
     */
    getScheme(): Scheme;
};

function lazy<T>(compute: () => T): () => T {
    let cached: { value: T } | null = null;

    return () => {
        cached ??= { value: compute() };
        return cached.value;
    };
}

/**
 * Эффективная конфигурация файла набором ленивых частей.
 *
 * Неиспользуемая часть не считается, а ошибка конфигурации приходит исключением из того геттера,
 * который ее затребовал.
 *
 * @param repoFsOverride Шов для тестов: подменяет `RepoFs` целиком, и реального корня тогда нет.
 */
export function resolveForFile(input: WeldResolveInput, repoFsOverride?: RepoFs): WeldTarget {
    const options = input.options ?? {};
    const { settings, cwd, filename } = input;

    const explicitAliases = (): boolean => hasAliases(settings, options.aliases);

    // tsconfig общий для `getRoot` и `getAliases`: при явных алиасах он не читается вовсе.
    const tsconfig = lazy((): TsconfigPaths | null =>
        loadTsconfigPaths(filename, {
            configName: getTsconfigName(settings, options.tsconfig),
        }),
    );

    const coverDirs = (): string[] => {
        if (repoFsOverride !== undefined || explicitAliases()) {
            return [];
        }

        return tsconfig()?.realAnchors ?? [];
    };

    const root = lazy((): string | null => {
        if (repoFsOverride !== undefined) {
            return null;
        }

        return resolveRoot(settings, cwd, options.repoRoot, coverDirs());
    });

    const repoFs = lazy(
        (): RepoFs => repoFsOverride ?? getRepoFs(settings, cwd, options.repoRoot, coverDirs()),
    );

    const fromFile = lazy(() => repoFs().toVirtual(filename));

    const aliases = lazy((): Alias[] => {
        // Приоритет источников: `options.aliases` → `settings.weld.aliases` → автопоиск tsconfig.
        if (explicitAliases()) {
            return getAliases(settings, options.aliases, options.aliasesBaseUrl);
        }

        if (repoFsOverride !== undefined) {
            return [];
        }

        return aliasesFromTsconfig(
            tsconfig(),
            repoFs(),
            getRepoRoot(settings, options.repoRoot) !== undefined,
        );
    });

    const scheme = lazy(() => getScheme(settings, options));

    return {
        getFromFile: fromFile,
        getRoot: root,
        getRepoFs: repoFs,
        getAliases: aliases,
        getScheme: scheme,
    };
}

function aliasesFromTsconfig(
    found: TsconfigPaths | null,
    repoFs: RepoFs,
    hasExplicitRoot: boolean,
): Alias[] {
    if (found === null) {
        return [];
    }

    // tsconfig вне явного root отбрасывается целиком: иначе поведение зависело бы от директорий над ним.
    if (hasExplicitRoot && repoFs.toVirtual(found.configPath) === null) {
        debug('discarding tsconfig %s: it is outside the explicit root', found.configPath);
        return [];
    }

    const virtualBase = repoFs.toVirtual(found.realBaseDir);
    if (virtualBase === null) {
        debug(
            'discarding tsconfig %s: base dir %s is outside the root',
            found.configPath,
            found.realBaseDir,
        );
        return [];
    }

    try {
        return getAliasesFromPaths(found.paths, virtualBase, found.configPath);
    } catch (error) {
        debug('discarding tsconfig %s: %s', found.configPath, error);
        return [];
    }
}
