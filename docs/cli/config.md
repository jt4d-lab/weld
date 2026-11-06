# `weld config <path>`

Выводит настройки WELD, которые применяются к файлу или директории.

## Результат

```sh
$ weld config src/feature/internal.ts
file:   src/feature/internal.ts
config: eslint.config.js
settings.weld:
  repoRoot:       /home/user/project
  aliasesBaseUrl: .
  tsconfig:       tsconfig.json
  aliases:
    @/* → /src/*
```

- `file` — путь к файлу от корня репозитория. Для директории указывается выбранный файл с пометкой
  `(sample of <аргумент>)`.
- `config` — примененный ESLint-конфиг, от корня репозитория. Конфиг вне корня печатается абсолютным
  путем.

Если корень не удалось определить, оба пути печатаются абсолютными.

В `settings.weld` показаны вычисленные [настройки WELD](../rules/settings.md).

## Настройки для директории

Вместо пути к файлу можно указать путь к директории. Тогда команда покажет настройки для barrel
файла в этой директории.
