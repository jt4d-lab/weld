/**
 * Общий каркас правил: настройки WELD, объявленные один раз, и связка «ESLint-контекст → всё, что
 * правилу нужно до первого узла».
 *
 * Здесь только адаптер: вход резолва собирается из полей `Rule.RuleContext`, резолв живёт в
 * `src/config/`.
 */

import type { Rule } from 'eslint';

import { resolveForFile } from '@/config/index.js';
import type { WeldResolveOptions } from '@/config/index.js';
import type { RepoFs } from '@/repo-fs/index.js';
import type { Alias, Scheme } from '@/raw-settings/index.js';

/**
 * Свойства `meta.schema`, общие для всех правил.
 *
 * Те же настройки, что и в `settings.weld`, но заданные на самом правиле: правило подмешивает их к
 * своим спредом.
 *
 * Поля схемы слоев объявлены разрешительными (`{}`) намеренно: проверяются они вместе, при запросе
 * схемы (см. `WeldContext.getScheme`), и сломанная схема не должна валить ESLint на файле правилу,
 * которому она не нужна.
 */
export const WELD_OPTION_PROPERTIES = {
    repoRoot: { type: 'string' },
    aliasesBaseUrl: { type: 'string' },
    aliases: { type: 'object' },
    tsconfig: { type: 'string' },
    srcDir: {},
    modulesDir: {},
    layers: {},
    moduleLayers: {},
    flatModules: {},
} as const;

/** Всё, что правило берет из контекста до обхода AST. */
export type WeldContext<TOwnOptions = unknown> = {
    /** Файл, который сейчас линтуется, — виртуальный путь от корня репозитория. */
    fromFile: string;
    aliases: Alias[];
    repoFs: RepoFs;
    /**
     * Опции правила, уже разобранные: собственные опции правила плюс общие (`WeldResolveOptions` —
     * свойства те же, что у `WELD_OPTION_PROPERTIES`).
     */
    options: TOwnOptions & WeldResolveOptions;
    /**
     * Схема слоев: считается по первому обращению, поэтому создание контекста ее не разбирает и
     * кривая схема не валит правило, которому она не нужна.
     */
    getScheme: () => Scheme;
};

/**
 * Собирает всё, что правилу нужно до обхода AST.
 *
 * @typeParam TOwnOptions Только собственные опции правила: общие известны здесь и подмешиваются
 * сами.
 * @param repoFsOverride Шов для тестов, общий на все правила: подменяет файловую систему целиком,
 * и тогда опция `repoRoot` ни на что не влияет.
 * @returns `null`, если линтуемый файл вне корня репозитория: виртуального пути у него нет, и
 * правилу нечего проверять.
 */
export function resolveWeldContext<TOwnOptions = unknown>(
    context: Rule.RuleContext,
    repoFsOverride?: RepoFs,
): WeldContext<TOwnOptions> | null {
    const options = (context.options[0] ?? {}) as TOwnOptions & WeldResolveOptions;
    const target = resolveForFile(
        {
            filename: context.filename,
            settings: context.settings,
            cwd: context.cwd,
            options,
        },
        repoFsOverride,
    );

    const fromFile = target.getFromFile();
    if (fromFile === null) {
        return null;
    }

    return {
        fromFile,
        aliases: target.getAliases(),
        repoFs: target.getRepoFs(),
        options,
        getScheme: target.getScheme,
    };
}
