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

## Статус

Ранняя стадия. Документация подхода пишется; в ESLint-плагине реализовано первое правило —
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

Плагин предоставляет готовые наборы правил `recommended` и `strict`:

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

- [`weld/no-barrel-bypass`](docs/rules/no-barrel-bypass.md) — запрещает импорты, которые входят
  внутрь модуля мимо его точки входа (`index.*`), минуя баррель.

Правило учитывает алиасы путей и корень репозитория. Если алиасы не заданы в конфиге, они
автоматически подхватываются из `compilerOptions.paths` ближайшего `tsconfig.json` (с резолвом
`extends`); задать их явно можно через `settings.weld`:

```js
export default [
    {
        settings: {
            weld: {
                repoRoot: '.', // необязательно; по умолчанию — авто-поиск
                aliasesBaseUrl: 'packages/app', // необязательно; по умолчанию '.'
                aliases: { '@/*': ['src/*'] },
            },
        },
    },
];
```

Формат и разбор этих настроек описаны в [документации настроек](docs/settings.md); подробности
самого правила — в [документации правила](docs/rules/no-barrel-bypass.md).

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
