# CLI

Пакет ставит рядом с плагином исполняемый файл `weld`. Он показывает эффективную конфигурацию WELD
для файла или директории — ровно ту, которую видит правило при линте: `settings.weld` плюс корень
репозитория, поднятый до якорей найденных алиасов.

Отдельного конфига у CLI нет. Он читает эффективный ESLint-конфиг проекта, поэтому отвечает про путь
то же, что и линтер: алиасы приходят из того же источника, с тем же приоритетом (`options` правила →
`settings.weld` → автопоиск в tsconfig).

## Требования

- Node 20.19+;
- ESLint 9 или 10, установленный в самом проекте: CLI загружает пакет `eslint` из `node_modules`
  проекта, чтобы прочитать его конфиг.

Команды запускаются из корня проекта: относительные аргументы отсчитываются от текущей директории,
ESLint-конфиг ищется оттуда же.

```sh
npx weld config src/feature
yarn weld config src/feature
```

## `weld inspect <file>`

Печатает абсолютный путь файла и путь, которым файл записывается в импорте по алиасу:

```
$ weld inspect src/feature/internal.ts
file:  /srv/jt4d-lab/weld/src/feature/internal.ts
alias: @/feature/internal.ts
```

- Файл точки входа схлопывается в директорию: `src/feature/index.ts` печатается как `@/feature`.
- Если файл не покрывает ни один алиас, в `alias` печатается виртуальный путь от корня репозитория
  (`/src/feature/internal.ts`), а не относительный путь.
- Директория аргументом не принимается: команда спрашивает про конкретный файл.

## `weld config <path>`

Печатает файл (или сэмпл директории) и разобранные настройки `settings.weld`:

```
$ weld config src/feature/internal.ts
file:  /srv/jt4d-lab/weld/src/feature/internal.ts
settings.weld:
  repoRoot:       /srv/jt4d-lab/weld
  aliasesBaseUrl: .
  tsconfig:       tsconfig.json
  aliases:
    @/* → /src/*
```

Директория заменяется сэмплом — первым файлом, который линтер действительно обрабатывает:

```
$ weld config src/feature
file:  /srv/jt4d-lab/weld/src/feature/index.ts (sample of src/feature)
settings.weld:
  repoRoot:       /srv/jt4d-lab/weld
  aliasesBaseUrl: .
  tsconfig:       tsconfig.json
  aliases:
    @/* → /src/*
```

- Обход директории идет в алфавитном порядке; `node_modules` и скрытые директории пропускаются.
- Сэмплом становится первый файл с модульным расширением, для которого ESLint вернул конфиг:
  игнорируемые конфигом файлы пропускаются.
- `repoRoot` — действующий корень репозитория, а не значение из конфига: при автопоиске он
  поднимается до якорей алиасов из tsconfig.
- `aliasesBaseUrl` и `tsconfig` печатаются как заданы в конфиге (или их значения по умолчанию).
- Пометок происхождения значения нет: отличить `repoRoot` из конфига от найденного автоматически по
  выводу нельзя.
- Алиасов нет — печатается `  aliases: (none)`.
- Запись алиаса печатается в форме `tsconfig`: `<prefix>/* → <anchor>/*`.

## Цвета

По умолчанию подписи приглушенные, а значение алиаса — акцентное. Цвет выключается флагом
`--no-color`, а также штатно через переменные `NO_COLOR` и `FORCE_COLOR`; в выводе не в терминал
цвета выключены сами.

```sh
weld config --no-color src/feature
```

## `--json`

Глобальный флаг программы: печатается только JSON, без подписей и цветов.

```
$ weld inspect --json src/feature/internal.ts
{
  "file": "/srv/jt4d-lab/weld/src/feature/internal.ts",
  "alias": "@/feature/internal.ts"
}
```

```
$ weld config --json src/feature
{
  "file": "/srv/jt4d-lab/weld/src/feature/index.ts",
  "sampleOf": "src/feature",
  "settings": {
    "repoRoot": "/srv/jt4d-lab/weld",
    "aliasesBaseUrl": ".",
    "tsconfig": "tsconfig.json",
    "aliases": [{ "prefix": "@", "anchor": "/src" }]
  }
}
```

- `alias` равен `null`, если файл не покрыт ни одним алиасом; в текстовом режиме на этом месте
  печатается виртуальный путь.
- `sampleOf` есть только у директории и повторяет аргумент в том виде, как его ввели.

## Коды возврата и ошибки

Успех — код `0`. Любая ошибка — код `1`.

В текстовом режиме сообщение уходит в stderr как `error: <текст>`:

```
$ weld config src/missing
error: path does not exist: src/missing
```

С `--json` ошибка печатается в stdout в той же машиночитаемой форме, чтобы потребителю не пришлось
разбирать текст:

```
$ weld config --json src/missing
{
  "error": "path does not exist: src/missing"
}
```

Возможные сообщения:

| сообщение                                  | когда                                                    |
| ------------------------------------------ | -------------------------------------------------------- |
| `eslint is not installed in this project`  | в проекте нет пакета `eslint`                            |
| `path does not exist: <path>`              | аргумент не существует                                   |
| `no eslint config found for <path>`        | ESLint-конфиг проекта не найден                          |
| `eslint ignores <path>`                    | файл игнорируется конфигом                               |
| `no lintable files in <path>`              | в директории нет файла, который линтер обрабатывает      |
| `expected a file, got a directory: <path>` | `inspect` получил директорию                             |
| `<file> is outside the repository root`    | путь вне корня репозитория, виртуального пути у него нет |

`--version` печатает версию пакета из его `package.json`, `--help` — список команд и флагов.
