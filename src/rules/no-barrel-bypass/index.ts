/**
 * Правило `weld/no-barrel-bypass`: ловит импорты, входящие внутрь модуля мимо его точки входа
 * (`index.<ext>`), и предлагает исправленный путь через `checkImport`.
 *
 * Всё, что не про баррели, — общее: настройки и `FsHost` даёт `resolveWeldContext`, обход и правку
 * специфаеров — `src/imports/nodes.ts`. Здесь остаётся вердикт и текст сообщения.
 */

import type { Rule } from 'eslint';

import { createLogger } from '@/debug.js';
import type { FsHost } from '@/host/index.js';
import type { SpecifierNode } from '@/imports/index.js';
import { createSpecifierVisitor, replaceSpecifier } from '@/imports/index.js';
import type { WeldOptions } from '@/rules/context.js';
import { WELD_OPTION_PROPERTIES, resolveWeldContext } from '@/rules/context.js';

import { createChecker } from '@/rules/no-barrel-bypass/pipeline.js';

const debug = createLogger('no-barrel-bypass');

const messages = {
    bypass: "Import bypasses the module barrel. Use '{{suggestion}}' instead of '{{original}}'.",
    useBarrel: "Import through '{{suggestion}}'.",
};

/** Своя опция у правила одна — остальные общие, см. {@link WELD_OPTION_PROPERTIES}. */
type RuleOptions = WeldOptions & { fix?: boolean };

/**
 * `fsHost` — для инъекции в тестах; без него файловую систему собирает `resolveWeldContext` из
 * `context.settings`/`context.cwd` и опции `root`. При инъекции опция `root` ни на что не влияет.
 */
export function createRule(fsHost?: FsHost): Rule.RuleModule {
    return {
        meta: {
            type: 'problem',
            docs: {
                description: 'disallow imports that reach into a module past its barrel',
                url: 'https://github.com/jt4d-lab/weld/blob/master/docs/rules/no-barrel-bypass.md',
            },
            fixable: 'code',
            hasSuggestions: true,
            schema: [
                {
                    type: 'object',
                    properties: {
                        fix: { type: 'boolean' },
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

            const { fromFile, aliases } = weld;
            const applyFix = (context.options[0] as RuleOptions | undefined)?.fix ?? true;
            const checkImport = createChecker({ fromFile, aliases }, weld.fsHost);

            return createSpecifierVisitor((sourceNode: SpecifierNode) => {
                const original = sourceNode.value;
                const suggestion = checkImport(original);

                if (suggestion === null) {
                    return;
                }

                debug(
                    '%s: crosses barrier, %s -> %s (fix=%o)',
                    fromFile,
                    original,
                    suggestion,
                    applyFix,
                );
                const fix = replaceSpecifier(sourceNode, suggestion);

                context.report({
                    node: sourceNode,
                    messageId: 'bypass',
                    data: { suggestion, original },
                    ...(applyFix
                        ? { fix }
                        : { suggest: [{ messageId: 'useBarrel', data: { suggestion }, fix }] }),
                });
            });
        },
    };
}
