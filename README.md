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

Ранняя стадия. Документация подхода в целом пишется; ESLint-плагин опубликован и содержит первое
правило — `weld/no-barrel-bypass`. Правила и их именование могут меняться без обратной
совместимости.

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

### `weld/no-barrel-bypass`

Ловит импорты, входящие внутрь модуля (директории с `index.*`) мимо его точки входа, и предлагает
исправленный путь через баррель. Подробное описание, алгоритм и примеры — в
[`docs/rules/no-barrel-bypass.md`](docs/rules/no-barrel-bypass.md).

Понимает алиасы импортов через `settings.weld`:

```js
// eslint.config.js
export default [
    weld.configs.recommended,
    {
        settings: {
            weld: {
                baseUrl: 'src',
                aliases: { '@src/*': ['src/*'] },
            },
        },
    },
];
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
