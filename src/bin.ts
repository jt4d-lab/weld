#!/usr/bin/env node
/**
 * Исполняемый вход пакета: `weld`. Отдельный entry `tsup`, потому что у него своя судьба — shebang,
 * бит исполнения и вызов `parseAsync` вместо экспорта плагина. Всё остальное он получает из
 * `src/cli/`: сборка программы, команды и печать вывода — дело слоя CLI, а вход только запускает ее.
 *
 * Ошибки действий commander не выпускает наружу: их печатает `src/cli/program.ts` и ставит код 1.
 * Поэтому `catch` здесь — про сбой, который случился раньше действия (в том числе при сборке
 * программы), и он тоже обязан выглядеть сообщением, а не стектрейсом.
 */

import { createProgram } from '@/cli/index.js';

createProgram()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
        process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
