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

/** Тот же потребитель для конфигов без парсера TS — раскладка фикстуры описана только здесь. */
export const consumerJsFile = `${fixtureRoot}/src/consumer.js`;

/**
 * Мини-проекты для автопоиска tsconfig (`fixtures/tsconfig/*`). Каждая константа — корень одного
 * сценария; внутри каждого лежит `tsconfig.json` (или его отсутствие — сам сценарий) и файл-якорь
 * `src/consumer.ts`, от которого тесты стартуют поиск.
 */
export const tsconfigFixturesRoot = dirFromUrl('./fixtures/tsconfig');

/** Обычный проект: `baseUrl` + `paths` в одном tsconfig. */
export const tsconfigBasicFixture = `${tsconfigFixturesRoot}/basic`;

/** Монорепа: пакет с `extends` на `tsconfig.base.json` родителя, якоря — у корня фикстуры. */
export const tsconfigMonorepoFixture = `${tsconfigFixturesRoot}/monorepo`;

/** `extends` в пакет из локальной поддельной `node_modules`. */
export const tsconfigExtendsPackageFixture = `${tsconfigFixturesRoot}/extends-package`;

/** JSONC: комментарии и висячие запятые. */
export const tsconfigJsoncFixture = `${tsconfigFixturesRoot}/jsonc`;

/** Синтаксически битый JSON. */
export const tsconfigBrokenFixture = `${tsconfigFixturesRoot}/broken`;

/** Валидный tsconfig без `compilerOptions.paths`. */
export const tsconfigNoPathsFixture = `${tsconfigFixturesRoot}/no-paths`;
