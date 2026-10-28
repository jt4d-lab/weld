#!/usr/bin/env node
/**
 * Исполняемый вход пакета: `weld`. Отдельный entry `tsup`, потому что у него своя судьба — shebang,
 * бит исполнения и запуск разбора аргументов вместо экспорта плагина. Всё остальное он получает из
 * `src/cli/`: сборка программы, команды, печать вывода и печать ошибок — дело слоя CLI, а вход
 * только запускает ее.
 *
 * Своей обработки ошибок здесь нет: `runCli` ловит и ошибки действий, и ошибки использования
 * (`commander` иначе завершил бы процесс сам), печатает их и ставит код возврата.
 */

import { runCli } from '@/cli/index.js';

/**
 * Пайп может закрыться раньше вывода (`weld inspect … | head -1`): `EPIPE` — не ошибка команды, а
 * остальные ошибки потока остаются видимыми.
 */
for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') {
            throw error;
        }
    });
}

void runCli(process.argv);
