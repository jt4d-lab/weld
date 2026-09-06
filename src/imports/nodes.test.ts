/**
 * Обход специфаеров проверяется через настоящий `RuleTester`: тестовое правило репортит каждый
 * найденный специфаер и заменяет его на `'FOUND'`, поэтому в `errors`/`output` видно ровно то, что
 * обошёл визитор и как сработала правка.
 */

import type { Rule } from 'eslint';
import { describe, it } from 'vitest';

import { createSpecifierVisitor, replaceSpecifier } from '@/imports/nodes.js';
import { createRuleTester } from '@/testing/index.js';

const ruleTester = createRuleTester();

const probe: Rule.RuleModule = {
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
        });
    },
};

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
            ],
        });
    });

    it('не обходит то, что специфаером не является', () => {
        ruleTester.run('specifier visitor: negatives', probe, {
            valid: [
                {
                    name: 'export ... from — своя семантика границ',
                    code: "export { a } from './x';",
                },
                { name: 'export * from', code: "export * from './x';" },
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
