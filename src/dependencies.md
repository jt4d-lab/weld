# Зависимости директорий в `src/`

Директория в `src/` — модуль со своим баррелем `index.ts`: снаружи импорт идёт только через
`@/<директория>/index.js`, внутри — прямо в соседний файл. У файлов-модулей (`debug.ts`,
`extensions.ts`, `package.ts`, `bin.ts`) барреля нет.

Схема построена по импортам продакшен-кода; тесты и `*.testing.ts` не учтены, кроме фейка `FsHost`,
который `host/index.ts` намеренно отдает наружу. Стрелка `A --> B` — «`A` импортирует `B`».

```mermaid
graph TD
    subgraph cli["cli"]
        direction TB

        bin["bin.ts"] --> cliDir["cli/"]
    end

    subgraph rules
        direction TB

        index["index.ts"] --> rulesDir["rules/"]
    end

    subgraph l2["пограничные и чистые модули"]
        tsconfig["tsconfig/"]
        imports["imports/"]
    end


    subgraph vfs["виртуальная файловая система"]
        host
        path
    end

    config

    settings

    cli --> config
    cli --> settings
    cli --> imports
    cli --> vfs

    rules --> config
    rules --> imports
    rules --> settings
    rules --> vfs

    config --> vfs
    config --> settings
    config --> tsconfig

    host --> settings
    host --> path

    tsconfig --> settings
    tsconfig --> path

    imports --> settings
    imports --> path

    settings --> path
```

Граф ациклический. Направление почти всюду «сверху вниз», единственная зависимость вверх —
`host --> settings` (`getRepoRoot`), и `src/testing/` в продакшен-граф не входит: от него зависят
только тесты.
