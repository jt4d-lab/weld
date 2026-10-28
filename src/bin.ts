#!/usr/bin/env node

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
