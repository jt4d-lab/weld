/**
 * Debug-логирование плагина. Namespace строится здесь и только здесь: README объявляет
 * `DEBUG=eslint-plugin-weld:*` контрактом, а три независимых литерала по модулям этот контракт
 * ничем не удерживали.
 */

import createDebug from 'debug';
import type { Debugger } from 'debug';

/** Имя пакета — оно же корень debug-namespace и `plugin.meta.name`. */
export const PACKAGE_NAME = 'eslint-plugin-weld';

/** Логгер модуля: `scope` — короткое имя вроде `fs`, `root`, `aliases`. */
export function createLogger(scope: string): Debugger {
    return createDebug(`${PACKAGE_NAME}:${scope}`);
}
