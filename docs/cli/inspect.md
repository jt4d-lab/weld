# `weld inspect <file>`

Выводит информацию о файле: путь, путь импорта и положение в схеме слоев.

Для команды необходимы настройки `layers` и `moduleLayers`.

## Результат

```sh
$ weld inspect src/modules/billing/features/panel.ts
file:      src/modules/billing/features/panel.ts
alias:     @/modules/billing/features/panel.ts
module:    billing
layer:     features
innerPath: panel.ts
```

- `file` — путь к файлу от корня репозитория.
- `alias` — алиас файла.
- `module` — имя модуля.
- `layer` — имя слоя или `@unknown`, если файл не относится ни к одному слою.
- `innerPath` — путь от корня слоя. При `@unknown` он считается от корня модуля, а если модуля нет —
  от `srcDir`.

Расположение модулей и слоев описано в [схеме слоев](../mechanics/layers.md), а настройки — в
[документации настроек](../rules/settings.md).
