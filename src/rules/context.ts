/**
 * Общий каркас правил: настройки WELD, объявленные один раз, и связка «ESLint-контекст → всё, что
 * правилу нужно до первого узла».
 *
 * Живёт выше `src/host/` и `src/settings/`: `getRepoRoot`/`getAliases` знают формат конфига,
 * `getFsHost` знает про диск, а решение «настройки правила перекрывают `settings.weld`» не
 * принадлежит ни тому, ни другому. Сами слои при этом не изолированы полностью: `host` берёт корень
 * репозитория через `getRepoRoot` — осознанная односторонняя зависимость `host → settings`
 * (см. `getFsHost` в `src/host/fs.ts`).
 *
 * Правило не перечисляет `repoRoot`/`aliasesBaseUrl`/`aliases` ни у себя в `meta.schema`, ни в типе
 * своих опций и не собирает `FsHost` руками — иначе четвёртая общая настройка потребовала бы правки
 * каждого правила по отдельности.
 */

import type { Rule } from 'eslint';

import type { FsHost } from '@/host/index.js';
import { getFsHost } from '@/host/index.js';
import type { Alias } from '@/settings/index.js';
import { getAliases } from '@/settings/index.js';

/**
 * Свойства `meta.schema`, общие для всех правил: те же настройки, что и в `settings.weld`, но
 * заданные на самом правиле. Правило подмешивает их к своим спредом.
 */
export const WELD_OPTION_PROPERTIES = {
    repoRoot: { type: 'string' },
    aliasesBaseUrl: { type: 'string' },
    aliases: { type: 'object' },
} as const;

/**
 * Значения общих опций правила. Типы уже отсеяны `meta.schema` — в геттеры они идут как `unknown`,
 * а здесь нужны, чтобы подмешать общие опции к собственным опциям правила. Наружу тип не выходит:
 * правилу незачем его называть, пересечение делается здесь.
 */
type WeldOptions = {
    repoRoot?: string;
    aliasesBaseUrl?: string;
    aliases?: Record<string, unknown>;
};

/** Всё, что правило берёт из контекста до обхода AST. */
export type WeldContext<TOwnOptions = unknown> = {
    /** Файл, который сейчас линтуется, — виртуальный путь от корня репозитория. */
    fromFile: string;
    aliases: Alias[];
    fsHost: FsHost;
    /**
     * Опции правила, уже разобранные: собственные опции правила плюс общие. Правило читает их
     * отсюда, а не из `context.options[0]`: иначе каждое повторяло бы каст и дефолт, и форма опций
     * знала бы о себе в двух местах.
     */
    options: TOwnOptions & WeldOptions;
};

/**
 * `null` — линтуемый файл вне корня репозитория, и правилу нечего проверять: виртуального пути у
 * него нет.
 *
 * `fsHostOverride` — шов для тестов, общий на все правила: подменяет файловую систему целиком, и
 * тогда опция `repoRoot` ни на что не влияет. Шов именно параметром, а не модульным состоянием,
 * чтобы тесты не зависели от порядка запуска.
 *
 * `TOwnOptions` — только собственные опции правила: общие известны здесь и подмешиваются сами.
 */
export function resolveWeldContext<TOwnOptions = unknown>(
    context: Rule.RuleContext,
    fsHostOverride?: FsHost,
): WeldContext<TOwnOptions> | null {
    const options = (context.options[0] ?? {}) as TOwnOptions & WeldOptions;
    const fsHost = fsHostOverride ?? getFsHost(context.settings, context.cwd, options.repoRoot);

    const fromFile = fsHost.toVirtual(context.filename);
    if (fromFile === null) {
        return null;
    }

    return {
        fromFile,
        aliases: getAliases(context.settings, options.aliases, options.aliasesBaseUrl),
        fsHost,
        options,
    };
}
