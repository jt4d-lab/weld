import type { Rule } from 'eslint';

import { readAliases } from '../../settings/aliases.js';
import { isAbsolutePath, toPosix } from '../../path/posix.js';
import { checkImport, type CheckEnv } from './check.js';

type Options = { fix?: boolean };

type StringLiteral = { type: 'Literal'; value: string; raw: string };

/**
 * Фабрика правила: `env` инжектирует доступ к диску ({@link CheckEnv}), поэтому регистр
 * (`src/rules/index.ts`) вызывает её с fs-реализацией, а тесты — с фейком над `Set`.
 */
export function createRule(env: CheckEnv): Rule.RuleModule {
    return {
        meta: {
            type: 'problem',
            docs: {
                description: 'Запрещает импорты внутрь модуля мимо его точки входа (index-файла).',
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
            messages: {
                bypass: "Import bypasses the module barrel. Use '{{suggestion}}' instead of '{{original}}'.",
                useBarrel: "Import through '{{suggestion}}'.",
            },
        },

        create(context): Rule.RuleListener {
            const fromFile = toPosix(context.filename);
            if (!isAbsolutePath(fromFile)) {
                // например '<input>' при lintText без пути — арифметике не от чего отсчитывать
                return {};
            }

            const aliases = readAliases(context.settings, context.cwd);
            const { fix = false } = (context.options[0] as Options | undefined) ?? {};

            function checkLiteral(node: StringLiteral): void {
                const suggestion = checkImport({ specifier: node.value, fromFile, aliases }, env);
                if (suggestion === null) {
                    return;
                }

                report(context, node, suggestion, fix);
            }

            return {
                ImportDeclaration(node) {
                    if (isStringLiteral(node.source)) {
                        checkLiteral(node.source);
                    }
                },
                ImportExpression(node) {
                    if (isStringLiteral(node.source)) {
                        checkLiteral(node.source);
                    }
                },
                CallExpression(node) {
                    if (
                        node.callee.type === 'Identifier' &&
                        node.callee.name === 'require' &&
                        node.arguments.length === 1 &&
                        isStringLiteral(node.arguments[0])
                    ) {
                        checkLiteral(node.arguments[0]);
                    }
                },
            };
        },
    };
}

function isStringLiteral(node: unknown): node is StringLiteral {
    return (
        typeof node === 'object' &&
        node !== null &&
        (node as { type?: unknown }).type === 'Literal' &&
        typeof (node as { value?: unknown }).value === 'string'
    );
}

/**
 * Кавычки правки берутся из `raw[0]` исходного литерала, иначе автофикс перевёл бы проект
 * на свой стиль кавычек и подрался бы с prettier. `fix` (опция правила) решает только, куда
 * уходит одна и та же функция замены — в `fix` или в `suggest`, а не меняет саму правку.
 */
function report(
    context: Rule.RuleContext,
    node: StringLiteral,
    suggestion: string,
    applyFix: boolean,
): void {
    const quote = node.raw[0] ?? "'";
    const replacement = `${quote}${suggestion}${quote}`;
    // `StringLiteral` намеренно урезан до `type`/`value`/`raw` — `range`/`loc`/`parent` правилу
    // не нужны, но `replaceText`/`report` требуют полный `Rule.Node`; каст через `unknown`
    // оставляет целевой тип видимым вместо полного отключения проверки через `never`.
    const makeFix: Rule.ReportFixer = (fixer) =>
        fixer.replaceText(node as unknown as Rule.Node, replacement);

    context.report({
        node: node as unknown as Rule.Node,
        messageId: 'bypass',
        data: { suggestion, original: node.value },
        fix: applyFix ? makeFix : undefined,
        suggest: applyFix
            ? undefined
            : [
                  {
                      messageId: 'useBarrel',
                      data: { suggestion },
                      fix: makeFix,
                  },
              ],
    });
}
