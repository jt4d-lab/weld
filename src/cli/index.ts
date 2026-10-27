/**
 * Публичный интерфейс слоя CLI. Наружу выходит только сборка программы с ее зависимостями: команды,
 * рендер и источник ESLint-конфига — внутренние части слоя, и `src/bin.ts` их не знает.
 */

export type { ProgramDeps } from './program.js';
export { createProgram } from './program.js';
