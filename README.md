# WELD — Well-Encapsulated Layered Design

Подход к организации кода во frontend-приложениях и инструменты для его соблюдения.

## Ключевые идеи подхода

### 1. Баррель = граница модуля

Папка с `index.ts` — модуль с публичным интерфейсом: что в барреле — публично, остальное недоступно
снаружи.

Префикс `_` и папка `internal/` прячут содержимое даже там, где барреля нет.

### 2. Однонаправленность зависимостей

Слой не импортирует ничего из слоев выше.

### 3. Слои задает проект

Список и порядок слоёв задаёт проект.

### 4. Общие слои и фрактальность модулей

Общие слои наверху, модули в `modules/` — со слоями или без, с вложенными модулями в собственной
`modules/`. Правила одинаковы на любой глубине.

## ESLint-плагин

Пакет: [`eslint-plugin-weld`](https://www.npmjs.com/package/eslint-plugin-weld). Требует ESLint 9.15
или новее и flat config (`eslint.config.js`); поддерживается только ESM-подключение.

```sh
yarn add -D eslint-plugin-weld
```

```js
// eslint.config.js
import { defineConfig } from 'eslint/config';
import weld from 'eslint-plugin-weld';

export default defineConfig([
    {
        files: ['src/**'],
        extends: [weld.configs.recommended],
        settings: {
            weld: {
                layers: ['common', '@modules', 'pages', 'app'],
                moduleLayers: ['entities', 'features', 'widgets'],
            },
        },
    },
]);
```

Плагин предоставляет готовые наборы правил `recommended` и `strict`; оба включают
`no-illegal-layer-dependency` и потому требуют схему слоёв — без `settings.weld.layers` прогон
падает на первом же файле.

Набор подключается через `extends` внутри блока с `files`, и это не косметика: сам по себе он
действует на **все** линтуемые файлы, а схема, положенная в отдельный блок с `files: ['src/**']`, до
`eslint.config.js` и прочего вне `src/` не дотянется — прогон упадёт уже на них. `extends` держит
правила и схему в одной области. Второй рабочий вариант — подключить набор как есть, а
`settings.weld` задать блоком без `files`, то есть на весь конфиг.

```js
import { defineConfig } from 'eslint/config';
import weld from 'eslint-plugin-weld';

export default defineConfig([
    { files: ['src/**'], extends: [weld.configs.strict], settings: { weld: { layers } } },
]);
```

Можно подключить и сам плагин, включая правила поштучно:

```js
import weld from 'eslint-plugin-weld';

export default [
    {
        plugins: { weld },
        rules: {
            'weld/no-barrel-bypass': 'error',
        },
    },
];
```

### Правила

- [`weld/no-barrel-bypass`](docs/rules/no-barrel-bypass.md) — запрещает импорты, которые входят
  внутрь модуля мимо его точки входа (`index.*`), минуя баррель. Входит в `recommended` и `strict`;
- [`weld/no-illegal-layer-dependency`](docs/rules/no-illegal-layer-dependency.md) — запрещает
  импорты, идущие против порядка слоёв, который проект объявил в `settings.weld.layers`. Входит в
  `recommended` и `strict`, поэтому оба набора требуют схему слоёв: по умолчанию её у плагина нет и
  быть не может, а без неё прогон падает.

Правила учитывают алиасы путей и корень репозитория. Если алиасы не заданы в конфиге, они
автоматически подхватываются из `compilerOptions.paths` ближайшего `tsconfig.json` (с резолвом
`extends`); задать их явно можно через `settings.weld`:

```js
export default [
    {
        settings: {
            weld: {
                aliases: { '@/*': ['src/*'] },
                aliasesBaseUrl: 'packages/app', // необязательно; по умолчанию '.'
                repoRoot: '.', // необязательно; по умолчанию — авто-поиск
            },
        },
    },
];
```

Там же, в `settings.weld`, живёт схема слоёв, которую читает `no-illegal-layer-dependency`. Без
схемы правило роняет прогон, поэтому включается оно всегда вместе с ней — и лучше сразу с `files` на
том же блоке: конфиги сборки и скрипты в слои не укладываются, а схема, не дотянувшаяся до файла под
правилом, останавливает прогон на нём.

```js
import weld from 'eslint-plugin-weld';

export default [
    {
        files: ['src/**'],
        plugins: { weld },
        settings: {
            weld: {
                layers: ['common', '@modules', 'pages', 'app'],
                moduleLayers: ['entities', 'features', 'widgets'],
                moduleDir: 'modules', // по умолчанию
            },
        },
        rules: { 'weld/no-illegal-layer-dependency': 'error' },
    },
];
```

Формат и разбор всех настроек описаны в [документации настроек](docs/rules/settings.md); подробности
правил — на их страницах: [`no-barrel-bypass`](docs/rules/no-barrel-bypass.md),
[`no-illegal-layer-dependency`](docs/rules/no-illegal-layer-dependency.md).

### Отладка

Плагин использует пакет [`debug`](https://www.npmjs.com/package/debug) под namespace
`eslint-plugin-weld:*`:

```sh
DEBUG=eslint-plugin-weld:* npx eslint .
```

## Разработка

Нужен Node 20.19+ и Yarn 4 (через corepack: `corepack enable`).

```sh
yarn install          # установка зависимостей
yarn verify           # линт, форматирование, типы, тесты, сборка
yarn test:watch       # тесты в watch-режиме
yarn build            # сборка в dist/
yarn smoke [9|10]     # сборка тарбола и проверка подключения в чистом проекте
```

`yarn smoke` собирает пакет ровно так, как это сделает `npm publish`, ставит его во временный проект
и запускает там ESLint — это защита от «локально работает, из npm не подключается».

## Лицензия

[MIT](LICENSE)
