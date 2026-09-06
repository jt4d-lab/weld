/**
 * Вход в ядро: собирает `parseSpecifier` → `findBarrier` → `renderSpecifier` в одну проверку.
 */

import { createLogger } from '@/debug.js';
import type { FsHost } from '@/host/index.js';
import { parseSpecifier, renderSpecifier } from '@/imports/index.js';
import { dirname } from '@/path/index.js';
import type { Alias } from '@/settings/index.js';

import { findBarrier } from '@/rules/no-barrel-bypass/core/barrier.js';

const debug = createLogger('no-barrel-bypass');

type CheckerInput = { fromFile: string; aliases: Alias[] };

export type Host = Pick<FsHost, 'hasEntryPoint'>;

/**
 * Проверка одного специфаера: возвращает исправленный специфаер при нарушении границы, иначе `null`
 * — нарушения нет. Найденная граница наружу не отдаётся: она нужна только для рендера пути.
 *
 * Проверка собирается на файл, а не на импорт: `fromDir` от линтуемого файла не зависит от того,
 * какой специфаер сейчас разбирается.
 */
export function createChecker(
    { fromFile, aliases }: CheckerInput,
    host: Host,
): (specifier: string) => string | null {
    const fromDir = dirname(fromFile);

    return function checkImport(specifier: string): string | null {
        const target = parseSpecifier(specifier, fromDir, aliases);
        if (target === null) {
            debug('%s: %s external dependency', fromFile, specifier);
            return null;
        }

        const barrier = findBarrier(fromDir, target.path, host.hasEntryPoint);
        if (barrier === null) {
            debug('%s: %s -> %s, no barrier on the way', fromFile, specifier, target.path);
            return null;
        }

        return renderSpecifier(target.form, fromDir, barrier, aliases, target.extension);
    };
}
