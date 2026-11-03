/**
 * Состояние значения в небросающих диагностических разборах слоя: `checkAliasesFormat`,
 * `parseSchemeReport` и отчет `src/config/`.
 */
export type SettingState<T = unknown> =
    | { status: 'value'; value: T }
    | { status: 'invalid'; message: string }
    | { status: 'unresolved'; dependency: string }
    | { status: 'not-set' };
