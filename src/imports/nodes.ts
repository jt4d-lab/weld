/**
 * Обход импортов в AST: где в дереве лежит строка-специфаер и как её заменить. Про баррели,
 * границы модулей и любое конкретное правило слой не знает — это общая инфраструктура импортов,
 * как и `specifier.ts`.
 *
 * Здесь же зафиксированы решения, которые иначе каждое правило принимало бы заново: репортим на
 * самом литерале пути, а не на всём операторе; кавычку для правки берём из исходника; `require`
 * считается импортом, а `export ... from` — нет.
 */

import type { Rule } from 'eslint';
import type { Literal } from 'estree';

/**
 * Строковый литерал специфаера — он же узел отчёта: сообщение указывается на самом пути, а не на
 * всём операторе импорта. `Rule.Node` в пересечении — ради `context.report`, `range` обязателен.
 */
export type SpecifierNode = Rule.Node & {
    type: 'Literal';
    value: string;
    raw: string;
    range: [number, number];
};

function isSpecifierNode(node: { type: string } | null | undefined): node is SpecifierNode {
    return (
        node != null &&
        node.type === 'Literal' &&
        typeof (node as unknown as Literal).value === 'string'
    );
}

/**
 * Слушатели для `create()`, вызывающие `onSpecifier` на каждом строковом специфаере импорта:
 * `import ... from`, динамический `import()` и `require()`.
 *
 * `export ... from` намеренно не обходится: у реэкспорта своя семантика границ, и правило,
 * которому он нужен, должно включить его осознанно, а не получить молча.
 */
export function createSpecifierVisitor(
    onSpecifier: (node: SpecifierNode) => void,
): Rule.RuleListener {
    return {
        'ImportDeclaration, ImportExpression'(
            node: Rule.Node & { source?: { type: string } | null },
        ) {
            if (isSpecifierNode(node.source)) {
                onSpecifier(node.source);
            }
        },
        CallExpression(node) {
            if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') {
                return;
            }
            const arg = node.arguments[0];
            if (isSpecifierNode(arg)) {
                onSpecifier(arg);
            }
        },
    };
}

/**
 * Правка, подставляющая `specifier` вместо содержимого узла. Кавычка берётся из исходного текста —
 * правило не навязывает файлу свой стиль кавычек.
 */
export function replaceSpecifier(node: SpecifierNode, specifier: string): Rule.ReportFixer {
    const quote = node.raw[0] ?? "'";
    return (fixer) => fixer.replaceTextRange(node.range, `${quote}${specifier}${quote}`);
}
