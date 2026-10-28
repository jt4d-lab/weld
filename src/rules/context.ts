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
import type { FsHost } from '@/host/index.js';
import type { Alias } from '@/settings/index.js';

/**
 * Свойства `meta.schema`, общие для всех правил: те же настройки, что и в `settings.weld`, но
 * заданные на самом правиле. Правило подмешивает их к своим спредом.
 */
export const WELD_OPTION_PROPERTIES = {
    repoRoot: { type: 'string' },
    aliasesBaseUrl: { type: 'string' },
    aliases: { type: 'object' },
    tsconfig: { type: 'string' },
} as const;

/** Всё, что правило берет из контекста до обхода AST. */
export type WeldContext<TOwnOptions = unknown> = {
    /** Файл, который сейчас линтуется, — виртуальный путь от корня репозитория. */
    fromFile: string;
    aliases: Alias[];
    fsHost: FsHost;
    /**
     * Опции правила, уже разобранные: собственные опции правила плюс общие (`WeldResolveOptions` —
     * свойства те же, что у `WELD_OPTION_PROPERTIES`).
     */
    options: TOwnOptions & WeldResolveOptions;
};

/**
 * `null` — линтуемый файл вне корня репозитория, и правилу нечего проверять: виртуального пути у
 * него нет.
 *
 * `fsHostOverride` — шов для тестов, общий на все правила: подменяет файловую систему целиком, и
 * тогда опция `repoRoot` ни на что не влияет.
 *
 * `TOwnOptions` — только собственные опции правила: общие известны здесь и подмешиваются сами.
 */
export function resolveWeldContext<TOwnOptions = unknown>(
    context: Rule.RuleContext,
    fsHostOverride?: FsHost,
): WeldContext<TOwnOptions> | null {
    const options = (context.options[0] ?? {}) as TOwnOptions & WeldResolveOptions;
    const target = resolveForFile(
        {
            filename: context.filename,
            settings: context.settings,
            cwd: context.cwd,
            options,
        },
        fsHostOverride,
    );

    const fromFile = target.getFromFile();
    if (fromFile === null) {
        return null;
    }

    return { fromFile, aliases: target.getAliases(), fsHost: target.getFsHost(), options };
}
