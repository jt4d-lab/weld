/**
 * Реальные пути для тестов, которым нужен настоящий диск: корень этого репозитория и минимальный
 * проект-фикстура `fixtures/project` (`src/feature/{index,internal}.ts`).
 *
 * Наружу отдаются готовые константы, а не хелпер вида `dirFromUrl(url)`: тот считает путь от
 * `import.meta.url` своего модуля, поэтому один и тот же вызов из разных файлов означал бы разное.
 * Фикстура годится любому правилу про импорты, поэтому лежит здесь, а не внутри одного правила.
 */

import { fileURLToPath } from 'node:url';

/** `fileURLToPath` возвращает директорию с завершающим `/` — root его не терпит. */
function dirFromUrl(url: string): string {
    return fileURLToPath(new URL(url, import.meta.url)).replace(/\/$/, '');
}

/** Корень этого репозитория — `src/testing/` лежит на два уровня ниже. */
export const repoRoot = dirFromUrl('../../');

export const fixtureRoot = dirFromUrl('./fixtures/project');

/** Файл-потребитель внутри фикстуры. На диске его нет — это только `filename` для линтера. */
export const consumerFile = `${fixtureRoot}/src/consumer.ts`;
