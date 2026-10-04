/**
 * Обход специфаеров проверяется через настоящий `RuleTester`: тестовое правило репортит каждый
 * найденный специфаер и заменяет его на `'FOUND'`, поэтому в `errors`/`output` видно ровно то, что
 * обошёл визитор и как сработала правка.
 */

import type { Rule } from 'eslint';
import { describe, it } from 'vitest';

import type { SpecifierVisitorOptions } from '@/imports/nodes.js';
import { createSpecifierVisitor, replaceSpecifier } from '@/imports/nodes.js';
import { createRuleTester } from '@/testing/index.js';

const ruleTester = createRuleTester();

function createProbe(options?: SpecifierVisitorOptions): Rule.RuleModule {
    return {
        meta: {
            type: 'problem',
            fixable: 'code',
            schema: [],
            messages: { found: "found '{{specifier}}'" },
        },
        create(context) {
            return createSpecifierVisitor((node) => {
                context.report({
                    node,
                    messageId: 'found',
                    data: { specifier: node.value },
                    fix: replaceSpecifier(node, 'FOUND'),
                });
            }, options);
        },
    };
}

const probe = createProbe();

/** Тот же пробник с включёнными реэкспортами — так их обходит `no-illegal-layer-dependency`. */
const reExportProbe = createProbe({ reExports: true });

function found(specifier: string) {
    return { messageId: 'found', data: { specifier } };
}

describe('createSpecifierVisitor — что считается импортом', () => {
    it('обходит import, import() и require', () => {
        ruleTester.run('specifier visitor', probe, {
            valid: [],
            invalid: [
                {
                    name: 'статический import',
                    code: "import { a } from './x';",
                    output: "import { a } from 'FOUND';",
                    errors: [found('./x')],
                },
                {
                    name: 'динамический import()',
                    code: "const a = import('./x');",
                    output: "const a = import('FOUND');",
                    errors: [found('./x')],
                },
                {
                    name: 'require()',
                    code: "const a = require('./x');",
                    output: "const a = require('FOUND');",
                    errors: [found('./x')],
                },
                {
                    name: 'side-effect import без привязок',
                    code: "import './x';",
                    output: "import 'FOUND';",
                    errors: [found('./x')],
                },
                {
                    // Специфаер лежит в `TSExternalModuleReference`, а не в `source` и не в
                    // аргументе `CallExpression`: без своего слушателя эту форму не видел бы ни
                    // один — импорт молча проходил бы мимо любого правила про импорты.
                    name: 'import x = require() — TypeScript-форма',
                    code: "import x = require('./x');",
                    output: "import x = require('FOUND');",
                    errors: [found('./x')],
                },
                {
                    // Модификатор `export` делает ту же декларацию ещё и экспортом, но специфаер в
                    // ней один, и приходит он один раз: внешний `ExportNamedDeclaration` своего
                    // `source` не имеет.
                    name: 'export import x = require() — один специфаер, один отчёт',
                    code: "export import x = require('./x');",
                    output: "export import x = require('FOUND');",
                    errors: [found('./x')],
                },
            ],
        });
    });

    it('не обходит то, что специфаером не является', () => {
        ruleTester.run('specifier visitor: negatives', probe, {
            valid: [
                {
                    name: 'import x = ns.Foo — специфаера в декларации нет',
                    code: 'import x = ns.Foo;',
                },
                {
                    name: 'export ... from — по умолчанию выключен',
                    code: "export { a } from './x';",
                },
                { name: 'export * from — по умолчанию выключен', code: "export * from './x';" },
                { name: 'вызов не require', code: "const a = load('./x');" },
                { name: 'require без аргументов', code: 'const a = require();' },
                { name: 'require с нестроковым аргументом', code: 'const a = require(42);' },
                { name: 'import() с нестроковым аргументом', code: 'const a = import(name);' },
                { name: 'строка вне импорта', code: "const a = './x';" },
            ],
            invalid: [],
        });
    });
});

describe('createSpecifierVisitor — реэкспорты по запросу', () => {
    it('при reExports обходятся обе формы `export ... from`', () => {
        ruleTester.run('specifier visitor: re-exports', reExportProbe, {
            valid: [],
            invalid: [
                {
                    name: 'export { a } from',
                    code: "export { a } from './x';",
                    output: "export { a } from 'FOUND';",
                    errors: [found('./x')],
                },
                {
                    name: 'export * from',
                    code: "export * from './x';",
                    output: "export * from 'FOUND';",
                    errors: [found('./x')],
                },
                {
                    name: 'export * as ns from',
                    code: "export * as ns from './x';",
                    output: "export * as ns from 'FOUND';",
                    errors: [found('./x')],
                },
                {
                    name: 'export type ... from',
                    code: "export type { A } from './x';",
                    output: "export type { A } from 'FOUND';",
                    errors: [found('./x')],
                },
            ],
        });
    });

    it('экспорт без `from` специфаера не содержит и при reExports', () => {
        ruleTester.run('specifier visitor: exports without source', reExportProbe, {
            valid: [
                { name: 'export { a }', code: 'const a = 1;\nexport { a };' },
                { name: 'export const', code: 'export const a = 1;' },
                { name: 'export default', code: 'export default 1;' },
            ],
            invalid: [],
        });
    });

    it('импорты обходятся при reExports так же, как без него', () => {
        ruleTester.run('specifier visitor: imports with re-exports on', reExportProbe, {
            valid: [{ name: 'голого специфаера нет — обходить нечего', code: 'const a = 1;' }],
            invalid: [
                {
                    name: 'статический import',
                    code: "import { a } from './x';",
                    output: "import { a } from 'FOUND';",
                    errors: [found('./x')],
                },
                {
                    name: 'import x = require()',
                    code: "import x = require('./x');",
                    output: "import x = require('FOUND');",
                    errors: [found('./x')],
                },
                {
                    // Тот же оператор ловит и слушатель реэкспортов — но специфаера у внешнего
                    // `ExportNamedDeclaration` нет, поэтому отчёт остаётся один.
                    name: 'export import x = require() — по-прежнему один отчёт',
                    code: "export import x = require('./x');",
                    output: "export import x = require('FOUND');",
                    errors: [found('./x')],
                },
            ],
        });
    });
});

describe('replaceSpecifier — кавычки берутся из исходника', () => {
    it('одинарные и двойные сохраняются', () => {
        ruleTester.run('specifier fixer', probe, {
            valid: [],
            invalid: [
                {
                    name: 'одинарные кавычки',
                    code: "import { a } from './x';",
                    output: "import { a } from 'FOUND';",
                    errors: [found('./x')],
                },
                {
                    name: 'двойные кавычки',
                    code: 'import { a } from "./x";',
                    output: 'import { a } from "FOUND";',
                    errors: [found('./x')],
                },
            ],
        });
    });
});
