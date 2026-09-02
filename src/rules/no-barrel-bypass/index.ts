/**
 * Правило `weld/no-barrel-bypass`: ловит импорты, входящие внутрь модуля мимо его точки входа
 * (`index.<ext>`), и предлагает исправленный путь через `checkImport`.
 */

import type { Rule } from 'eslint';
import type { Literal } from 'estree';

import { isAbsolutePath, toPosix } from '../../path/posix.js';
import { readAliases } from '../../settings/aliases.js';

import type { CheckEnv } from './check.js';
import { checkImport } from './check.js';

type Options = { fix?: boolean };

const messages = {
    bypass: "Import bypasses the module barrel. Use '{{suggestion}}' instead of '{{original}}'.",
    useBarrel: "Import through '{{suggestion}}'.",
};

type LiteralNode = { type: 'Literal'; value: string; raw?: string };

function isStringLiteral(node: { type: string } | null | undefined): node is LiteralNode {
    return (
        node != null &&
        node.type === 'Literal' &&
        typeof (node as unknown as Literal).value === 'string'
    );
}

export function createRule(env: CheckEnv): Rule.RuleModule {
    return {
        meta: {
            type: 'problem',
            docs: {
                description: 'запрещает импорты, входящие в модуль мимо его точки входа (баррель)',
                url: 'https://github.com/jt4d-lab/weld/blob/main/docs/rules/no-barrel-bypass.md',
            },
            fixable: 'code',
            hasSuggestions: true,
            schema: [
                {
                    type: 'object',
                    properties: {
                        fix: { type: 'boolean' },
                    },
                    additionalProperties: false,
                },
            ],
            messages,
        },
        create(context) {
            const fromFile = toPosix(context.filename);
            if (!isAbsolutePath(fromFile)) {
                return {};
            }

            const aliases = readAliases(context.settings, context.cwd);
            const { fix = false } = (context.options[0] as Options | undefined) ?? {};

            function check(reportNode: Rule.Node, sourceNode: LiteralNode): void {
                const original = sourceNode.value;
                const suggestion = checkImport({ specifier: original, fromFile, aliases }, env);
                if (suggestion === null) {
                    return;
                }

                const quote = sourceNode.raw?.[0] ?? '"';
                const replacement = `${quote}${suggestion}${quote}`;
                const applyFix = (fixer: Rule.RuleFixer): Rule.Fix =>
                    fixer.replaceText(sourceNode, replacement);

                context.report({
                    node: reportNode,
                    messageId: 'bypass',
                    data: { suggestion, original },
                    ...(fix
                        ? { fix: applyFix }
                        : {
                              suggest: [
                                  {
                                      messageId: 'useBarrel',
                                      data: { suggestion },
                                      fix: applyFix,
                                  },
                              ],
                          }),
                });
            }

            return {
                ImportDeclaration(node) {
                    if (isStringLiteral(node.source)) {
                        check(node, node.source);
                    }
                },
                ImportExpression(node) {
                    if (isStringLiteral(node.source)) {
                        check(node, node.source);
                    }
                },
                CallExpression(node) {
                    if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') {
                        return;
                    }
                    const arg = node.arguments[0];
                    if (isStringLiteral(arg)) {
                        check(node, arg);
                    }
                },
            };
        },
    };
}
