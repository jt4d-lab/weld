/**
 * Слой связывает строки импортов с виртуальными путями модулей и предоставляет общий обход
 * спецификаторов в AST, не обращаясь к файловой системе.
 *
 * Задачи:
 * - разбирать относительные и алиасные спецификаторы в виртуальные пути;
 * - различать модульные расширения, ассеты и спецификаторы, требующие внешнего резолва;
 * - строить спецификаторы обратно из виртуальных путей и алиасов;
 * - находить подходящий алиас для обратного рендера, сохраняя форму его ключа;
 * - находить спецификаторы в AST и безопасно заменять их исправлениями ESLint.
 */

export type { SpecifierNode } from './nodes.js';
export { createSpecifierVisitor, replaceSpecifier } from './nodes.js';
export type { AliasPath, SpecifierSkip } from './specifier.js';
export { parseSpecifier, renderAliasPath, renderSpecifier } from './specifier.js';
