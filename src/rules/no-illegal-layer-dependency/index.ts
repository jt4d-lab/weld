/**
 * Правило `weld/no-illegal-layer-dependency`: ловит импорты, идущие против порядка слоёв, который
 * проект объявил в своей схеме.
 *
 * Здесь остаётся только то, что принадлежит правилу как ESLint-правилу: схема опций, тексты
 * сообщений и два репорта — на файл целиком (его слоя нет в схеме) и на литерал специфаера. Сам
 * вердикт живёт в `core/`, склейка разбора — в `pipeline.ts`, настройки и `FsHost` даёт
 * `resolveWeldContext`.
 *
 * Схему объявляет само правило, а не общий `WELD_OPTION_PROPERTIES`: соседние правила схему не
 * читают, и принимать `layers` в их опциях значило бы принимать и молча игнорировать. По той же
 * причине схема не идёт в `WeldContext` — кривой `settings.weld.layers` уронил бы `no-barrel-bypass`,
 * которому она не нужна.
 */

import type { Rule } from 'eslint';

import { createLogger } from '@/debug.js';
import type { FsHost } from '@/host/index.js';
import type { SpecifierNode } from '@/imports/index.js';
import { createSpecifierVisitor } from '@/imports/index.js';
import { getLayerSchema, hasLayers, plainLayerName } from '@/settings/index.js';

import { WELD_OPTION_PROPERTIES, resolveWeldContext } from '@/rules/context.js';
import { declareHint, sourceRights } from '@/rules/no-illegal-layer-dependency/core/verdict.js';
import { createChecker } from '@/rules/no-illegal-layer-dependency/pipeline.js';

const debug = createLogger('no-illegal-layer-dependency');

const messages = {
    illegalDependency:
        "Illegal layer dependency: '{{fromLayer}}' must not import from '{{toLayer}}'.",
    horizontalDependency:
        "Illegal layer dependency: '{{layer}}' must not import from a different '{{layer}}' directory.",
    undeclaredLayer:
        "This file belongs to '{{layer}}', which is not declared in the layer schema. Move the file into a layer, or declare {{declare}}.",
    undeclaredTargetLayer:
        "'{{target}}' belongs to '{{layer}}', which is not declared in the layer schema. Move it into a layer, or declare {{declare}}.",
    moduleInternals:
        "'{{fromLayer}}' must not import internals of another module: '{{target}}' has no layer inside its module. Import through the module barrel, or declare '@unknown' in moduleLayers.",
};

/**
 * Собственные опции правила — те же три настройки схемы, что и в `settings.weld`. Значения не
 * типизуются подробнее: их разбирает и проверяет `src/settings/`, и вторая проверка здесь разошлась
 * бы с первой. Общие опции подмешивает {@link WELD_OPTION_PROPERTIES}.
 */
const SCHEMA_OPTION_PROPERTIES = {
    layers: { type: 'array' },
    moduleLayers: { type: 'array' },
    moduleDir: { type: 'string' },
} as const;

/**
 * Правило включено, а схемы нет: проверять нечего, и молча отключиться значило бы зелёный линт без
 * единой проверки направления. Падение на каждом файле — как при кривых `aliases`.
 */
const MISSING_SCHEMA =
    'weld/no-illegal-layer-dependency requires a layer schema: set settings.weld.layers or options.layers';

/**
 * `fsHost` — для инъекции в тестах, шов общий на все правила. Сам диск правилу не нужен: слой
 * читается из имён сегментов пути, и существование цели импорта ни на что не влияет. `FsHost` здесь
 * только виртуализует путь линтуемого файла.
 */
export function createRule(fsHost?: FsHost): Rule.RuleModule {
    return {
        meta: {
            type: 'problem',
            docs: {
                description: 'disallow imports that go against the declared layer order',
                url: 'https://github.com/jt4d-lab/weld/blob/master/docs/rules/no-illegal-layer-dependency.md',
            },
            // `fixable`/`hasSuggestions` не объявляются: нарушение направления правкой пути не
            // исправляется — его исправляет перенос кода между слоями.
            schema: [
                {
                    type: 'object',
                    properties: {
                        ...SCHEMA_OPTION_PROPERTIES,
                        ...WELD_OPTION_PROPERTIES,
                    },
                    additionalProperties: false,
                },
            ],
            messages,
        },
        create(context) {
            const weld = resolveWeldContext(context, fsHost);
            if (weld === null) {
                return {};
            }

            if (!hasLayers(context.settings, weld.options)) {
                throw new Error(MISSING_SCHEMA);
            }

            const { fromFile } = weld;
            const schema = getLayerSchema(context.settings, weld.options);
            const { from, checkImport } = createChecker({
                fromFile,
                aliases: weld.aliases,
                schema,
            });

            // Права источника — уже схлопнутые: неразмеченный код модуля живёт по правам модуля, и
            // спрашивать схему про `module:unknown` незачем.
            const fromLayer = sourceRights(from.layer);
            if (!schema.last.has(fromLayer)) {
                debug('%s: layer %s is not declared in the schema', fromFile, fromLayer);

                // Импорты такого файла не проверяются: слоя у него нет, а значит нет и прав — без
                // разметки каждый его импорт был бы нарушением, и сообщение утонуло бы в них.
                return {
                    Program(node) {
                        context.report({
                            node,
                            messageId: 'undeclaredLayer',
                            data: {
                                layer: plainLayerName(fromLayer),
                                declare: declareHint(fromLayer),
                            },
                        });
                    },
                };
            }

            return createSpecifierVisitor((sourceNode: SpecifierNode) => {
                const report = checkImport(sourceNode.value);
                if (report === null) {
                    return;
                }

                debug('%s [%s]: %s is %s', fromFile, fromLayer, sourceNode.value, report.messageId);

                context.report({
                    node: sourceNode,
                    messageId: report.messageId,
                    data: report.data,
                });
            });
        },
    };
}
