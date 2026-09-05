/**
 * Вход в ядро: собирает `parseSpecifier` → `findBarrier` → `renderSpecifier` в одну проверку.
 */

import { dirname } from '../../path/posix.js';
import type { Alias } from '../../settings/aliases.js';

import { findBarrier } from './core/barrier.js';
import { parseSpecifier, renderSpecifier } from './core/specifier.js';
import type { Verdict } from './core/verdict.js';

export type CheckInput = { specifier: string; fromFile: string; aliases: Alias[] };
export type CheckEnv = { hasEntryPoint(dir: string): boolean };

/**
 * Возвращает `Verdict` с исправленным специфаером при нарушении границы, иначе `{ kind: 'ok' }`.
 * Найденная граница наружу не отдаётся: она нужна только для рендера исправленного пути.
 */
export function checkImport(input: CheckInput, env: CheckEnv): Verdict {
    const fromDir = dirname(input.fromFile);

    const target = parseSpecifier(input.specifier, fromDir, input.aliases);
    if (target === null) {
        return { kind: 'ok' };
    }

    const barrier = findBarrier(fromDir, target.path, env.hasEntryPoint);
    if (barrier === null) {
        return { kind: 'ok' };
    }

    return {
        kind: 'crossesBarrier',
        suggestion: renderSpecifier(target.form, fromDir, barrier, input.aliases),
    };
}
