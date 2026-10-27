# CLI на commander: команды `inspect` и `config`

## Overview

У плагина появляется исполняемый вход `weld` на базе `commander` с двумя командами:

- `weld inspect <file>` — задел на будущий «информация о файле». Сейчас печатает абсолютный путь
  файла и путь импорта по алиасу (`@/feature/internal`).
- `weld config <path>` — основная команда: печатает эффективную конфигурацию WELD для файла или
  директории (корень, `aliasesBaseUrl`, `tsconfig`, разобранные алиасы).

Эффективная конфигурация — это то, что видит правило: `settings.weld` из ESLint-конфига плюс
автопоиск алиасов в tsconfig и подъем корня до якорей. Такую логику сейчас умеет только
`src/rules/context.ts`, и она завязана на `Rule.RuleContext`. Работа делится на два этапа:

1. **Рефакторинг**: логика переезжает в `src/config/` как функция над обычным объектом
   (`{ filename, settings, cwd, options? }`), без импорта `eslint`. `src/rules/context.ts`
   превращается в тонкий адаптер — единственное место, где резолв встречается с ESLint.
2. **CLI**: второй потребитель того же резолва, поэтому правила и CLI получают данные из одного
   источника, а не из двух похожих реализаций.

## Context (from discovery)

- `src/rules/context.ts` — `resolveWeldContext(context, fsHostOverride?)`; читает из контекста
  `settings`, `cwd`, `filename`, `options[0]`; приоритет алиасов `options.aliases` →
  `settings.weld.aliases` → автопоиск tsconfig; root поднимается до якорей (`coverDirs`).
- `src/rules/context.test.ts` — большая поведенческая спецификация резолва (≈30 кейсов), держится на
  `fakeContext` с кастом до `Rule.RuleContext`.
- `src/settings/` — геттеры `getRepoRoot`, `getAliasesBaseUrl`, `getTsconfigName`, `getAliases`,
  `hasAliases`; сырая секция наружу не выходит.
- `src/host/fs.ts` — `getFsHost` и приватная
  `resolveRoot(settings, cwd, repoRootOverride, coverDirs)`; `FsHost` не отдает реальный путь
  наружу.
- `src/tsconfig/` — `loadTsconfigPaths`, отдает `paths`, `realBaseDir`, `configPath`, `realAnchors`;
  сбой → `null` + debug.
- `src/imports/specifier.ts` — `renderSpecifier(form, fromDir, barrier, aliases, extension)`; при
  `form.kind === 'relative'` сам подставляет самый длинный покрывающий алиас, иначе рендерит
  относительный путь с `./`.
- `src/extensions.ts` — `MODULE_EXTENSIONS` / `ENTRY_EXTENSIONS` / `isModuleExtension`.
- `src/testing/` — `makeTmpProject`/`cleanupTmpProjects` (временный проект на реальном диске),
  `repoRoot`, фикстуры tsconfig.
- `scripts/smoke-test.sh` — собирает тарбол, ставит в чужой проект и запускает там ESLint.
- ESLint 10.9.1: `calculateConfigForFile('src')` → `undefined` (директория не матчится), для
  игнорируемого файла → `undefined`, без конфига бросает `Could not find config file.`.
- `commander` есть в `node_modules` только транзитивно (7.2.0); `picocolors` тоже транзитивно (через
  vite/prettier) — оба нужны в `dependencies`.

## Development Approach

- **testing approach**: Regular — сначала код, тесты в той же задаче до перехода к следующей.
- каждая задача завершается зелёным `yarn test`.
- тесты лежат рядом с кодом (`src/<...>/*.test.ts`), поверх `src/testing/` где нужен реальный диск.
- форматирование руками не трогаем: prettier/eslint прогоняет `lint-staged` на коммите.
- `yarn verify` гоняется на восьмой задаче, отдельно `yarn smoke` — там же.
- план правится при изменении объема работ (➕ новые задачи, ⚠️ блокеры).

## Testing Strategy

- **unit**: `src/config/`, `src/imports/`, `src/cli/` — на каждый новый модуль свой `*.test.ts`.
- **поведенческая регрессия**: `src/rules/context.test.ts` и тесты `no-barrel-bypass` остаются без
  правок и обязаны проходить после переноса резолва — это главный сторож рефакторинга.
- **упаковка**: `scripts/smoke-test.sh` дополнительно запускает `weld inspect`, `weld config` и
  `weld config --json` в чужом проекте — единственная проверка `bin`, shebang и второго entry
  `tsup`.

## Progress Tracking

- выполненные пункты помечаются `[x]` сразу;
- найденные по ходу задачи — `➕`, блокеры — `⚠️`;
- при отклонении от плана правится сам план.

## Solution Overview

Порядок работ: сначала один источник правды для резолва, только потом CLI.

1. **Рефакторинг** — `src/config/` владеет «эффективная конфигурация WELD для файла». Вход — обычный
   объект, выход — обычный объект; `eslint` этот модуль не импортирует вовсе. `src/rules/context.ts`
   остается адаптером `Rule.RuleContext` → вход резолва и обратно, и именно он единственный знает
   про `Rule.RuleContext`/`context.options`.
2. **CLI** — `src/cli/`: программа на commander, две команды, резолв ESLint-конфига, рендер вывода
   (цвета по умолчанию, `--no-color`, `--json`).
3. **`src/bin.ts`** — исполняемый вход с shebang; собирается вторым entry `tsup` в `dist/bin.js`.

Резолв ленивый: `resolveForFile` возвращает объект с частями, каждая считается по первому обращению
и запоминается. Сегодня lazy-выигрыш не виден — текущее правило и CLI спрашивают и корень, и алиасы,
— но следующее правило возьмет из той же конфигурации другую часть, и тогда кривая неиспользуемая
часть не должна валить его на первом же файле. Ленивость здесь дешевле, чем появившийся позже второй
резолв с другим набором полей.

## Technical Details

```ts
// src/config/resolve.ts — без импорта eslint
export type WeldResolveInput = {
    filename: string;
    settings: unknown;
    cwd: string;
    options?: {
        repoRoot?: string;
        aliasesBaseUrl?: string;
        aliases?: Record<string, unknown>;
        tsconfig?: string;
    };
};

export type WeldTarget = {
    /** Виртуальный путь от корня репозитория; `null` — файл вне корня. */
    getFromFile(): string | null;
    /** Реальный корень; `null` только при инъекции `fsHostOverride` — у поддельного хоста его нет. */
    getRoot(): string | null;
    getFsHost(): FsHost;
    getAliases(): Alias[];
};

export function resolveForFile(input: WeldResolveInput, fsHostOverride?: FsHost): WeldTarget;
```

- Каждая часть считается по первому обращению и мемоизируется в замыкании. Порядок зависимостей:
  tsconfig (нужны `realAnchors` для корня и `paths` для алиасов) → `getRoot`/`getFsHost` →
  `getAliases`. Потребитель, спросивший только `getAliases()`, не резолвит корень дважды, а
  спросивший только `getFromFile()` не разбирает алиасы. Новые части добавляются сюда же, когда их
  просит очередное правило, — граница остается узкой.
- Производительность не должна просесть, поэтому tsconfig — ленивая часть **внутри** `getRoot`/
  `getAliases`, а не на уровне `resolveForFile`: при явных алиасах (`options.aliases` или
  `settings.weld.aliases`) tsconfig не читается вовсе, как и сейчас. Мемо живёт в пределах одного
  вызова; кросс-файловое переиспользование остается в существующих кэшах (`src/tsconfig/`, инстансы
  `getFsHost`, TTL-кэш `getAliases`). Успешный разбор кэшируется, исключение — нет.
- `getFromFile()` → `null` — `filename` вне корня репозитория (то же условие, что сейчас у
  `resolveWeldContext`).
- Семантика не меняется: приоритет `options.aliases` → `settings.weld.aliases` → tsconfig; пустой
  `{}` алиасов выключает автопоиск; `fsHostOverride` выключает автопоиск; кривой tsconfig → debug и
  пустые алиасы; tsconfig вне явного root отбрасывается; кривые явные алиасы бросают.
- `src/rules/context.ts`: `resolveWeldContext` собирает `WeldResolveInput` из контекста, зовет
  `resolveForFile`, берет `getFromFile()` (нет — `null`), `getAliases()` и `getFsHost()` и
  возвращает прежний `WeldContext` (`fromFile`, `aliases`, `fsHost`, `options`).
  `WELD_OPTION_PROPERTIES` не меняется.
- Тип `input.options` объявляется в `src/config/` (свойства те же, что у `WeldOptions` в
  `context.ts`); адаптер передает туда свои разобранные опции структурно. Зависимость односторонняя:
  `rules → config`, обратных импортов нет.
- `src/host/fs.ts`: `resolveRoot` выходит через баррель (ее же использует `getFsHost`), `FsHost` не
  расширяется — реальный путь правилам по-прежнему недоступен.
- `src/imports/specifier.ts`: новый экспорт `renderAliasPath(target, aliases): string | null` —
  обратный подбор алиаса по виртуальному пути (через существующие `longestCoveringAlias` /
  `renderAlias`). `renderSpecifier` не меняется.
- `src/cli/eslint-config.ts` — единственное место CLI, знающее про ESLint. Наружу отдает не
  `Linter.Config`, а минимум: `{ filePath, settings, sampleOf? }`. Поэтому `eslint` не течет в
  рендер и команды.
- `eslint` грузится динамически (`await import('eslint')`), а не статическим импортом: статический
  упал бы на загрузке модуля, до любой диагностики. Если пакета нет в проекте, наружу уходит ошибка
  «eslint is not installed in this project» вместо стектрейса.
- `cwd` у CLI — `process.cwd()`; отдельного `--cwd` нет. Относительные аргументы резолвятся от него
  и в выводе показываются абсолютным путем в `file:`.
- Ошибки: в текстовом режиме `error: <текст>` в stderr; при `--json` — в stdout `{ "error": "..." }`
  и тот же `exit 1`, чтобы машинный потребитель не парсил текст.

Вывод `weld inspect`:

```
$ weld inspect src/feature/internal.ts
file:  /srv/jt4d-lab/weld/src/feature/internal.ts
alias: @/feature/internal
```

- `index.<ext>` схлопывается в директорию: `src/feature/index.ts` → `@/feature`.
- Ни один алиас не покрывает файл → печатается виртуальный путь (`/src/feature/internal.ts`), а не
  относительный `./src/...` от `renderSpecifier`.

Вывод `weld config`:

```
$ weld config src/feature
file:   /srv/jt4d-lab/weld/src/feature/index.ts (sample of src/feature)
settings.weld:
  repoRoot:       /srv/jt4d-lab/weld
  aliasesBaseUrl: .
  tsconfig:       tsconfig.json
  aliases:
    @/* → /src/*
```

- Для файла первая строка без пометки `(sample of ...)`.
- Пометок происхождения (`(default)`, `(from tsconfig.json)`) нет: они потребовали бы нового
  предиката присутствия ключа в `src/settings/`.
- Алиасов нет → `  aliases: (none)`.
- Директория: обход в алфавитном порядке (пропускаем `node_modules`, `.git`, dot-директории), первый
  файл с `MODULE_EXTENSIONS`, для которого ESLint отдал конфиг (игнорируемые дают `undefined`).
  Ничего не нашли — ошибка, не пустой вывод.
- Ошибки в stderr как `error: <текст>`, `exit 1`: путь не существует; нет ESLint-конфига; путь вне
  корня репозитория; файл игнорируется конфигом; в директории нет линтуемых файлов.

Цвета и машинный вывод:

- Цвета по умолчанию: подписи и пометки приглушенные, значение алиаса акцентное. Выключаются
  `--no-color`, а также штатно через `NO_COLOR`/`FORCE_COLOR` (это дает `picocolors`).
- `--json` (глобальный флаг программы) печатает только JSON, без цветов и без текстовых подписей:

```json
// weld inspect --json src/feature/internal.ts
{ "file": "/srv/jt4d-lab/weld/src/feature/internal.ts", "alias": "@/feature/internal" }

// weld config --json src/feature
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

- `alias` в JSON — `null`, когда алиаса нет; `sampleOf` отсутствует у файла.
- `sampleOf` — аргумент директории в том виде, как его ввели.
- `--version` и `--help` — от commander; версия берется из `package.json` через
  `createRequire(import.meta.url)` (тот же прием, что в `src/index.ts`), а не дублируется литералом.

## What Goes Where

**Implementation Steps** — задачи 1–7, проверка и документация — 8–9.

**Post-Completion** — ничего внешнего: публикация пакета не входит в план.

## Implementation Steps

### Task 1: Экспорт `resolveRoot` из слоя ФС

**Files:**

- Modify: `src/host/fs.ts`
- Modify: `src/host/index.ts`
- Modify: `src/host/fs.test.ts`

- [x] вынести `resolveRoot` в экспорт `src/host/fs.ts`, `getFsHost` продолжает ее использовать
- [x] добавить `resolveRoot` в баррель `src/host/index.ts`
- [x] тесты в `src/host/fs.test.ts`: явный `repoRoot` побеждает и игнорирует `coverDirs`; авто-root
      поднимается до общей директории с якорем; якорь без общего префикса игнорируется
- [x] `yarn test` — зеленый до перехода к задаче 2

### Task 2: Модуль `src/config/` — один источник резолва, без ESLint

**Files:**

- Create: `src/config/resolve.ts`
- Create: `src/config/index.ts`
- Create: `src/config/resolve.test.ts`
- Modify: `src/rules/context.ts`

- [x] перенести `resolveHostAndAliases`/`aliasesFromTsconfig` в `src/config/resolve.ts` как
      `resolveForFile(input, fsHostOverride?)` над обычным объектом; `eslint` в модуль не
      импортируется
- [x] вернуть `WeldTarget` с ленивыми `getFromFile`/`getRoot`/`getFsHost`/`getAliases`: каждая часть
      считается по первому обращению и мемоизируется; `getRoot` — из `resolveRoot` с якорями
      tsconfig, `null` при инъекции `FsHost`
- [x] tsconfig — ленивая часть внутри `getRoot`/`getAliases`: при явных алиасах он не читается вовсе
      (сегодняшнее поведение), иначе проекты с `settings.weld.aliases` платили бы за поиск tsconfig
      на первом файле директории
- [x] `src/rules/context.ts` — адаптер: собирает вход из `Rule.RuleContext`, читает нужные части и
      возвращает прежний `WeldContext`; про ESLint-типы знает только он
- [x] тесты `src/config/resolve.test.ts` на вход без контекста: базовый резолв, `getFromFile()` →
      `null` вне корня, приоритет опций, кривой tsconfig, `getRoot()` покрывает якоря, `root: null`
      при инъекции `FsHost`
- [x] тесты на ленивость: `getRoot()` не бросает на кривых `aliases`; `resolveForFile` сам по себе
      не бросает на кривых `aliases` — исключение только из `getAliases()`; повторное обращение к
      части не пересчитывает ее (tsconfig читается один раз)
- [x] тест на отсутствие регрессии: при явных алиасах `getRoot()` не бросает на кривом типе
      `settings.weld.tsconfig` (например, `42`) — значит `getTsconfigName` не вызывался
- [x] сохранить семантику: приоритет `options.aliases` → `settings.weld.aliases` → tsconfig; пустой
      `{}` выключает автопоиск; `fsHostOverride` выключает автопоиск; кривой tsconfig → debug +
      пустые алиасы; tsconfig вне явного root отбрасывается
- [x] `yarn test`: `src/rules/context.test.ts` (≈30 кейсов) и тесты `no-barrel-bypass` проходят
      **без правок** — рефакторинг не изменил поведения

### Task 3: Обратный рендер алиаса в слое импортов

**Files:**

- Modify: `src/imports/specifier.ts`
- Modify: `src/imports/index.ts`
- Modify: `src/imports/specifier.test.ts`

- [x] добавить `renderAliasPath(target, aliases)` — самый длинный алиас, покрывающий путь; `null`,
      если не покрывает ни один
- [x] отдать через баррель `src/imports/index.ts`
- [x] тесты: покрытие якорем, самый длинный из нескольких, граница по сегменту (`@/features` не
      покрывает `@/features-old`), `null` без покрытия
- [x] `yarn test` — зеленый до перехода к задаче 4

### Task 4: Источник ESLint-конфига для пути

**Files:**

- Create: `src/cli/eslint-config.ts`
- Create: `src/cli/eslint-config.test.ts`

- [ ] `loadLintSettings(path, cwd)` → `{ filePath, settings, sampleOf? }`: `loadESLint()` →
      `new ESLintCtor({ cwd })`, путь резолвится от `cwd`; файл → `calculateConfigForFile`
      (`loadESLint()` берет flat-конфиг на ESLint 9 и 10 — проект поддерживает оба)
- [ ] `eslint` грузить динамически: статический `import` упал бы на загрузке модуля раньше
      диагностики; отсутствие пакета → понятная ошибка «eslint is not installed in this project»
- [ ] отдавать наружу только `settings`, без `Linter.Config`: про ESLint знает только этот модуль
- [ ] директория → сэмпл: обход `node:fs` в алфавитном порядке, пропуск `node_modules`, `.git`,
      dot-директорий, первый файл с `MODULE_EXTENSIONS`, для которого конфиг определен
- [ ] понятные `Error`-сообщения: пути нет; конфига нет; путь игнорируется; в директории нет
      линтуемых файлов
- [ ] тесты на `makeTmpProject`: файл с `settings.weld`; директория → сэмпл и `sampleOf`;
      игнорируемый файл (`ignores`) пропускается; пустая директория → ошибка; проект без конфига →
      ошибка; передан каталог вместо файла в `inspect` → ошибка; `cleanupTmpProjects` в `afterEach`
- [ ] `yarn test` — зеленый до перехода к задаче 5

### Task 5: Рендер вывода — текст с цветом и JSON

**Files:**

- Create: `src/cli/render.ts`
- Create: `src/cli/render.test.ts`

- [ ] `renderInspect(data, { color })` и `renderConfig(data, { color })` — текстовый вывод из
      Technical Details; цвета через `picocolors.createColors(color)`
- [ ] `renderJson(value)` — `JSON.stringify(value, null, 2)`, без цветов
- [ ] выравнивание подписей `settings.weld` и форма `prefix/* → anchor/*` для алиасов
- [ ] тесты: файл и директория; пустые алиасы → `(none)`; один и несколько алиасов; `color: false`
      дает чистый текст без escape-последовательностей; JSON-формы обеих команд (`alias: null`,
      отсутствующий `sampleOf`)
- [ ] `yarn test` — зеленый до перехода к задаче 6

### Task 6: Команды `inspect` и `config`

**Files:**

- Create: `src/cli/inspect.ts`
- Create: `src/cli/config.ts`
- Create: `src/cli/program.ts`
- Create: `src/cli/index.ts`
- Create: `src/cli/inspect.test.ts`
- Create: `src/cli/config.test.ts`

- [ ] `inspect`: `resolveForFile` по настройкам файла → `getFromFile()` (нет — ошибка «вне корня»),
      `index.<ext>` схлопывается в директорию, `renderAliasPath`, иначе `getFromFile()`
- [ ] `config`: `getAliasesBaseUrl`/`getTsconfigName` из `src/settings/` плюс `getRoot()` и
      `getAliases()` того же `WeldTarget`, затем `renderConfig`; CLI читает все части намеренно —
      здесь ошибка в конфиге и должна быть видна
- [ ] `createProgram(deps)` — инъекция `loadLintSettings`, `write`, `writeError`: команды не знают,
      откуда берется конфиг и куда идет вывод; `cwd` берется из `deps` (в бою — `process.cwd()`)
- [ ] глобальные флаги `--json`, `--no-color`, `--version` (версия из `package.json`); при `--json`
      текст не печатается, ошибки уходят в stdout как `{ "error": "..." }`; читаются действием через
      `command.optsWithGlobals()`
- [ ] ошибка действия → `error: <текст>` в stderr и `exitCode = 1`; `inspect` с директорией → ошибка
      «expected a file»
- [ ] баррель `src/cli/index.ts` отдает `createProgram` и тип зависимостей
- [ ] тесты: `inspect` с алиасом, `inspect` без алиасов → виртуальный путь, `inspect --json`;
      `config` для файла, для директории, `config --json`; ошибки (нет пути, нет конфига, вне корня)
      → сообщение и код возврата, при `--json` — JSON с `error`; `--version` печатает версию из
      `package.json`
- [ ] `yarn test` — зеленый до перехода к задаче 7

### Task 7: Исполняемый вход и упаковка

**Files:**

- Create: `src/bin.ts`
- Modify: `tsup.config.ts`
- Modify: `package.json`
- Modify: `scripts/smoke-test.sh`

- [ ] `src/bin.ts` — shebang `#!/usr/bin/env node`, `createProgram().parseAsync(process.argv)` и
      обработка исключения в `error: ...` + `exit 1`
- [ ] `--version` проверяет, что `createRequire(import.meta.url)('../package.json')` работает из
      собранного `dist/bin.js` (пакет `package.json` попадает в тарбол всегда)
- [ ] `tsup.config.ts`: второй entry `src/bin.ts` → `dist/bin.js`
- [ ] `package.json`: `"bin": { "weld": "./dist/bin.js" }`, `commander` и `picocolors` в
      `dependencies` (`yarn add commander picocolors`; если реестр недоступен — ⚠️ остановиться и
      спросить)
- [ ] `scripts/smoke-test.sh`: в чужом проекте после ESLint запустить
      `npx --no-install weld inspect src/example.js`, `weld config src` и `weld config --json src`,
      проверить `file:` в выводе и разбор JSON
- [ ] `yarn build` и `yarn smoke` — сборка и упаковка живы, `dist/bin.js` исполняемый
- [ ] `yarn test` — зеленый до перехода к задаче 8

### Task 8: Verify acceptance criteria

- [ ] все пункты Overview реализованы: две команды, вывод из Technical Details, цвета, `--json`,
      коды возврата
- [ ] крайние случаи: файл вне корня, отсутствующий путь, проект без ESLint-конфига, пустая
      директория, `index.<ext>` в `inspect`, пустые алиасы
- [ ] рефакторинг не изменил поведение: `src/rules/context.test.ts` без правок, плагин линтует сам
      себя (`yarn lint`)
- [ ] `yarn verify` (линт, prettier --check, типы, тесты, сборка) — зеленый
- [ ] `yarn smoke` и `yarn smoke 9` — зеленые

### Task 9: [Final] Документация

- [ ] `docs/cli.md` — обе команды, имя бинаря `weld`, формат вывода, цвета и `--no-color`, `--json`,
      коды возврата, требование «eslint установлен в проекте», примеры
- [ ] пункт `CLI` в группах навигации `docs/.vitepress/config.ts`
- [ ] `README.md` — упоминание CLI рядом с установкой плагина
- [ ] `AGENTS.md` — новый слой `src/config/` (ленивый резолв без ESLint, адаптер в
      `src/rules/context.ts`), модуль `src/cli/` и вход `src/bin.ts` (в списки баррелей тоже),
      экспорт `resolveRoot`, `bin`, `commander` и `picocolors` в зависимостях
- [ ] перенести план в `docs/plans/completed/`

## Post-Completion

Ничего внешнего: публикация в npm и обновление потребляющих проектов вне этого плана. Если при
реализации окажется, что `commander@^14` или `picocolors` недоступны в реестре, версии подбираются
по тому, что есть, — это единственное место плана, где возможна правка под окружение.
