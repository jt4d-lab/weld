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
import { WELD_OPTION_PROPERTIES, resolveWeldContext } from '@/rules/context.js';
import { getLayerSchema, hasLayers, plainLayerName } from '@/settings/index.js';

import type { MessageId } from '@/rules/no-illegal-layer-dependency/core/verdict.js';
import { declareHint } from '@/rules/no-illegal-layer-dependency/core/verdict.js';
import { createChecker } from '@/rules/no-illegal-layer-dependency/pipeline.js';

const debug = createLogger('no-illegal-layer-dependency');

/**
 * Сообщения правила: вердикт плюс `undeclaredLayer` — единственное, которое репортится на файл
 * целиком и потому в {@link MessageId} не входит. `satisfies` связывает ключи с этим типом: без него
 * переименование в одном из двух мест компилировалось бы и падало на рантайме.
 *
 * `horizontalDependency` не говорит «из другой директории»: у кода без слоя владельца нет, и
 * горизонталью оказывается даже импорт соседнего файла той же директории (см. `core/verdict.ts`).
 * Список, в котором объявляется смежный повтор, назван данными: слой модуля повторяется в
 * `moduleLayers`, и повтор в `layers` разбор схемы отверг бы.
 *
 * `illegalDependencyAcrossLevels` — то же нарушение направления, но между двумя слоями с одним
 * простым именем (единственная такая пара — `@unknown` вне модулей и `@unknown` внутри модуля).
 * Отдельное сообщение, а не уточнение в `illegalDependency`: там уровень был бы пустым в каждом
 * обычном нарушении, а здесь без него текст называет обоими концами один и тот же слой.
 *
 * Совет в `moduleInternals` назван конкретной настройкой, а не шаблоном: вердикт выдаёт это
 * сообщение только при объявленном `@modules`, а значит `'@unknown' in moduleLayers` — всегда
 * конфиг, который разбор схемы примет. Схему без `@modules` тот же вердикт уводит в
 * `undeclaredTargetLayer` с советом объявить `@modules`.
 */
const messages = {
    illegalDependency:
        "Illegal layer dependency: '{{fromLayer}}' must not import from '{{toLayer}}'.",
    illegalDependencyAcrossLevels:
        "Illegal layer dependency: '{{fromLayer}}' {{fromLevel}} must not import from '{{toLayer}}' {{toLevel}}. Same name, different layers: they are declared separately in layers and moduleLayers.",
    horizontalDependency:
        "Illegal layer dependency: '{{layer}}' must not import from another '{{layer}}'. Declare '{{layer}}' twice in a row in {{list}} to allow horizontal imports.",
    undeclaredLayer:
        "This file belongs to '{{layer}}', which is not declared in the layer schema. Move the file into a layer, or declare {{declare}}.",
    undeclaredTargetLayer:
        "'{{target}}' belongs to '{{layer}}', which is not declared in the layer schema. Move it into a layer, or declare {{declare}}.",
    moduleInternals:
        "'{{fromLayer}}' must not import internals of another module: '{{target}}' has no layer inside its module. Import through the module barrel, or declare '@unknown' in moduleLayers.",
} satisfies Record<MessageId | 'undeclaredLayer', string>;

/**
 * Собственные опции правила — те же три настройки схемы, что и в `settings.weld`. Схема описывает
 * только форму значения (массив строк): так опечатка в типе становится обычной ошибкой конфига
 * ESLint, а не исключением из разбора, которое валит весь прогон. Смысловые проверки (спец-имена,
 * пересечение списков, место `@modules`) остаются за `src/settings/` — вторая их копия здесь
 * разошлась бы с первой. Общие опции подмешивает {@link WELD_OPTION_PROPERTIES}.
 */
const SCHEMA_OPTION_PROPERTIES = {
    layers: { type: 'array', items: { type: 'string' } },
    moduleLayers: { type: 'array', items: { type: 'string' } },
    moduleDir: { type: 'string' },
} as const;

/**
 * Правило включено, а схемы нет: проверять нечего, и молча отключиться значило бы зелёный линт без
 * единой проверки направления. Исключение ESLint не репортит, а пробрасывает наружу — прогон падает
 * на первом же файле под правилом, как и при кривых `aliases`.
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

            // Права источника приходят из проверки уже схлопнутыми (неразмеченный код модуля живёт
            // по правам модуля): схлопывание знает `core/verdict.ts`, а считать его здесь во второй
            // раз значило бы завести второе место, которое про него знает.
            const { fromRights: fromLayer, checkImport } = createChecker({
                fromFile,
                aliases: weld.aliases,
                schema,
            });

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

            // Реэкспорт обходится наравне с импортом: `export { X } from '@/app/thing'` — такое же
            // ребро графа зависимостей, как и `import`, и пропуск реэкспортов делал бы запрет
            // обходимым переписыванием пары `import` + `export` в одну строку. Сосед
            // (`no-barrel-bypass`) их по-прежнему не обходит — там баррель из них и собран.
            return createSpecifierVisitor(
                (sourceNode: SpecifierNode) => {
                    const report = checkImport(sourceNode.value);
                    if (report === null) {
                        return;
                    }

                    debug(
                        '%s [%s]: %s is %s',
                        fromFile,
                        fromLayer,
                        sourceNode.value,
                        report.messageId,
                    );

                    context.report({
                        node: sourceNode,
                        messageId: report.messageId,
                        data: report.data,
                    });
                },
                { reExports: true },
            );
        },
    };
}
