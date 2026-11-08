/**
 * Вход в ядро: собирает `parseSpecifier` → `findBarrier` → `renderSpecifier` в одну проверку.
 */

import type { FsHost } from '@/repo-fs/index.js';
import type { SpecifierSkip } from '@/imports/index.js';
import { parseSpecifier, renderSpecifier } from '@/imports/index.js';
import { dirname } from '@/utils/path/index.js';
import type { Alias } from '@/settings/index.js';

import { findBarrier } from '@/rules/no-barrel-bypass/core/barrier.js';

type CheckerInput = { fromFile: string; aliases: Alias[] };

export type Host = Pick<FsHost, 'findModuleTarget' | 'hasEntryPoint'>;

/**
 * Итог проверки специфаера.
 *
 * `replace` — нарушение с исправленным специфаером, `intact` — нарушения нет, `skip` — специфаер
 * пропущен с причиной.
 */
export type CheckDecision =
    | { kind: 'replace'; target: string; barrier: string; suggestion: string }
    | { kind: 'intact'; target: string }
    | { kind: 'skip'; reason: SpecifierSkip };

/**
 * Фабрика проверки для одного файла: `fromDir` считается один раз, а не на каждый импорт.
 *
 * @returns `checkImport` — вердикт по одному специфаеру.
 */
export function createChecker(
    { fromFile, aliases }: CheckerInput,
    host: Host,
): (specifier: string) => CheckDecision {
    const fromDir = dirname(fromFile);
    const resolve = host.findModuleTarget;

    return function checkImport(specifier: string): CheckDecision {
        const parse = parseSpecifier(specifier, fromDir, aliases, resolve);
        if (parse.kind === 'skip') {
            return { kind: 'skip', reason: parse.reason };
        }

        const { target } = parse;
        const barrier = findBarrier(fromDir, target.path, host.hasEntryPoint);
        if (barrier === null) {
            return { kind: 'intact', target: target.path };
        }

        return {
            kind: 'replace',
            target: target.path,
            barrier,
            suggestion: renderSpecifier(target.form, fromDir, barrier, aliases, target.extension),
        };
    };
}
