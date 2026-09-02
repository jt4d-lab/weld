// Значение подставляется на сборке (см. tsup.config.ts). При запуске исходников
// напрямую (тесты, ts-node) подмены не происходит — тогда используем заглушку.
declare const __PLUGIN_VERSION__: string;

export const version: string =
    typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '0.0.0-dev';
