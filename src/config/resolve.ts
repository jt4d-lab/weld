/**
 * Эффективная конфигурация WELD для файла — то, что видит правило: `settings.weld` плюс автопоиск
 * алиасов в tsconfig и подъем корня до якорей.
 *
 * Модуль работает над обычным объектом (`{ filename, settings, cwd, options }`) и не импортирует
 * `eslint`: про `Rule.RuleContext` знает только адаптер `src/rules/context.ts`. Второй потребитель
 * того же резолва — CLI, поэтому один источник правды, а не две похожие реализации.
 *
 * Резолв ленивый: `resolveForFile` только собирает замыкания, а каждая часть считается по первому
 * обращению и запоминается. Сегодняшнему правилу нужны и корень, и алиасы, но следующее возьмет
 * другую часть — и кривая неиспользуемая часть не должна валить его на первом же файле.
 *
 * Порядок зависимостей: tsconfig (нужны `realAnchors` для корня и `paths` для алиасов) →
 * `getRoot`/`getFsHost` → `getAliases`. Новые части добавляются сюда же, когда их просит очередное
 * правило, — граница остается узкой.
 */

import { createLogger } from '@/debug.js';
import type { FsHost } from '@/host/index.js';
import { getFsHost, resolveRoot } from '@/host/index.js';
import type { Alias } from '@/settings/index.js';
import {
    getAliases,
    getAliasesFromPaths,
    getRepoRoot,
    getTsconfigName,
    hasAliases,
} from '@/settings/index.js';
import type { TsconfigPaths } from '@/tsconfig/index.js';
import { loadTsconfigPaths } from '@/tsconfig/index.js';

const debug = createLogger('config');

/**
 * Общие настройки WELD, подставленные вместо `settings.weld` — опции правила или флаги CLI. Те же
 * свойства, что у `WELD_OPTION_PROPERTIES`, и та же валидация в `src/settings/`: значение опции
 * обязано проверяться теми же правилами, что и конфиг.
 */
export type WeldResolveOptions = {
    repoRoot?: string;
    aliasesBaseUrl?: string;
    aliases?: Record<string, unknown>;
    tsconfig?: string;
};

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
    /** Реальный корень; `null` только при инъекции `fsHostOverride` — у поддельного хоста его нет. */
    getRoot(): string | null;
    getFsHost(): FsHost;
    getAliases(): Alias[];
};

/**
 * Ленивое значение: вычисляется один раз, при первом обращении. Успешный результат запоминается,
 * исключение — нет: на сломанном конфиге потребитель должен получать ошибку на каждом файле, а не
 * на первом (то же решение, что у кэша алиасов в `src/settings/`).
 */
function lazy<T>(compute: () => T): () => T {
    let cached: { value: T } | null = null;

    return () => {
        cached ??= { value: compute() };
        return cached.value;
    };
}

/**
 * `fsHostOverride` — шов для тестов, общий на все правила и CLI: подменяет файловую систему целиком,
 * и тогда ни опция `repoRoot`, ни tsconfig ни на что не влияют. Шов именно параметром, а не
 * модульным мутабельным состоянием, иначе тесты зависели бы от порядка запуска.
 */
export function resolveForFile(input: WeldResolveInput, fsHostOverride?: FsHost): WeldTarget {
    const options = input.options ?? {};
    const { settings, cwd, filename } = input;

    // «Заданы явно» — присутствие ключа: пустой `{}` тоже выключает автопоиск. Кэшировать здесь нечего:
    // `hasAliases` только читает объект конфига, диска не касается.
    const explicitAliases = (): boolean => hasAliases(settings, options.aliases);

    // tsconfig — общая ленивая часть `getRoot` и `getAliases`, и только внутри них: при явных
    // алиасах он не читается вовсе (сегодняшнее поведение), иначе проекты с
    // `settings.weld.aliases` платили бы за поиск tsconfig на первом файле директории.
    const tsconfig = lazy((): TsconfigPaths | null =>
        loadTsconfigPaths(filename, {
            configName: getTsconfigName(settings, options.tsconfig),
        }),
    );

    // Автопоиск алиасов — единственная причина, по которой корень обязан покрыть якоря: при явных
    // алиасах якорей нет, а при явном root их судьбу решает отбрасывание непокрытых (см.
    // `aliasesFromTsconfig`).
    const coverDirs = (): string[] => {
        if (fsHostOverride !== undefined || explicitAliases()) {
            return [];
        }

        return tsconfig()?.realAnchors ?? [];
    };

    const root = lazy((): string | null => {
        if (fsHostOverride !== undefined) {
            return null;
        }

        return resolveRoot(settings, cwd, options.repoRoot, coverDirs());
    });

    const fsHost = lazy(
        (): FsHost => fsHostOverride ?? getFsHost(settings, cwd, options.repoRoot, coverDirs()),
    );

    const fromFile = lazy(() => fsHost().toVirtual(filename));

    const aliases = lazy((): Alias[] => {
        // Приоритет источников: `options.aliases` → `settings.weld.aliases` → автопоиск tsconfig.
        if (explicitAliases()) {
            return getAliases(settings, options.aliases, options.aliasesBaseUrl);
        }

        // Инъекция `fsHostOverride` автопоиск выключает тоже: тесты на фейковой ФС не должны
        // зависеть от содержимого реального диска.
        if (fsHostOverride !== undefined) {
            return [];
        }

        return aliasesFromTsconfig(
            tsconfig(),
            fsHost(),
            getRepoRoot(settings, options.repoRoot) !== undefined,
        );
    });

    return {
        getFromFile: fromFile,
        getRoot: root,
        getFsHost: fsHost,
        getAliases: aliases,
    };
}

/**
 * Алиасы из найденного tsconfig. Любая проблема — не алиасы, а debug: кривой или чужой tsconfig не
 * должен валить линт (в отличие от явных `settings.weld.aliases`/`options.aliases`, где падение —
 * намеренное).
 */
function aliasesFromTsconfig(
    found: TsconfigPaths | null,
    fsHost: FsHost,
    hasExplicitRoot: boolean,
): Alias[] {
    if (found === null) {
        return [];
    }

    // tsconfig, найденный вне явного root, отбрасывается целиком: иначе поведение зависело бы от
    // содержимого директорий над root (например, tsconfig репозитория над тестовой фикстурой).
    if (hasExplicitRoot && fsHost.toVirtual(found.configPath) === null) {
        debug('discarding tsconfig %s: it is outside the explicit root', found.configPath);
        return [];
    }

    const virtualBase = fsHost.toVirtual(found.realBaseDir);
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
