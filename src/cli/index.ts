/**
 * Публичный интерфейс слоя CLI. Наружу выходят сборка программы, ее зависимости и запуск разбора
 * аргументов: команды, рендер и источник ESLint-конфига — внутренние части слоя, и `src/bin.ts` их
 * не знает.
 */

export type { ProgramDeps } from './program.js';
export { createProgram, runCli } from './program.js';
