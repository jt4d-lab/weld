/**
 * Версия пакета — одна на оба входа: ее читает и плагин (`plugin.meta.version`), и `weld --version`.
 * Два читателя одного и того же файла разъехались бы на первой правке.
 *
 * Источник — `package.json`, потому что версию проставляет release-workflow перед упаковкой, а не
 * исходники. Путь относительный (`../package.json`) и одинаково верный в обоих местах, где оказывается
 * этот код: `src/package.ts` лежит на уровень ниже корня пакета, а tsup встраивает модуль в чанк
 * рядом с `dist/index.js` и `dist/bin.js` — то есть снова на уровень ниже. Ссылка на собственный
 * пакет (`eslint-plugin-weld/package.json`) дала бы второй механизм и зависела бы от поля `exports`.
 */

import { createRequire } from 'node:module';

/** Версия из `package.json` того пакета, в чьей сборке оказался модуль. */
export function packageVersion(): string {
    const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

    return version;
}
