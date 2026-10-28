/**
 * Поиск ESLint-конфига на диске: ближайший к аргументу команды вверх по дереву и явный путь
 * `--config`. Свой обход нужен ради одного кода на обе версии ESLint: в 9.x `findConfigFile` умеет
 * искать только от `cwd`, в 10.x — еще и от файла, а CLI обязан отвечать одинаково. Заодно обход
 * отдает путь найденного конфига: его печатает `weld config` и он же становится `cwd` для ESLint.
 *
 * Модуль внутренний: наружу через баррель слоя не выходит.
 */

import { dirname, join, resolve } from 'node:path';

import { statOf } from './sample.js';

/** Общая часть имен flat-конфига: по ней отличается от прочих файлов любой `eslint.config.*`. */
const CONFIG_FILE_PREFIX = 'eslint.config.';

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

/**
 * Имя файла flat-конфига — `eslint.config.<расширение>`. Это не тот же вопрос, что у
 * {@link CONFIG_FILE_NAMES}: конфигом, который найдет сам ESLint, считается только имя из списка, а
 * `eslint.config.other.mjs` им не считается, хотя лежит рядом и линтуется тем же конфигом. Сэмплом
 * директории не должен становиться ни один из них, поэтому `eslint-config.ts` спрашивает префикс, а
 * не список.
 */
export function isConfigFileName(name: string): boolean {
    return name.startsWith(CONFIG_FILE_PREFIX);
}

/**
 * Конфиг в самой директории: первое имя из списка, которое там есть. Конфигом считается только
 * регулярный файл — директория с таким именем пропускается, как и у `findUp` в ESLint.
 */
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
 *
 * Отличие от `findUp` одно и намеренное: кандидат, на котором ФС ответила не «нет пути» (например,
 * нет прав на директорию), — ошибка, а не «конфига нет». Иначе поиск молча закончился бы ответом
 * `no eslint config found`, скрыв причину.
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
 * у `eslint --config`. Конфигом может быть только регулярный файл, поэтому существующая директория
 * (а также FIFO или сокет) — отдельная ошибка: она объясняет, что не так с путем, вместо того чтобы
 * упасть позже на загрузке.
 */
export function resolveConfigFile(path: string, cwd: string): string {
    const target = resolve(cwd, path);
    const stats = statOf(target);

    if (stats === null) {
        throw new Error(`config path does not exist: ${path}`);
    }

    if (!stats.isFile()) {
        throw new Error(`config path is not a file: ${path}`);
    }

    return target;
}
