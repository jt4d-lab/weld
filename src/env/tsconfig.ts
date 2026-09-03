/**
 * Заготовка под чтение алиасов (`compilerOptions.paths`) из `tsconfig.json` — часть
 * auto-discovery алиасов (раздел 5.1 ТЗ `strata-import-barrel`). Реализация и тесты появятся
 * вместе с этой фичей; сейчас файл не подключён ни к одному правилу, источник алиасов остаётся
 * прежним (`settings.weld.aliases`, см. `src/settings/weld.ts`).
 *
 * `get-tsconfig` — devDependency: при подключении этого файла к сборке (когда он перестанет быть
 * заготовкой) зависимость нужно перенести в `dependencies` — `tsup` собирает пакет без bundling
 * рантайм-зависимостей (`noExternal` не задан), и devDependency у потребителей пакета просто не
 * установится.
 */

import type { Alias } from '../settings/aliases.js';

export function readTsconfigAliases(fromFile: string): Alias[] | null {
    throw new Error(`not implemented: readTsconfigAliases(${fromFile})`);
}
