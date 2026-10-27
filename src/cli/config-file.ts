/**
 * Поиск ESLint-конфига на диске: ближайший к аргументу команды вверх по дереву и явный путь
 * `--config`. Свой обход нужен ради одного кода на обе версии ESLint: в 9.9 `findConfigFile` умеет
 * искать только от `cwd`, в 10.9 — еще и от файла, а CLI обязан отвечать одинаково. Заодно обход
 * отдает путь найденного конфига: его печатает `weld config` и он же становится `cwd` для ESLint.
 *
 * Модуль внутренний: наружу через баррель слоя не выходит.
 */

import { dirname, join, resolve } from 'node:path';

import { statOf } from './sample.js';

/**
 * Имена flat-конфига в порядке ESLint 10 (`FLAT_CONFIG_FILENAMES`). TS-варианты в списке обязательны:
 * на 10 такой конфиг грузится через `jiti` без флагов, и поиск без этих имен потерял бы работающий
 * сегодня сценарий. Внутри директории побеждает первое найденное имя.
 */
export const CONFIG_FILE_NAMES = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    'eslint.config.mts',
    'eslint.config.cts',
];

/** Конфиг в самой директории: первое имя из списка, которое там есть. */
function configInDir(dir: string): string | null {
    for (const name of CONFIG_FILE_NAMES) {
        const candidate = join(dir, name);

        if (statOf(candidate)?.isFile() === true) {
            return candidate;
        }
    }

    return null;
}

/**
 * Ближайший конфиг вверх от `startDir`, как `findUp` из ESLint: обход идет до корня ФС, и первый
 * найденный файл выигрывает у более далекого. `null` — конфига нет до корня.
 */
export function findConfigFile(startDir: string): string | null {
    let dir = resolve(startDir);

    for (;;) {
        const found = configInDir(dir);

        if (found !== null) {
            return found;
        }

        const parent = dirname(dir);

        if (parent === dir) {
            return null;
        }

        dir = parent;
    }
}

/**
 * Явный `--config`: путь резолвится от `cwd` пользователя и поиск не выполняется — ровно как
 * у `eslint --config`. Директория конфигом не является, хотя и существует, поэтому проверяется
 * и она: иначе ошибка всплыла бы позже и без объяснения.
 */
export function resolveConfigFile(path: string, cwd: string): string {
    const target = resolve(cwd, path);
    const stats = statOf(target);

    if (stats === null || stats.isDirectory()) {
        throw new Error(`config path does not exist: ${path}`);
    }

    return target;
}
