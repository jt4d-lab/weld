# `weld config <path>`

Выводит настройки WELD, которые применяются к файлу или директории.

## Результат

```sh
$ weld config src/feature/internal.ts
file:   src/feature/internal.ts
config: eslint.config.js
settings.weld:
  layers:         app, @modules, @unknown
  moduleLayers:   features
  flatModules:    false
  modulesDir:     modules
  srcDir:         /src
  aliases:
    @/* → /src/*
  aliasesBaseUrl: .
  repoRoot:       /home/user/project
  tsconfig:       tsconfig.json
```

- `file` — путь к файлу от корня репозитория. Для директории указывается выбранный файл с пометкой
  `(sample of <аргумент>)`.
- `config` — примененный ESLint-конфиг, от корня репозитория. Конфиг вне корня печатается абсолютным
  путем.

Если корень не удалось определить, оба пути печатаются абсолютными.

В `settings.weld` показаны вычисленные [настройки WELD](../rules/settings.md).

## Директория вместо файла

Команда выбирает подходящий файл в директории и предпочитает файл с настройками WELD. Если таких
файлов нет, используется другой файл, к которому применяется выбранный ESLint-конфиг.
