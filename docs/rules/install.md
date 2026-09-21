# Установка

## Требования

- Node 20.19+
- ESLint flat config (eslint v9 или v10)
- ESM-only

В `eslint.config.js` без `"type": "module"` в `package.json` `import` не заработает — используйте
`eslint.config.mjs`.

## Установка

```sh
npm i -D eslint-plugin-weld
```

```sh
yarn add -D eslint-plugin-weld
```

```sh
pnpm add -D eslint-plugin-weld
```

### `defineConfig`

```js
// eslint.config.js
import { defineConfig } from 'eslint/config';
import weld from 'eslint-plugin-weld';

export default defineConfig([
    {
        files: ['src/**/*.{ts,tsx}'],
        extends: [weld.configs.recommended],
        settings: { weld: {/* ... */} },
        rules: {/* ... */},
    },
]);
```

### Без `defineConfig`

```js
import weld from 'eslint-plugin-weld';

export default [
    {
        ...weld.configs.recommended,
        files: ['src/**/*.{ts,tsx}'],
        settings: { weld: {/* ... */} },
        rules: {
            ...weld.configs.recommended.rules,
            /* ... */
        },
    },
];
```

### Рекомендации

- **Задать `files` явно** — плагину незачем проверять конфиги сборки, скрипты и генерацию.
  Расширения в паттерне обязательны: под `files: ['src/**']` файл `src/app.ts` не попадёт вовсе.
- **Задать `settings.weld` в том же блоке** — многим правилам настройки обязательны. Корень
  репозитория и алиасы плагин находит сам, а набор и порядок слоёв задаёт проект.

## Готовый пресет

### `recommended`

Правила, нарушение которых почти всегда ошибка, а не спорный стиль: код обошёл границу, которую
проект объявил сам. Это набор по умолчанию — с него начинают и на новом проекте, и на существующем.
Пресет включает свои правила как `'error'` без опций и приносит вместе с ними требования к
`settings.weld` (см. [«Установка»](#установка)).

Если пресет не подходит — набор правил нужен свой, — подключается сам плагин, а правила включаются
поштучно:

```js
export default defineConfig([
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: { weld },
        rules: {
            'weld/no-barrel-bypass': 'error',
        },
    },
]);
```

Это же способ взять только те правила, чьи обязательные настройки проект готов задать: пресет
включает правила за вас и приносит их требования все сразу.

## Отладка

Плагин пишет в [`debug`](https://www.npmjs.com/package/debug) под namespace `eslint-plugin-weld:*` —
там видно найденный корень репозитория, разобранные алиасы и причину, по которой tsconfig не
подошёл:

```sh
DEBUG=eslint-plugin-weld:* npx eslint .
```

Проблемы самого tsconfig линт не валят: алиасов из него просто нет, а причина уходит в этот вывод.
Кривое значение в явных `settings.weld` — наоборот, громкая ошибка на каждом файле (см.
[настройки](./settings.md#ошибки-tsconfig-не-валят-линт)).
