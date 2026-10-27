/**
 * Общий каркас правил: настройки WELD, объявленные один раз, и связка «ESLint-контекст → всё, что
 * правилу нужно до первого узла».
 *
 * Сам резолв эффективной конфигурации живет в `src/config/`: он работает над обычным объектом и не
 * знает про ESLint, потому что тем же резолвом пользуется CLI. Здесь остается адаптер —
 * единственное место, где `Rule.RuleContext` встречается с резолвом: он собирает вход из полей
 * контекста, читает нужные части и возвращает прежний `WeldContext`.
 *
 * `src/config/` лежит выше `src/host/` и `src/settings/`: `getRepoRoot`/`getAliases` знают формат
 * конфига, `getFsHost` знает про диск, а решение «настройки правила перекрывают `settings.weld`» не
 * принадлежит ни тому, ни другому. Сами слои при этом не изолированы полностью: `host` берет корень
 * репозитория через `getRepoRoot` — осознанная односторонняя зависимость `host → settings`
 * (см. `getFsHost` в `src/host/fs.ts`).
 *
 * Правило не перечисляет `repoRoot`/`aliasesBaseUrl`/`aliases`/`tsconfig` ни у себя в `meta.schema`, ни
 * в типе своих опций и не собирает `FsHost` руками — иначе общие настройки потребовали бы правки
 * каждого правила по отдельности.
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
     * тип входа резолва, свойства те же, что у `WELD_OPTION_PROPERTIES`). Правило читает их
     * отсюда, а не из `context.options[0]`: иначе каждое повторяло бы каст и дефолт, и форма опций
     * знала бы о себе в двух местах.
     */
    options: TOwnOptions & WeldResolveOptions;
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
