/**
 * Публичный интерфейс слоя: разбор и сборка специфаера (`specifier.ts`) плюс его место в AST
 * (`nodes.ts`).
 *
 * `Target` и `Form` наружу не выходят: снаружи результат `parseSpecifier` только передаётся в
 * `renderSpecifier`, и называть его типы по имени незачем.
 */

export type { SpecifierNode } from './nodes.js';
export { createSpecifierVisitor, replaceSpecifier } from './nodes.js';
export { parseSpecifier, renderSpecifier } from './specifier.js';
