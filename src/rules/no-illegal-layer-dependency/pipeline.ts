/**
 * Вход в ядро правила направления зависимостей: собирает `parseSpecifier` → `layerOf` → `decide` в
 * одну проверку. Своего решения здесь нет — есть склейка и подстановка специфаера, как он записан в
 * исходнике: вердикт о путях знает, о тексте импорта нет.
 *
 * Проверка собирается на файл, а не на импорт: слой линтуемого файла и его директория от того, какой
 * специфаер сейчас разбирается, не зависят.
 */

import { createLogger } from '@/debug.js';
import { parseSpecifier } from '@/imports/index.js';
import { dirname } from '@/path/index.js';
import type { Alias, LayerSchema, Qualified } from '@/settings/index.js';

import { layerOf } from '@/rules/no-illegal-layer-dependency/core/layer-of.js';
import type { MessageId } from '@/rules/no-illegal-layer-dependency/core/verdict.js';
import { decide, sourceRights } from '@/rules/no-illegal-layer-dependency/core/verdict.js';

const debug = createLogger('no-illegal-layer-dependency');

type CheckerInput = { fromFile: string; aliases: Alias[]; schema: LayerSchema };

/** Нарушение в виде, готовом для `context.report`: идентификатор сообщения и его данные. */
export type Report = { messageId: MessageId; data: Record<string, string> };

export type Checker = {
    /**
     * Права линтуемого файла — его слой, уже схлопнутый `sourceRights` (неразмеченный код модуля
     * живёт по правам модуля целиком). Наружу выходит потому, что файл со слоем вне схемы правило
     * репортит целиком, до обхода импортов, и называет его в репорте этим же именем: считать слой
     * второй раз значило бы опознавать один путь дважды, а схлопывать — завести второе место,
     * знающее про `sourceRights`.
     *
     * Полное положение файла (владелец, модуль) наружу не выходит: им судит импорты сам `decide`, а
     * правилу нужно только имя.
     */
    fromRights: Qualified;
    /** Нарушение или `null`, если импорт легален либо правилу не принадлежит. */
    checkImport: (specifier: string) => Report | null;
};

export function createChecker({ fromFile, aliases, schema }: CheckerInput): Checker {
    const fromDir = dirname(fromFile);
    const from = layerOf(fromFile, schema, 'file');

    // Схлопывание источника считается здесь, один раз на файл: тем же именем вердикт судит каждый
    // его импорт, его показывают логи обоих модулей, и по нему же правило спрашивает схему про сам
    // файл — один файл не должен появляться в одном прогоне под двумя именами.
    const fromRights = sourceRights(from.layer);

    return {
        fromRights,
        checkImport(specifier: string): Report | null {
            const target = parseSpecifier(specifier, fromDir, aliases);
            if (target === null) {
                debug('%s: %s external dependency', fromFile, specifier);
                return null;
            }

            const to = layerOf(target.path, schema, 'target');
            const verdict = decide(schema, from, to);
            if (verdict.ok) {
                debug(
                    '%s [%s]: %s -> %s [%s] allowed',
                    fromFile,
                    fromRights,
                    specifier,
                    target.path,
                    to.layer,
                );
                return null;
            }

            // `target` подставляется всем сообщениям без разбора: какие из них его показывают, знает
            // `meta.messages`, и повторять здесь этот список значило бы держать его в двух местах.
            return { messageId: verdict.messageId, data: { ...verdict.data, target: specifier } };
        },
    };
}
