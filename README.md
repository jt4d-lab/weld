# WELD — Well-Encapsulated Layered Design

Подход к организации кода во frontend-приложениях и инструменты для его соблюдения.

## Что это

WELD описывает, как разложить frontend-приложение по слоям и как провести границы между модулями
так, чтобы эти границы держались со временем. Ключевая идея — строгая инкапсуляция: модуль публикует
наружу узкий, осознанно спроектированный интерфейс, а всё остальное остаётся его внутренним делом.
Слои задают направление зависимостей, инкапсуляция не даёт им расползтись.

Правила такого рода почти невозможно удержать одними договорённостями в команде — поэтому
репозиторий содержит не только документацию подхода, но и ESLint-плагин, который проверяет
соблюдение правил автоматически.

## Статус

Ранняя стадия. Документация пишется; в ESLint-плагине пока одно правило —
[`weld/no-barrel-bypass`](docs/rules/no-barrel-bypass.md). Правила и их именование могут меняться
без обратной совместимости.

## ESLint-плагин

Пакет: [`eslint-plugin-weld`](https://www.npmjs.com/package/eslint-plugin-weld). Требует ESLint 9
или новее и flat config (`eslint.config.js`); поддерживается только ESM-подключение.

```sh
yarn add -D eslint-plugin-weld
```

```js
// eslint.config.js
import weld from 'eslint-plugin-weld';

export default [weld.configs.recommended];
```

Плагин предоставляет готовые наборы правил `recommended` и `strict`. `recommended` включает
`weld/no-barrel-bypass` как `warn` с выключенным автофиксом (`fix: false`) — только suggestion,
применяемый вручную и по одному месту за раз. `strict` включает то же правило как `error` с
автофиксом по умолчанию (см. [опцию `fix`](docs/rules/no-barrel-bypass.md#опция-fix)):

```js
import weld from 'eslint-plugin-weld';

export default [weld.configs.strict];
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

- [`weld/no-barrel-bypass`](docs/rules/no-barrel-bypass.md) — ловит импорты, входящие внутрь модуля
  (директории с файлом `index.<ext>`) в обход его точки входа, и предлагает исправленный путь через
  баррель.

Алиасы (`@src/*` и подобные) правило понимает через `settings.weld`, формат близок к `paths` из
`tsconfig.json`:

```js
export default [
    {
        plugins: { weld },
        settings: {
            weld: {
                baseUrl: 'packages/app', // необязательно, по умолчанию '.'
                aliases: { '@src/*': ['src/*'] },
            },
        },
        rules: {
            'weld/no-barrel-bypass': 'error',
        },
    },
];
```

Подробности — в [документации правила](docs/rules/no-barrel-bypass.md).

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
