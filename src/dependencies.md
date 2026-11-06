# Зависимости директорий в `src/`

Директория в `src/` — модуль со своим баррелем `index.ts`: снаружи импорт идёт только через
`@/<директория>/index.js`, внутри — прямо в соседний файл. У файлов-модулей (`debug.ts`,
`extensions.ts`, `package.ts`, `bin.ts`) барреля нет.

Схема построена по импортам продакшен-кода; тесты и `*.testing.ts` не учтены, кроме фейка `FsHost`,
который `host/index.ts` намеренно отдает наружу. Стрелка `A --> B` — «`A` импортирует `B`».

```mermaid
flowchart TD
    subgraph input
        direction TB

        rules

        cli
    end

    subgraph vfs["виртуальная файловая система"]
        host
        path
    end

    tsconfig
    imports
    config
    settings

    input --> config
    input --> settings
    input --> imports
    input --> vfs

    config --> settings
    config --> tsconfig
    config --> vfs

    host -. getRepoRoot .-> settings
    host --> path

    tsconfig --> settings
    tsconfig --> vfs

    imports --> settings
    imports --> vfs

    settings --> vfs
```

Граф ациклический. Направление почти всюду «сверху вниз», единственная зависимость вверх —
`host --> settings` (`getRepoRoot`), и `src/testing/` в продакшен-граф не входит: от него зависят
только тесты.
