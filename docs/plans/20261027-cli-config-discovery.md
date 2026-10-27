# Конфиг ESLint по пути и флаг `--config`

## Обзор

`weld config <path>` и `weld inspect <file>` читают ESLint-конфиг только от текущей директории:
`cwd` уходит и в `createRequire`, и в `new ESLint({ cwd })`. На **ESLint 9** это дает неверный ответ
в монорепе: конфиг ищется от `cwd` вверх, поэтому из корня виден только корневой
`eslint.config.mjs`, а пакетные игнорируются. На **ESLint 10** поиск уже идет от файла (проверено на
10.9.1), поэтому там ответ правильный — расхождение версий само по себе аргумент за то, чтобы выбор
конфига не зависел от того, какой ESLint поставили.

Берем три связанные правки:

1. **Поиск ближайшего конфига к аргументу** — вверх по дереву от директории цели (у файла — от его
   директории), одинаково на ESLint 9 и 10. Для директории аргументом конфиг выбирается по самому
   пути, сэмпл — лишь представительский файл.
2. **`--config <path>`** — глобальная опция CLI: поиск отменяется, поведение как у `eslint --config`
   (шаблоны `files`/`ignores` считаются от `cwd`).
3. **Пути в выводе от корня репозитория** — `file:`, новая строка `config:` и те же значения в
   `--json`; абсолютный путь остается только у `settings.repoRoot` и у конфига вне корня.

Заодно вывод перестает скрывать, откуда взялись настройки: строка `config:` и есть ответ на вопрос,
с которого началось это изменение.

`repoRoot` по-прежнему находится вверх от `cwd` (`findRepoRoot(cwd) ?? cwd`): путь влияет только на
выбор конфига.

## Контекст (из разведки)

- `src/cli/eslint-config.ts` — единственное место слоя, знающее про ESLint.
  `loadLintSettings(path, cwd)`: резолвит путь от `cwd`, `new ESLint({ cwd })`, для файла —
  `calculateConfigForFile`, для директории — обход `sample.ts` за первым файлом, на который ESLint
  отдал конфиг. Наружу отдает `{ filePath, settings, options?, sampleOf? }`, не `Linter.Config`.
- `src/cli/sample.ts` — обход директории и `statOf`; единственное место слоя, которое само ходит по
  диску. Новый поиск конфига ходит по диску так же.
- `src/cli/target.ts` — общее у команд: `virtualPathOf` (заодно проверка «файл внутри корня») и
  `repoRootOf`.
- `src/cli/inspect.ts`, `src/cli/config.ts` собирают данные; `src/cli/render.ts` печатает текст или
  JSON и про резолв не знает. `InspectData.file`, `ConfigData.file` — абсолютные пути.
- `src/cli/program.ts` — глобальные `--json`/`--no-color`, `ProgramDeps` с швом
  `loadLintSettings(path, cwd)`, действия берут опции через `command.optsWithGlobals()`.
- `scripts/smoke-test.sh` ждет абсолютные пути: `^file:  $TMP/project/src/example.js$` (строки 90 и
  95), а `config --json` проверяет только `settings.repoRoot`.
- ESLint 9.9.0 (`node_modules/eslint/lib/eslint/eslint.js` в `/srv/1vit/more`): конфиг ищется
  `findFlatConfigFile(cwd)` — только от `cwd` вверх; при найденном конфиге
  `basePath = dirname(configFilePath)`, при `overrideConfigFile` — `basePath = cwd`. Имена: `js` →
  `.mjs` → `.cjs`, TS-варианты — через `FLAT_CONFIG_FILENAMES_WITH_TS` и флаг `unstable_ts_config`
  (`isFileTS(filePath) && hasUnstableTSConfigFlag`, то есть без флага `.ts`-конфиг не грузится).
- ESLint 10.9.1 (`node_modules/eslint/lib/config/config-loader.js` в этом репозитории):
  `calculateConfigForFile` → `loadConfigArrayForFile` → `findConfigFileForPath(filePath)` →
  `findUp(FLAT_CONFIG_FILENAMES, { cwd: dirname(file) })`, `basePath = dirname(configFilePath)`,
  `configFile`-override — `basePath = cwd`. `FLAT_CONFIG_FILENAMES` — все шесть имен, `.ts` грузится
  через `jiti` без флагов (флаг включает только нативный путь). Отсюда: **на 10-й версии текущий
  `weld` уже показывает пакетный конфиг** — воспроизводится проблема только на 9-й.
- Проба на 10.9.1 (tmp-проект, вложенный `packages/a/eslint.config.mjs`): `src.js` → корневой
  `settings.weld`, `packages/a/src/x.js` → пакетный. Значит `cwd` = директория конфига + явный
  `overrideConfigFile` дает на 10 ровно то же, что ESLint делает сам.
- Проверено на `/srv/1vit/more`: корневой конфиг держит `settings.weld` пустым, напечатанные алиасы
  приходят из автопоиска корневого `tsconfig.json`; `overrideConfigFile` из корня распространяет
  пакетные `files: ['**/*.ts']` на весь репозиторий, а `cwd` = директория пакета — нет.
- `docs/plans/completed/20261027-cli-inspect-config.md` (в истории: `git show 6df8799^:…`) — формат
  плана и терминология слоя.

## Подход к разработке

- **testing approach**: Regular — код и тесты в одной задаче, до перехода к следующей.
- каждая задача завершается зеленым `yarn test`; `yarn verify` и `yarn smoke` — в последней задаче.
- тесты с реальным диском идут через `makeTmpProject`/`makeCliProject` из `src/testing/`.
- форматирование руками не трогаем: prettier и eslint прогоняет `lint-staged` на коммите.
- план правится при изменении объема работ (➕ новые задачи, ⚠️ блокеры).

## Стратегия тестирования

- **unit**: `src/cli/config-file.test.ts` — на новый модуль поиска; `eslint-config.test.ts` — на
  выбор конфига, `--config` и `configFile`.
- **поведенческая регрессия**: существующие тесты `src/cli/*.test.ts` остаются в силе; правки в них
  — новые поля (`configFile` в `LintSettings`/`ConfigData`) и относительные пути в `file:`.
  Конкретно ломаются `toEqual`-ассерты `eslint-config.test.ts:37, 120`, заглушка шва в
  `program.test.ts:141`, фикстуры `render.test.ts` и ожидания `file:` в
  `program.test.ts:99, 150, 178`, `config.test.ts`, `inspect.test.ts`.
- **допущение про окружение**: тесты «проекта без конфига» полагаются на то, что над временной
  директорией конфига нет. Это допущение уже действует: сегодня ESLint сам ищет от `cwd` (корень
  tmp-проекта) вверх до корня ФС, после правки — от вложенной директории до того же корня ФС. Риск
  не растет, а не новый.
- **обе версии ESLint**: репозиторий ставит 10.9.1 (peer `^9 || ^10`), потребитель `/srv/1vit/more`
  — 9.9.0. Тесты идут на том, что в `node_modules`, поэтому паритет 9/10 проверяется вручную
  (задача 8) и описывается в документации.
- **упаковка**: `scripts/smoke-test.sh` — единственная проверка собранного `dist/bin.js`, поэтому
  его ожидания обновляются вместе с форматом вывода.

## Отслеживание прогресса

- выполненные пункты помечаются `[x]` сразу;
- найденные по ходу задачи — `➕`, блокеры — `⚠️`;
- при отклонении от плана правится сам план.

## Обзор решения

Порядок работ: сначала источник конфига, потом флаг, потом форма вывода, потом упаковка и
документация.

1. **`src/cli/config-file.ts`** — поиск конфига на диске: свой обход вверх нужен ради одного кода на
   обе версии (в 9.9 `findConfigFile` умеет только от `cwd`, в 10.9 есть `findConfigFile(filePath)`)
   и ради пути конфига для строки `config:`.
2. **`eslint-config.ts`** — ESLint создается с `cwd` = директория найденного конфига и
   `overrideConfigFile` = этот конфиг. Так `basePath` совпадает с тем, что было бы у конфига,
   найденного самим ESLint, а найденный нами конфиг гарантированно становится примененным. Для
   `--config` — `cwd` пользователя и явный путь: ровно `eslint --config`.
3. **`program.ts`** — третий аргумент шва `loadLintSettings` и глобальная опция `--config`.
4. **`target.ts` + команды** — `repoPath(root, absolute)`, относительные пути в данных обеих команд.
5. **`render.ts`** — строка `config:` и ширины колонок по строкам своей команды.

Поведение меняется намеренно: в монорепе из корня теперь виден пакетный конфиг. Для репозитория с
единственным корневым конфигом ответ прежний — его база и раньше совпадала с корнем.

## Технические детали

```ts
// src/cli/config-file.ts — внутренний модуль слоя, баррель его не отдает
export const CONFIG_FILE_NAMES = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    'eslint.config.mts',
    'eslint.config.cts',
];

/** Ближайший конфиг вверх от startDir; null — конфига нет до корня ФС. */
export function findConfigFile(startDir: string): string | null;

/** Явный `--config`: путь от cwd; отсутствующий путь и не-файл — ошибка. */
export function resolveConfigFile(path: string, cwd: string): string;
```

- Список имен — как `FLAT_CONFIG_FILENAMES` в ESLint 10, включая TS-варианты. Исключать их нельзя:
  на 10 конфиг `.ts` грузится через `jiti` без флагов, и поиск без этих имен сломал бы работающий
  сегодня сценарий. На 9 такой файл найдется и упадет на загрузке (`Unknown file extension ".ts"` из
  `import()`), поэтому эту ошибку надо отобразить в понятное сообщение про `unstable_ts_config` и
  `--config` с JS-конфигом. Приоритет внутри директории сохраняется: `js` → `.mjs` → `.cjs` → `.ts`
  → `.mts` → `.cts`, как у `findUp`.
- Обход идет до корня ФС (`dirname(dir) === dir` — стоп), как у `findUp` в ESLint. Якорь для
  `createRequire` при поиске `eslint` по-прежнему `cwd` пользователя: инстанс один и тот же
  независимо от того, чей конфиг выбран.

```ts
export type LintSettings = {
    filePath: string;
    configFile: string; // абсолютный путь примененного конфига
    settings: unknown;
    options?: WeldResolveOptions;
    sampleOf?: string;
};

export async function loadLintSettings(
    path: string,
    cwd: string,
    config?: string,
): Promise<LintSettings>;
```

- Директория для поиска: `statOf(resolve(cwd, path))`, затем файл → `dirname`, директория → сам
  путь.
- `configFile` = `config === undefined ? findConfigFile(startDir) : resolveConfigFile(config, cwd)`;
  `null` → `Error('no eslint config found for <path>')` — текст сохраняем прежний. Ветка
  `isMissingConfigError` (`messageTemplate === 'config-file-missing'`) удаляется вместе с хелпером:
  при заданном `overrideConfigFile` `assertConfigurationExists` не срабатывает ни в 9.9, ни в 10.9,
  то есть после правки она недостижима. Ее тесты переезжают в тест про свой поиск.
- ESLint:
  `new ESLintCtor(config === undefined ? { cwd: dirname(configFile), overrideConfigFile: configFile } : { cwd, overrideConfigFile: configFile })`.
- Остальное не трогаем: `findSample` для директории, `weldOptions`,
  `eslint is not installed in this project`, «eslint ignores», «no lintable files».
- На ESLint 10 явный `overrideConfigFile` + `cwd` = директория конфига воспроизводит ровно то, что
  ESLint нашел бы сам; на 9 — то, чего ему не хватает. Один код на обе версии.

```ts
// src/cli/target.ts
export function repoPath(root: string, absolutePath: string): string;
```

- Под корнем — путь от корня; иначе абсолютный (конфиг вне корня через `--config`, конфиг найденный
  выше `.git`, корень `/`). Проверка через `path.relative`: результат не начинается с `..` и не
  абсолютный.
- `file:` и `config:` формируются в командах (`inspect.ts`/`config.ts`), поэтому в `--json` уходят
  те же строки, что в тексте. `sampleOf` не трогаем — это эхо аргумента, набранного пользователем в
  его `cwd`. `settings.repoRoot` в JSON остается абсолютным: по нему эти пути и разрешаются.

Вывод для монорепа (`/srv/1vit/more`):

```
$ weld config packages/common/src/date/date.utils.spec.ts
file:   packages/common/src/date/date.utils.spec.ts
config: packages/common/eslint.config.mjs
settings.weld:
  repoRoot:       /srv/1vit/more
  aliasesBaseUrl: .
  tsconfig:       tsconfig.json
  aliases:
    @granteo/fixtures → /packages/fixtures/src
```

- Подписи колонок выравниваются по строкам своей команды: у `config` это `file:`/`config:`, у
  `inspect` — `file:`/`alias:`. Общая константа `TOP_LABEL_WIDTH` заменяется счетом по месту, как
  уже сделано в `settingsRows`.
- Пример `inspect` в документации берется на файле, покрытом алиасом: в `/srv/1vit/more` пакетный
  конфиг задает алиасы явно (`@granteo/fixtures`), поэтому tsconfig не читается и на `date.utils.ts`
  печатается виртуальный путь — это состояние конфига того репозитория, а не поведение CLI.
- `--config` резолвится от `cwd`, поиск не выполняется, `cwd` для ESLint остается пользовательским:
  файл вне директории конфига все равно получает его настройки — как при `eslint --config`.
  Отсутствующий путь → `config path does not exist: <path>`.

## Что где лежит

**Шаги реализации** — задачи 1–8: модуль поиска, загрузка настроек, флаг, форма путей, рендер,
smoke, документация, проверка.

**Post-Completion** — ничего внешнего: публикация пакета не входит в план.

## Шаги реализации

### Задача 1: Поиск конфига на диске

**Files:**

- Create: `src/cli/config-file.ts`
- Create: `src/cli/config-file.test.ts`

- [x] `CONFIG_FILE_NAMES` — все шесть имен в порядке ESLint 10 (`js`, `mjs`, `cjs`, `ts`, `mts`,
      `cts`); TS-варианты нужны, потому что на 10 они грузятся через `jiti` без флагов
- [x] `findConfigFile(startDir)`: обход вверх до корня ФС, первый найденный файл; `null`, если дошли
      до корня; `statOf` из `sample.ts`, чтобы отсутствие пути было обычным ответом, а не падением
- [x] `resolveConfigFile(path, cwd)`: резолв от `cwd`, ошибка `config path does not exist: <path>`
      для отсутствующего пути и для директории
- [x] тесты на `makeTmpProject`: конфиг в корне проекта находится из глубокой директории; ближайший
      выигрывает у более далекого; `js` выигрывает у `mjs`, `mjs` у `cjs`, `cjs` у `ts`; конфига нет
      → `null`; `resolveConfigFile` — существующий файл, отсутствующий путь, директория
- [x] `yarn test` — зеленый до перехода к задаче 2

### Задача 2: `loadLintSettings` выбирает конфиг по пути

**Files:**

- Modify: `src/cli/eslint-config.ts`
- Modify: `src/cli/eslint-config.test.ts`

- [x] третий аргумент `config?: string`; `configFile` в `LintSettings`
- [x] стартовая директория поиска: файл → `dirname`, директория → сам путь (после `statOf`)
- [x] конфига нет → `no eslint config found for <path>` до создания ESLint
- [x] ESLint создается с `cwd = config === undefined ? dirname(configFile) : cwd` и
      `overrideConfigFile = configFile`
- [x] удалить `isMissingConfigError` и `configForFile`-ветку: при заданном `overrideConfigFile` они
      недостижимы; тесты «проект без конфига» перевести на свой поиск (текст ошибки тот же)
- [x] ошибка загрузки TS-конфига (ESLint 9: `Unknown file extension ".ts"`) отображается в понятное
      сообщение про `unstable_ts_config` и `--config` с JS-конфигом
- [x] обновить `toEqual`-ассерты (`eslint-config.test.ts:37, 120`): в объект добавляется
      `configFile`
- [x] тесты: вложенный пакетный конфиг выигрывает у корневого (файл в пакете при `cwd` = корень
      проекта); `configFile` в результате; `--config` отменяет поиск и считает шаблоны от `cwd`
      (файл вне директории конфига все равно получает его настройки); `--config` на отсутствующий
      путь → `config path does not exist`; проект без конфига → `no eslint config found`; конфиг над
      корнем проекта (выше tmp-директории) — настройки применяются
- [x] `yarn test` — зеленый до перехода к задаче 3

### Задача 3: Глобальная опция `--config`

**Files:**

- Modify: `src/cli/program.ts`
- Modify: `src/cli/program.test.ts`
- Modify: `src/cli/program.testing.ts` (заглушка шва в `program.test.ts:141` возвращает объект без
  `configFile` — поле обязательное)

- [x] `.option('--config <path>', 'eslint config file to use instead of searching')` рядом с
      `--json`/`--no-color`; `GlobalOptions.config?: string`
- [x] `ProgramDeps.loadLintSettings` получает третий аргумент; действия передают `options.config`
      (обе команды, `optsWithGlobals()` уже используется)
- [x] тесты: `weld config --config <path> <path>` и `weld --config <path> config <path>` дают
      настройки из указанного конфига; `--config` работает и для `inspect`; `--config` с директорией
      (сэмпл ищется под указанным конфигом); отсутствующий `--config` →
      `error: config path does not exist: …` и код 1, при `--json` — `{ "error": … }`
- [x] `yarn test` — зеленый до перехода к задаче 4

### Задача 4: Пути от корня репозитория

**Files:**

- Modify: `src/cli/target.ts`
- Modify: `src/cli/inspect.ts`
- Modify: `src/cli/config.ts`
- Modify: `src/cli/inspect.test.ts`
- Modify: `src/cli/config.test.ts`
- Create: `src/cli/target.test.ts`

- [x] `repoPath(root, absolutePath)`: путь от корня, если он под корнем; иначе абсолютный
- [x] `inspect`: `file` и `--json`-поле `file` — от корня (`alias` не меняется)
- [x] `config`: `file`, `sampleOf` (как набрано), `settings.repoRoot` (абсолютный) — по правилам
      раздела
- [x] `src/cli/target.test.ts`: `repoPath` — путь под корнем, путь вне корня (абсолютный), корень
      `/`
- [x] тесты команд: относительный путь для файла под корнем; абсолютный для конфига вне корня;
      `sampleOf` печатается как набран; `repoRoot` в JSON абсолютный (абсолютный путь вне корня
      проверяется на уровне `repoPath`: поле `config:` с конфигом вне корня появляется только в
      задаче 5)
- [x] переписать ожидания `file:` на относительные (абсолютные `root`-префиксы остаются только
      внутри `makeCliProject`): `inspect.test.ts`, `config.test.ts`, `program.test.ts:99, 150, 178`
- [x] `yarn test` — зеленый до перехода к задаче 5

### Задача 5: Строка `config:` в выводе

**Files:**

- Modify: `src/cli/render.ts`
- Modify: `src/cli/render.test.ts`
- Modify: `src/cli/program.test.ts`
- Modify: `src/cli/config.ts` (поле `configFile` в `ConfigData`)

- [x] `ConfigData.configFile` — уже относительный путь (считается в `config.ts`, как и `file`)
- [x] `renderConfig`: строка `config:` между `file:` и `settings.weld:`; ширины колонок по строкам
      своей команды, `TOP_LABEL_WIDTH` убирается
- [x] `renderInspect` не меняется по составу строк
- [x] тесты: текст с `config:` и выравниванием; `--json` содержит `configFile` рядом с `file`; цвет
      не влияет на текст; фикстуры `ConfigData` в `render.test.ts` получают `configFile`
- [x] `yarn test` — зеленый до перехода к задаче 6

### Задача 6: Smoke-тест упаковки

**Files:**

- Modify: `scripts/smoke-test.sh`

- [x] ожидание `file:` — относительный путь (`^file:  src/example.js$`, у директории
      `(sample of src)`)
- [x] проверка строки `config:` и относительного `file` в `config --json`
- [x] `weld config --config <другой конфиг> src` в проекте-потребителе: рядом с `eslint.config.mjs`
      кладется `eslint.config.other.mjs` с другим `settings.weld` (другой алиас), и проверяется, что
      напечатался именно он — иначе проверка ничего не отличает
- [x] `yarn build` и `yarn smoke` — зеленые

### Задача 7: Документация

**Files:**

- Modify: `docs/cli.md`
- Modify: `AGENTS.md`

- [x] `docs/cli.md`: вместо «ESLint-конфиг ищется оттуда же» — правило выбора конфига (ближайший к
      пути, для директории — по самому пути, `--config` отменяет поиск и работает как
      `eslint --config`), относительные пути в примерах, оговорка про абсолютный путь для конфига
      вне корня, строка `config:` в описании вывода, `configFile` в `--json`
- [x] там же: как ведет себя `eslint.config.ts` (в ESLint 9 нужен `unstable_ts_config`, для CLI —
      `--config` с JS-конфигом; в 10 грузится через `jiti`) и что на ESLint 10 поиск от файла был и
      до правки — CLI выравнивает версии
- [x] пример `inspect` берется на файле, покрытом алиасом
- [x] `AGENTS.md`, раздел «Модуль `src/cli/` и вход `src/bin.ts`»: `config-file.ts` и почему поиск
      свой, `cwd` ESLint = директория конфига, `--config`, пути в выводе от корня

### Задача 8: Проверка критериев приемки

- [x] `yarn verify` — линт, prettier, типы, тесты, сборка
- [x] `yarn smoke` — упакованный `weld` на чужом проекте
- [x] ручная проверка на `/srv/1vit/more` (ESLint 9.9.0):
      `weld config packages/common/src/date/date.utils.spec.ts` показывает пакетный конфиг и строку
      `config:`; без правки там были корневые настройки
- [x] ручная проверка на репозитории с ESLint 10 (tmp-проект с вложенным конфигом): ответ одинаковый
      на `9` и `10` — выбор конфига не зависит от версии
- [x] критерии приемки выполнены, план помечен выполненным (перенос в `docs/plans/completed/`
      выполняет харнесс)

## Критерии приемки

- `weld config <path>` и `weld inspect <file>` берут конфиг, ближайший к аргументу, а не к `cwd`;
  для директории конфиг выбирается по ней самой, сэмпл — представительский файл. Ответ одинаков на
  ESLint 9 и 10.
- `--config <path>` отменяет поиск, резолвится от `cwd` и ведет себя как `eslint --config`; его
  отсутствие и несуществующий путь дают понятную ошибку и код 1.
- `eslint.config.ts` находится поиском (как в ESLint 10) и не теряется; на ESLint 9 ошибка загрузки
  объясняет причину и называет выход.
- В тексте и в `--json` `file:`/`config:` печатаются от корня репозитория; `settings.repoRoot`
  остается абсолютным, конфиг вне корня печатается абсолютным путем.
- `sampleOf` остается эхом аргумента.
- Сообщения об ошибках не изменились, кроме нового `config path does not exist`; недостижимая ветка
  `isMissingConfigError` удалена.
- `yarn verify` и `yarn smoke` зеленые; `docs/cli.md` и `AGENTS.md` описывают новое поведение.
