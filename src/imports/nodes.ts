/**
 * Обход импортов в AST: где в дереве лежит строка-специфаер и как её заменить. Про баррели,
 * границы модулей и любое конкретное правило слой не знает — это общая инфраструктура импортов,
 * как и `specifier.ts`.
 *
 * Здесь же зафиксированы решения, которые иначе каждое правило принимало бы заново: репортим на
 * самом литерале пути, а не на всём операторе; кавычку для правки берём из исходника; `require`
 * считается импортом — в том числе в TypeScript-форме `import x = require('...')`. Реэкспорт
 * (`export ... from`) по умолчанию не обходится, но включается параметром: у него своя семантика
 * границ, и ответ «считать ли его импортом» принадлежит правилу, а не слою (см.
 * {@link SpecifierVisitorOptions}).
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

/** Узел, у которого специфаер лежит в `source`: и у импорта, и у реэкспорта. */
type WithSource = Rule.Node & { source?: { type: string } | null };

/**
 * `TSImportEqualsDeclaration` — TypeScript-форма `import x = require('...')`. Специфаер лежит
 * глубже и по-другому: не в `source` и не в аргументе `CallExpression`, а в `expression` узла
 * `TSExternalModuleReference` (`import x = ns.Foo` — та же декларация, но с `TSQualifiedName`, и
 * специфаера в ней нет). Тип описан здесь структурно: узлы TypeScript в `estree` не объявлены, а
 * тянуть ради одного поля типы парсера слой не станет.
 */
type WithModuleReference = Rule.Node & {
    moduleReference?: { type: string; expression?: { type: string } | null } | null;
};

/**
 * Опции {@link createSpecifierVisitor}. В баррель слоя тип не выходит: снаружи опции пишутся
 * литералом, и называть их тип по имени незачем — как `Target` и `Form` у разбора специфаера.
 */
export type SpecifierVisitorOptions = {
    /**
     * Обходить ли реэкспорты — `export ... from '...'` и `export * from '...'`. По умолчанию нет:
     * реэкспорт это одновременно и зависимость, и часть публичного интерфейса, и какая из двух
     * сторон важна, знает только само правило. `no-barrel-bypass` их не обходит (баррель из них и
     * собран — правило репортило бы сам баррель), `no-illegal-layer-dependency` обходит (для
     * направления зависимостей реэкспорт — обычное ребро графа, и без него запрет обходился бы
     * переписыванием `import` + `export` в одну строку).
     *
     * `export { x }` без `from` специфаера не содержит и не обходится при любом значении.
     */
    reExports?: boolean;
};

/**
 * Слушатели для `create()`, вызывающие `onSpecifier` на каждом строковом специфаере импорта:
 * `import ... from`, динамический `import()`, `require()` и `import x = require('...')`, а при
 * `reExports` — ещё и реэкспорт.
 *
 * `import x = require('...')` обходится при любом значении `reExports`, включая форму с
 * модификатором (`export import x = require('...')`): это импорт, записанный одним оператором, а не
 * `export ... from`, чей пропуск нужен баррелям. У формы с `export` внешний
 * `ExportNamedDeclaration` специфаера не содержит (`source` там `null`), поэтому и при включённых
 * реэкспортах специфаер приходит ровно один раз.
 */
export function createSpecifierVisitor(
    onSpecifier: (node: SpecifierNode) => void,
    { reExports = false }: SpecifierVisitorOptions = {},
): Rule.RuleListener {
    function visitSource(node: WithSource): void {
        if (isSpecifierNode(node.source)) {
            onSpecifier(node.source);
        }
    }

    function visitModuleReference(node: WithModuleReference): void {
        const reference = node.moduleReference;
        if (
            reference?.type === 'TSExternalModuleReference' &&
            isSpecifierNode(reference.expression)
        ) {
            onSpecifier(reference.expression);
        }
    }

    const reExportListener = reExports
        ? { 'ExportNamedDeclaration, ExportAllDeclaration': visitSource }
        : {};

    return {
        'ImportDeclaration, ImportExpression': visitSource,
        TSImportEqualsDeclaration: visitModuleReference,
        CallExpression(node) {
            if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') {
                return;
            }
            const arg = node.arguments[0];
            if (isSpecifierNode(arg)) {
                onSpecifier(arg);
            }
        },
        ...reExportListener,
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
