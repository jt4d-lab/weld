import type { Alias } from '../../settings/aliases.js';
import { dirname } from '../../path/posix.js';
import { findBarrier } from './barrier.js';
import { parseSpecifier, renderSpecifier } from './specifier.js';

export type CheckInput = { specifier: string; fromFile: string; aliases: Alias[] };
export type CheckEnv = { hasEntryPoint(dir: string): boolean };

/**
 * Связка `parseSpecifier` → `findBarrier` → `renderSpecifier` — вход в ядро правила. Возвращает
 * исправленный путь при найденном нарушении или `null`, если нарушения нет: специфаер отсечён
 * `parseSpecifier`, либо `findBarrier` не нашёл границу. Найденная граница наружу не отдаётся —
 * см. раздел «Типы» плана.
 */
export function checkImport(input: CheckInput, env: CheckEnv): string | null {
    const fromDir = dirname(input.fromFile);

    const target = parseSpecifier(input.specifier, fromDir, input.aliases);
    if (target === null) {
        return null;
    }

    const barrier = findBarrier(fromDir, target.path, env.hasEntryPoint);
    if (barrier === null) {
        return null;
    }

    return renderSpecifier(target.form, fromDir, barrier, input.aliases);
}
