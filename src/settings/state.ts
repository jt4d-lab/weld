export type SettingState<T = unknown> =
    | { status: 'value'; value: T }
    | { status: 'invalid'; message: string }
    | { status: 'unresolved'; dependency: string }
    | { status: 'not-set' };
