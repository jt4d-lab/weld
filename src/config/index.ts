/**
 * Эффективная конфигурация WELD для файла — один источник правды для правил и CLI. Слой не
 * импортирует `eslint`: про `Rule.RuleContext` знает только адаптер `src/rules/context.ts`.
 */

export type { WeldResolveInput, WeldResolveOptions, WeldTarget } from './resolve.js';
export { resolveForFile } from './resolve.js';
