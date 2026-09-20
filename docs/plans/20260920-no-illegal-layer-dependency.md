# Правило `weld/no-illegal-layer-dependency`

## Overview

Реализовать второе правило плагина — проверку направления зависимостей между слоями. Правило
сравнивает слой линтуемого файла со слоем цели каждого импорта и репортит импорты, идущие против
порядка, заданного проектом в `settings.weld`.

Проблема, которую решает: слои, объявленные в документации проекта, ничем не держатся — импорты
ходят в обе стороны, и «слои» остаются папками. `no-barrel-bypass` закрывает границу модуля, но
ничего не знает про порядок слоёв.

Интеграция: правило встаёт рядом с `no-barrel-bypass` и переиспользует существующий каркас —
`resolveWeldContext` (настройки, `FsHost`, опции), `parseSpecifier` и `createSpecifierVisitor` из
`src/imports/`, сегментные операции из `src/path/`. Диск правило не читает: слой определяется по
виртуальному пути, существование цели не проверяется.

Документация правила уже написана как определение готовности:
`docs/rules/no-illegal-layer-dependency.md`. Она отражает **прежнюю** модель и правится в рамках
этого плана под согласованную.

## Context (from discovery)

- **Файлы-образцы:** `src/rules/no-barrel-bypass/index.ts` (meta, шов `createRule(fsHost?)`,
  visitor), `.../pipeline.ts` (`createChecker`: собирается на файл, вызывается на импорт),
  `.../core/barrier.ts` (чистая арифметика путей), `src/rules/context.ts` (`WELD_OPTION_PROPERTIES`,
  `resolveWeldContext`). Тесты соседа разложены как `rule.test.ts` (поведение), `options.test.ts`
  (опции), `pipeline.test.ts`, `integration.test.ts` — новое правило повторяет это разложение.
- **Настройки:** `src/settings/weld.ts` — геттеры с позиционными override и кэш `cachedAliases`
  (список записей, ключ — кортеж из трёх ссылок, TTL 60 c, вытеснение на промахе; общий на
  `getAliases` и `getAliasesFromPaths`); `src/settings/aliases.ts` — разбор и валидация значений.
- **Потребители изменяемых сигнатур:** `src/rules/context.ts` (4 вызова), `src/host/fs.ts`
  (`resolveRoot` → `getRepoRoot`, сигнатура `getFsHost`). Тесты под правку:
  `src/settings/weld.test.ts`, `src/host/fs.test.ts`,
  `src/rules/no-barrel-bypass/integration.test.ts`. Других потребителей нет.
- **`parseSpecifier`** (`src/imports/specifier.ts`) возвращает `{ path, form, extension }`, где
  `path` — путь **как записан в специфаере**: директорию в `index.<ext>` он не разворачивает. Отсюда
  ключевое решение про цель (см. Technical Details).
- **`src/extensions.ts`** — два разных предиката: `isEntryFileName(name, ext)` и
  `isEntryBasename(name)`. Используется второй, в связке
  `isEntryBasename(splitExtension(basename(p)).name)` — как в `core/barrier.ts`.
- **`scripts/smoke-test.sh`** собирает конфиг потребителя только из `weld.configs.recommended` и
  проверяет наличие реестра правил; новое правило в пресеты не входит, поэтому smoke его не
  проверяет.
- **Инвариант реестра** («у каждого правила есть `meta.docs` и `meta.messages`») живёт в
  `src/plugin.test.ts` и начинает действовать после регистрации.
- **Соглашения репозитория (CLAUDE.md):** баррель `index.ts` на каждый слой `src/`; импорт чужого
  слоя только через баррель; тесты рядом с кодом; документация и коммиты по-русски, рантайм-строки
  (`meta.messages`, `throw`, `debug`) по-английски; prettier/eslint вручную не запускать.

## Development Approach

- **testing approach: TDD** — в каждой задаче сначала тесты (таблица ожиданий), затем реализация под
  них. Для чистых функций (`layerOf`, компиляция схемы, вердикт) таблица ожиданий и есть
  спецификация.
- завершать задачу полностью, прежде чем брать следующую;
- изменения мелкие и сфокусированные;
- **каждая задача обязана содержать новые/обновлённые тесты** — это часть чеклиста, не опция;
- **все тесты зелёные до начала следующей задачи**;
- **обновлять этот файл, если объём меняется по ходу**;
- публичный интерфейс `src/settings/` меняется — все его потребители внутри репозитория правятся в
  той же задаче (задача 1), наружу пакет ничего из этого не экспортирует.

## Testing Strategy

- **unit-тесты** — обязательны в каждой задаче. Основные формы:
    - таблица «конфиг → развёрнутый порядок слоёв» для компиляции схемы;
    - таблица «виртуальный путь → квалифицированный слой + владелец» для `layerOf`, отдельными
      наборами для файла и для цели импорта;
    - матрица прав «слой A → слой B → разрешено/нет» для вердикта;
- **интеграционные тесты правила** — `createRuleTester` с фейковой ФС (`createFakeFsHost` через шов
  `createRule(fsHost?)`), без фикстур на диске: правило диск не читает;
- e2e-тестов в проекте нет (это ESLint-плагин). `yarn smoke` проверяет подключаемость собранного
  пакета, но не это правило: оно вне пресетов, а скрипт собирает конфиг из `configs.recommended`.
  Гоняется в приёмке как регрессия сборки.

## Progress Tracking

- отмечать выполненное `[x]` сразу;
- новые найденные задачи добавлять с префиксом ➕;
- блокеры и проблемы — с префиксом ⚠️;
- если реализация отклоняется от плана — править план.

## Solution Overview

Схема слоёв из конфига разворачивается в **один плоский упорядоченный список квалифицированных
слоёв**, и весь вердикт сводится к сравнению двух индексов в этом списке.

Квалификатор — часть имени: `root:<имя>` (слой проекта), `module:<имя>` (слой модуля), `module`
(публичный интерфейс модуля), `root:unknown` / `module:unknown` (код без слоя на соответствующем
уровне). `@modules` в `layers` разворачивается в `module`, затем в слои модуля, затем снова в
`module` — модуль как целое получает **диапазон**, обрамляющий его слои. Отсюда без особых случаев
следует, что баррель модуля двунаправлен со слоями модулей, а до `pages`/`app` не достаёт.

Пример:

```text
layers:       ['common', '@unknown', '@modules', 'pages', 'app']
moduleLayers: ['entities', 'features', 'widgets']
```

```text
0  root:common
1  root:unknown
2  module
3  module:entities
4  module:features
5  module:widgets
6  module
7  root:pages
8  root:app
```

Вердикт: импорт из слоя `A` в слой `B` разрешён ⟺ `first(B) < last(A)`. Имени, отсутствующего в
схеме, нет и в индексах — такая позиция недостижима и сама импортировать не может.

Ключевые решения и их основания:

- **слой — самое глубокое совпадение** в своём контексте (deepest). Директория заявляет свой уровень
  на любой глубине, и заявление читается буквально — то же чтение, что у первой концепции подхода.
  Известная цена: вложенная папка с именем более высокого слоя расширяет права файла
  (`src/common/utils/app/` даёт `app`); принята осознанно;
- **источник — файл, цель — то, что записано в специфаере.** Для линтуемого файла сканируются
  сегменты `dirname`, для цели — все сегменты пути: `@/common` → `root:common`, `@/modules/order` →
  `module`. Иначе самый канонический легальный импорт (через баррель) репортился бы как нарушение.
  Цена: файл `common/app.ts`, записанный как `@/common/app`, прочитается как слой `app` — та же
  цена, что уже принята для deepest;
- **владелец** — директория найденного слоя (для `module`/`module:unknown` — директория модуля).
  Совпали владельцы → импорт внутренний, правило молчит. Это снимает ложное срабатывание на
  `…/entities/bar.ts` → `…/entities/foo/user.ts`;
- **источник схлопывается, цель — нет**: `module:unknown` как источник **всегда** получает права
  `module`, как цель остаётся собой. Цена принята осознанно: неразмеченный код модуля получает права
  шире, чем размеченный (`module` — диапазон, `module:entities` — точка), и объявленный `@unknown` в
  `moduleLayers` управляет только доступом к такому коду извне;
- **схема обязательна**: правило, включённое без `layers`, бросает исключение на каждом файле — как
  при кривых `aliases`. Молча отключившееся правило хуже громко упавшего;
- **схема не идёт в `WeldContext`** — иначе кривой `settings.weld.layers` уронил бы
  `no-barrel-bypass`, которому схема не нужна. По той же причине опции схемы объявляет само правило,
  а не общий набор `WELD_OPTION_PROPERTIES`: иначе соседнее правило принимало бы и молча
  игнорировало `layers`.

## Technical Details

### `LayerSchema` (`src/settings/layers.ts`)

```ts
type Qualified = string; // 'root:common' | 'module' | 'module:entities' | 'root:unknown' | 'module:unknown'

type LayerSchema = {
    order: Qualified[]; // развёрнутый список: поверхность тестов и debug-лога
    first: Map<Qualified, number>;
    last: Map<Qualified, number>;
    projectLayers: Set<string>; // имена из layers, без спец-слоёв
    moduleLayers: Set<string>; // имена из moduleLayers, без спец-слоёв
    moduleDir: string; // по умолчанию 'modules'
};
```

Разворачивание `layers` поэлементно: `'@modules'` → `'module'`, далее каждый элемент `moduleLayers`
(`'@unknown'` → `'module:unknown'`, иначе `'module:<имя>'`), далее снова `'module'`; `'@unknown'` →
`'root:unknown'`; прочее → `'root:<имя>'`. `@modules` с пустым `moduleLayers` даёт `module, module`
— смежный повтор, ожидаемое поведение (проект с модулями без слоёв).

Кэша у компиляции нет: она не читает диск, не логирует и не отдаёт наружу ничего, что сравнивалось
бы по ссылке, — проход по десятку строк на файл дешевле кэша. Кэш алиасов остаётся как есть, в
`weld.ts` (ключ — кортеж трёх ссылок, общий на `getAliases` и `getAliasesFromPaths`; после
унификации `getAliases` передаёт `[settings, overrides, undefined]`).

Ошибки валидации — исключение с указанием места, как у `aliases`:

| условие                                               | сообщение называет           |
| ----------------------------------------------------- | ---------------------------- |
| `layers`/`moduleLayers` не массив                     | `settings.weld.layers`       |
| элемент не строка / пустая строка                     | `settings.weld.layers[3]`    |
| `@`-имя, отличное от `@modules` и `@unknown`          | конкретный элемент           |
| `@modules` в `moduleLayers`                           | конкретный элемент           |
| `@modules` в `layers` больше одного раза              | `settings.weld.layers`       |
| `moduleLayers` задан, а `@modules` в `layers` нет     | `settings.weld.moduleLayers` |
| одно **обычное** имя и в `layers`, и в `moduleLayers` | конкретный элемент           |
| `moduleDir` не строка, пустая строка или содержит `/` | `settings.weld.moduleDir`    |

`@unknown` из проверки пересечения исключён намеренно: `root:unknown` и `module:unknown` — разные
квалифицированные слои, и объявление `@unknown` в обоих списках — валидный конфиг.

Значения из опций правила в тексте ошибки называются `options.<имя>`.

### `layerOf(virtualPath, schema, kind) → { layer, owner, moduleRoot }`

`kind` — `'file'` (линтуемый файл: сканируются сегменты `dirname`) либо `'target'` (цель импорта:
сканируются все сегменты пути). `moduleRoot` — директория модуля, в котором лежит путь, либо `null`;
нужна, чтобы отличать импорт во внутренности **своего** модуля от импорта во внутренности чужого.

Проход по сегментам слева направо, состояние — «внутри модуля», директория модуля, найденный слой:

1. сегмент равен `schema.moduleDir` **и** за ним есть ещё сегмент → вход в модуль: следующий сегмент
   это имя модуля, `moduleRoot` запоминается, найденный слой **сбрасывается** (у вложенного модуля
   своя система слоёв), шаг через имя модуля. Сканирование на `moduleDir` продолжается и после
   найденного слоя — модуль имеет право лежать внутри компонента слоя;
2. иначе сегмент сверяется с набором: внутри модуля — `schema.moduleLayers`, вне модулей —
   `schema.projectLayers`. Совпало → слой и его индекс перезаписываются (перезапись даёт deepest).

Результат:

| состояние                                             | `layer`          | `owner`         |
| ----------------------------------------------------- | ---------------- | --------------- |
| слой найден внутри модуля                             | `module:<имя>`   | директория слоя |
| слой найден вне модулей                               | `root:<имя>`     | директория слоя |
| слоя нет, внутри модуля, путь — публичный интерфейс\* | `module`         | `moduleRoot`    |
| слоя нет, внутри модуля, остальное                    | `module:unknown` | `moduleRoot`    |
| слоя нет, вне модулей                                 | `root:unknown`   | `null`          |

\* «публичный интерфейс модуля» — путь равен `moduleRoot` (цель вида `@/modules/order`) либо базовое
имя пути — точка входа и лежит прямо в `moduleRoot` (`…/order/index.ts`). Предикат —
`isEntryBasename(splitExtension(basename(path)).name)`; это единственное место, где смотрится имя
файла.

Опорные примеры (идут в таблицы тестов).

Файл (`kind: 'file'`):

| путь                                            | `layer`           | `owner`                 |
| ----------------------------------------------- | ----------------- | ----------------------- |
| `/src/common/ui/button.tsx`                     | `root:common`     | `/src/common`           |
| `/src/common/index.ts`                          | `root:common`     | `/src/common`           |
| `/src/common/utils/app/format.ts`               | `root:app`        | `/src/common/utils/app` |
| `/src/shared/lib/x.ts`                          | `root:unknown`    | `null`                  |
| `/src/index.ts`                                 | `root:unknown`    | `null`                  |
| `/src/modules/x.ts`                             | `root:unknown`    | `null`                  |
| `/src/modules/order/index.ts`                   | `module`          | `/src/modules/order`    |
| `/src/modules/order/index.test.ts`              | `module:unknown`  | `/src/modules/order`    |
| `/src/modules/order/module.ts`                  | `module:unknown`  | `/src/modules/order`    |
| `/src/modules/order/lib/x.ts`                   | `module:unknown`  | `/src/modules/order`    |
| `/src/modules/order/pages/x.ts`                 | `module:unknown`  | `/src/modules/order`    |
| `/src/modules/order/entities/index.ts`          | `module:entities` | `…/order/entities`      |
| `/src/modules/order/entities/user/model.ts`     | `module:entities` | `…/order/entities`      |
| `/src/modules/order/widgets/card/entities/x.ts` | `module:entities` | `…/card/entities`       |
| `/src/modules/order/modules/sub/features/x.ts`  | `module:features` | `…/sub/features`        |
| `…/order/widgets/card/modules/sub/index.ts`     | `module`          | `…/card/modules/sub`    |
| `/src/common/modules/x/lib/a.ts`                | `module:unknown`  | `/src/common/modules/x` |

Цель (`kind: 'target'`, путь уже разрешён `parseSpecifier`):

| специфаер (из `…/order/entities/user/x.ts`) | путь цели               | `layer`            |
| ------------------------------------------- | ----------------------- | ------------------ |
| `@/common`                                  | `/src/common`           | `root:common`      |
| `@/common/index.ts`                         | `/src/common/index.ts`  | `root:common`      |
| `@/common/app`                              | `/src/common/app`       | `root:app` ⚠️ цена |
| `@/modules/order`                           | `/src/modules/order`    | `module`           |
| `@/modules/order/index.ts`                  | `…/order/index.ts`      | `module`           |
| `@/modules/order/lib`                       | `…/order/lib`           | `module:unknown`   |
| `@/modules/order/entities`                  | `…/order/entities`      | `module:entities`  |
| `@/modules`                                 | `/src/modules`          | `root:unknown`     |
| `..`                                        | `…/order/entities`      | `module:entities`  |
| `.`                                         | `…/order/entities/user` | `module:entities`  |

### Порядок решений

На файл, до обхода AST:

1. `resolveWeldContext` вернул `null` (файл вне корня репозитория) → правило молчит;
2. `hasLayers(settings, options)` ложно → исключение (английский текст, называет
   `settings.weld.layers` либо `options.layers`) — правило включено, а схемы нет;
3. `layerOf(fromFile, schema, 'file')`; права источника: `module:unknown` → `module`;
4. позиции источника нет в `schema.last` → репорт `undeclaredLayer` на `Program`, обработчики
   импортов не возвращаются. Возможные случаи: `root:unknown` без `@unknown` в `layers`
   (`{{declare}}` = `'@unknown' in layers`) и `module` без `@modules` в `layers` (`{{declare}}` =
   `'@modules' in layers`).

На каждый импорт:

5. `parseSpecifier` вернул `null` (голый пакет, не-JS ресурс, `?`/`!`, абсолютный путь) → пропуск;
6. `layerOf(target, schema, 'target')`; оба владельца не `null` и равны → пропуск (внутренний
   импорт);
7. позиции цели нет в схеме:
    - цель `module:unknown`, `moduleRoot` цели **равен** `moduleRoot` источника →
      `undeclaredTargetLayer` с `{{layer}}` = `@unknown`, `{{declare}}` =
      `'@unknown' in moduleLayers`. Это неразмеченный файл своего же модуля: совет «иди через
      баррель» здесь был бы советом импортировать самого себя;
    - цель `module:unknown` в чужом модуле → `moduleInternals`;
    - цель `root:unknown` → `undeclaredTargetLayer`, `{{declare}}` = `'@unknown' in layers`;
    - цель `module` (схема без `@modules`) → `undeclaredTargetLayer`, `{{declare}}` =
      `'@modules' in layers`;
8. `first(toLayer) < last(fromLayer)` → нарушения нет; иначе репорт: `horizontalDependency` при
   совпадении квалифицированных имён, иначе `illegalDependency`.

Шаги 6–8 живут в `core/verdict.ts`: «легален ли импорт» должна отвечать одна функция, `pipeline.ts`
остаётся склейкой `parseSpecifier` → `layerOf` → `decide`.

### `meta`

- `type: 'problem'`, `docs.description` и `docs.url` (ссылка на страницу правила в master);
- `fixable` и `hasSuggestions` **не объявляются**: нарушение направления правкой пути не
  исправляется;
- `schema`: один объект, `additionalProperties: false`, свойства — собственные (`layers`,
  `moduleLayers`, `moduleDir`) плюс `...WELD_OPTION_PROPERTIES`. Набор собственных объявляет само
  правило (см. Solution Overview);
- имена слоёв в сообщениях — **простые**, как в конфиге; квалификатор не показывается:

| квалифицированный | в сообщении |
| ----------------- | ----------- |
| `root:<имя>`      | `<имя>`     |
| `module:<имя>`    | `<имя>`     |
| `module`          | `module`    |
| `root:unknown`    | `@unknown`  |
| `module:unknown`  | `@unknown`  |

- `{{target}}` — специфаер как записан в исходнике (как `{{original}}` у соседнего правила);
- `messages` (английские, финальный набор):

| `messageId`             | текст                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `illegalDependency`     | `Illegal layer dependency: '{{fromLayer}}' must not import from '{{toLayer}}'.`                                                                                                      |
| `horizontalDependency`  | `Illegal layer dependency: '{{layer}}' must not import from a different '{{layer}}' directory.`                                                                                      |
| `undeclaredLayer`       | `This file belongs to '{{layer}}', which is not declared in the layer schema. Move the file into a layer, or declare {{declare}}.`                                                   |
| `undeclaredTargetLayer` | `'{{target}}' belongs to '{{layer}}', which is not declared in the layer schema. Move it into a layer, or declare {{declare}}.`                                                      |
| `moduleInternals`       | `'{{fromLayer}}' must not import internals of another module: '{{target}}' has no layer inside its module. Import through the module barrel, or declare '@unknown' in moduleLayers.` |

`horizontalDependency` сформулировано нейтрально: условие — совпадение имён при разных владельцах, а
это возможно не только для слоёв модулей (`root:app` → `root:app` из-за deepest, два неразмеченных
файла при объявленном `@unknown`).

### Унификация геттеров `src/settings/`

Все геттеры приводятся к форме `(settings: unknown, overrides?: WeldOverrides)`:

```ts
type WeldOverrides = {
    repoRoot?: unknown;
    aliasesBaseUrl?: unknown;
    aliases?: unknown;
    layers?: unknown;
    moduleLayers?: unknown;
    moduleDir?: unknown;
};
```

Тип объявляет `src/settings/` (формат секции знает только он) и отдаёт через баррель; `WeldOptions`
из `src/rules/context.ts` уходит. Следствие для публичного типа каркаса: `WeldContext.options`
становится `TOwnOptions & WeldOverrides`, то есть общие поля из `string | undefined` превращаются в
`unknown` — сегодня их никто не читает, но это изменение стоит отметить в CLAUDE.md.

`getFsHost(settings, cwd, overrides?, coverDirs?)` — по той же причине: внутри он зовёт
`getRepoRoot`.

В `resolveWeldContext` `(context.options[0] ?? {})` заменяется модульной константой `EMPTY_OPTIONS`:
кэш алиасов ключуется по ссылкам, а `?? {}` создавал бы новый объект на каждый файл.

Новые геттеры схемы: `getLayerSchema(settings, overrides)` (компиляция) и
`hasLayers(settings, overrides)` (присутствие ключа — по образцу `hasAliases`; отличает «не задано»
от `layers: []`).

## What Goes Where

- **Implementation Steps** — код, тесты, документация внутри этого репозитория;
- **Post-Completion** — проверки и решения, требующие внешних действий.

## Implementation Steps

### Task 1: Унифицировать сигнатуры геттеров на `(settings, overrides)`

**Files:**

- Modify: `src/settings/weld.ts`
- Modify: `src/settings/index.ts`
- Modify: `src/host/fs.ts`
- Modify: `src/rules/context.ts`
- Modify: `src/settings/weld.test.ts`
- Modify: `src/host/fs.test.ts`
- Modify: `src/rules/no-barrel-bypass/integration.test.ts`

- [x] переписать тесты `weld.test.ts` под новую форму вызова: `getRepoRoot(settings, { repoRoot })`,
      `getAliases(settings, { aliases, aliasesBaseUrl })`, `hasAliases(settings, { aliases })`
- [x] добавить тест: кэш алиасов попадает при одной и той же ссылке на `overrides` и промахивается
      при новой (страховка от возврата `?? {}`)
- [x] объявить в `src/settings/` тип `WeldOverrides`, отдать через баррель
- [x] перевести `getRepoRoot`, `getAliasesBaseUrl`, `getAliases`, `hasAliases` на
      `(settings, overrides)`; ключ кэша алиасов остаётся кортежем из трёх ссылок (`getAliases`
      передаёт третьим `undefined`)
- [x] перевести `getFsHost` и `resolveRoot` на `overrides` вместо позиционного `repoRootOverride`
- [x] в `resolveWeldContext` ввести `EMPTY_OPTIONS`, удалить локальный `WeldOptions`, передавать
      `options` в геттеры целиком
- [x] обновить `fs.test.ts` и `no-barrel-bypass/integration.test.ts` под новые сигнатуры —
      `integration.test.ts` правки не потребовал: он зовёт `getFsHost` только в двухаргументной
      форме
- [x] run tests - must pass before task 2

### Task 2: Компиляция и валидация схемы слоёв

**Files:**

- Create: `src/settings/layers.ts`
- Create: `src/settings/layers.test.ts`

- [x] написать таблицу «конфиг → `order`»: пример из Solution Overview, `@modules` с пустым
      `moduleLayers` (`module, module`), `@unknown` в `moduleLayers`, `@unknown` в обоих списках
      одновременно, схема без `@modules` вовсе, смежные и разнесённые повторы
- [x] написать тесты на `first`/`last` для повторяющихся имён (`module` получает диапазон) и на
      состав `projectLayers`/`moduleLayers`/`moduleDir` (включая дефолт `'modules'`)
- [x] написать по тесту на каждую ошибку валидации из таблицы Technical Details, включая проверку
      текста (называет `settings.weld.layers[3]`) и **отсутствие** ошибки на `@unknown` в обоих
      списках
- [x] реализовать тип `LayerSchema`, разворачивание и валидацию в `src/settings/layers.ts`
- [x] run tests - must pass before task 3

➕ источник значения у каждой из трёх настроек свой (`layers` из секции, `moduleLayers` из опций и
наоборот), поэтому `parseLayerSchema` принимает не тройку значений, а тройку `{ value, source }`
(`SettingValue`): имя места в конфиге нужно тексту ошибки, а собрать его внутри разбор не может.
Геттеры задачи 3 передают эту тройку.

### Task 3: Геттеры `getLayerSchema` и `hasLayers`

**Files:**

- Modify: `src/settings/weld.ts`
- Modify: `src/settings/index.ts`
- Modify: `src/settings/weld.test.ts`

- [x] написать тесты: приоритет `overrides.layers` над секцией, `hasLayers` различает отсутствие
      ключа и `layers: []`, дефолт `moduleDir`, источник в тексте ошибки называется `options.layers`
      при значении из опций
- [x] реализовать `getLayerSchema(settings, overrides)` и `hasLayers(settings, overrides)` (кэша
      нет, см. Technical Details)
- [x] отдать через `src/settings/index.ts` `getLayerSchema`, `hasLayers` и тип `LayerSchema`
- [x] run tests - must pass before task 4

### Task 4: `layerOf` — путь в квалифицированный слой, владельца и модуль

**Files:**

- Create: `src/rules/no-illegal-layer-dependency/core/layer-of.ts`
- Create: `src/rules/no-illegal-layer-dependency/core/layer-of.test.ts`
- Modify: `src/settings/index.ts`

- [x] перенести в тест обе таблицы из Technical Details целиком — по строке на случай, отдельными
      наборами для `kind: 'file'` и `kind: 'target'`
- [x] добавить тесты на краевые случаи: `moduleDir` последним сегментом, `moduleDir` сразу внутри
      модуля (`modules/order/modules/x.ts`), имя модуля, совпадающее с именем слоя, путь без
      директорий (`/x.ts`), цель равная корню (`/`)
- [x] добавить тесты на `moduleRoot`: совпадает у файлов одного модуля, различается у вложенного
      модуля, `null` вне модулей
- [x] реализовать `layerOf` одним проходом по сегментам: вход в модуль со сбросом слоя, deepest по
      набору контекста, владелец от найденного слоя либо от `moduleRoot`, предикат публичного
      интерфейса модуля
- [x] run tests - must pass before task 5

➕ квалифицированное имя слоя собирается снаружи `src/settings/`, поэтому словарь имён выходит через
баррель слоя: `src/settings/index.ts` дополнен типом `Qualified` и вокабуляром `rootLayer`,
`moduleLayer`, `MODULE`, `ROOT_UNKNOWN`, `MODULE_UNKNOWN`. Иначе `layerOf` собирал бы ключи
`first`/`last` собственными литералами, и формат квалификатора знали бы два слоя. Задаче 5
(`verdict.ts`) этот же вокабуляр нужен для рендера простых имён.

### Task 5: Вердикт по схеме

**Files:**

- Create: `src/rules/no-illegal-layer-dependency/core/verdict.ts`
- Create: `src/rules/no-illegal-layer-dependency/core/verdict.test.ts`
- Modify: `src/settings/layers.ts`
- Modify: `src/settings/layers.test.ts`
- Modify: `src/settings/index.ts`

- [x] написать матрицу прав для схемы из Solution Overview: для каждой пары слоёв ожидание
      разрешено/нарушение, включая `module` (диапазон), `root:unknown`, горизонталь одноимённых
      слоёв
- [x] написать тесты на пропуски: равные владельцы (внутренний импорт), схлопывание источника
      `module:unknown` → `module`
- [x] написать тесты на классификацию каждого случая шага 7: свой модуль против чужого
      (`undeclaredTargetLayer` с `'@unknown' in moduleLayers` против `moduleInternals`), цель
      `root:unknown`, цель `module` при схеме без `@modules`
- [x] написать тесты на `horizontalDependency` для двух форм: одноимённые слои разных модулей и
      одноимённые `root:*` (следствие deepest)
- [x] реализовать `decide(schema, from, to) → { ok: true } | { messageId, data }`, где `from`/`to` —
      результаты `layerOf`; здесь же рендер простых имён слоёв по таблице из Technical Details
- [x] run tests - must pass before task 6

➕ рендер простых имён требует снять квалификатор, то есть знать его формат, — поэтому обратная
операция добавлена к вокабуляру `src/settings/` (`plainLayerName`, баррель слоя), а не собрана в
`verdict.ts` вторым знанием об одном формате. Продолжение решения задачи 4 про сборку имён.

➕ схлопывание источника вынесено в экспортируемую `sourceRights(layer)`: тот же ответ нужен шагу 4
(проверка позиции источника на файле), который живёт вне `decide`.

➕ вердикт не знает специфаера, как он записан в исходнике, поэтому `{{target}}` в данные сообщений
`undeclaredTargetLayer`/`moduleInternals` подставляет вызывающий (задача 6): `decide` отдаёт
остальные поля.

➕ неразмеченный код одного модуля (`module:unknown` → `module:unknown` того же модуля) отсекается
равными владельцами раньше шага 7 — у такого слоя владелец это директория модуля. Поэтому
`undeclaredTargetLayer` с `'@unknown' in moduleLayers` достижим только из размеченного слоя своего
модуля (либо из его барреля), и в схеме без `@modules` он недостижим вовсе.

### Task 6: `pipeline.ts` — проверка одного импорта

**Files:**

- Create: `src/rules/no-illegal-layer-dependency/pipeline.ts`
- Create: `src/rules/no-illegal-layer-dependency/pipeline.test.ts`

- [x] написать тесты на `createChecker`: голый пакет и не-JS ресурс дают `null`, алиасный и
      относительный специфаер одной цели дают одинаковый вердикт, импорт барреля слоя (`@/common`) и
      барреля модуля (`@/modules/order`) не репортится, внутренний импорт даёт `null`, нарушение
      возвращает `messageId` и данные сообщения
- [x] реализовать `createChecker({ fromFile, aliases, schema })`: `layerOf(fromFile, 'file')`
      считается один раз на файл, `checkImport(specifier)` делает `parseSpecifier` →
      `layerOf(target, 'target')` → `decide`
- [x] run tests - must pass before task 7

➕ `createChecker` отдаёт не голую функцию (как у соседа), а `{ from, checkImport }`: слой
линтуемого файла нужен ещё и шагу 4 (репорт `undeclaredLayer` на `Program`, задача 7), а считать его
там второй раз значило бы опознавать один путь дважды.

➕ `{{target}}` подставляется всем сообщениям без разбора, а не только двум, которые его показывают:
какие сообщения его печатают, знает `meta.messages`, и повторять этот список в `pipeline.ts` значило
бы держать его в двух местах. Лишний ключ в `data` ESLint игнорирует.

### Task 7: Само правило

**Files:**

- Create: `src/rules/no-illegal-layer-dependency/index.ts`
- Create: `src/rules/no-illegal-layer-dependency/rule.test.ts`
- Create: `src/rules/no-illegal-layer-dependency/options.test.ts`

- [x] написать `rule.test.ts` на `createRuleTester` с фейковой ФС: valid-набор (features → entities,
      widgets → legacy, внутренний импорт, баррель слоя, баррель чужого модуля), invalid-набор на
      `illegalDependency` и `horizontalDependency` с проверкой `messageId` и данных
- [x] написать тесты на остальные три сообщения: `undeclaredLayer` репортится один раз на файл и
      импорты при этом не проверяются, `moduleInternals` на импорте во внутренности чужого модуля,
      `undeclaredTargetLayer` во всех трёх его формах (`'@unknown' in layers`,
      `'@unknown' in moduleLayers`, `'@modules' in layers`)
- [x] написать тесты на границы: `export ... from` не репортится, `import type` и `require()`
      репортятся, файл вне корня репозитория молчит, отсутствие `layers` — исключение на каждом
      файле, `layers: []` исключением не является
- [x] написать `options.test.ts` по образцу соседа: `options.layers`/`moduleLayers`/`moduleDir`
      перекрывают секцию, лишние ключи отвергаются схемой, общие опции (`repoRoot`, `aliases`)
      принимаются
- [x] реализовать правило: `createRule(fsHost?)` (шов для тестов), `meta` с пятью сообщениями и
      схемой из собственных и общих опций, `resolveWeldContext` → `hasLayers` → `getLayerSchema`,
      репорт на `Program`, обход через `createSpecifierVisitor`, `debug`-лог по образцу соседа
- [x] run tests - must pass before task 8

➕ совет «как объявить слой» нужен обоим концам импорта: цели его выдаёт `decide`, а самому
линтуемому файлу — правило (шаг 4 живёт вне вердикта). Поэтому формулировка вынесена в
экспортируемую `declareHint(layer)` в `core/verdict.ts` (файл добавлен к правкам задачи), а не
продублирована в `index.ts` второй копией тех же строк.

➕ собственных опций у правила три, но отдельный тип для них не заводится: `WeldOverrides` из
`src/settings/` объявляет все шесть настроек, и `resolveWeldContext` отдаёт `options` уже в нужной
форме. Правило объявляет схемные опции только в `meta.schema` (`SCHEMA_OPTION_PROPERTIES`) — именно
это и отличает его от соседа.

➕ в тестах правила схема дополнена слоем проекта `legacy` (между `common` и `@unknown`): пункт
«widgets → legacy» требует слоя проекта ниже диапазона модулей, а в схеме из Solution Overview такой
слой один — `common`, и он же используется как «баррель слоя». Остальные наборы (`strictSettings`,
`noModulesSettings`) — те же схемы, что в тестах вердикта.

### Task 8: Регистрация в плагине

**Files:**

- Modify: `src/rules/index.ts`
- Modify: `src/plugin.test.ts`

- [x] написать тест: правило присутствует в `rules`, и при этом **не** входит ни в
      `configs.recommended`, ни в `configs.strict` (инвариант про `meta.docs`/`meta.messages`
      применится к нему автоматически)
- [x] зарегистрировать `no-illegal-layer-dependency` в `src/rules/index.ts`
- [x] run tests - must pass before task 9

### Task 9: Документация правила и настроек

**Files:**

- Modify: `docs/rules/no-illegal-layer-dependency.md`
- Modify: `docs/settings.md`
- Modify: `README.md`

- [ ] переписать разделы «Схема слоёв» и «Слой файла»: развёртка в плоский список квалифицированных
      имён, `module` как публичный интерфейс модуля и `module:unknown`, две таблицы «путь → слой»
      (файл и цель), владелец вместо «модуля слоя»
- [ ] переписать раздел «Горизонтальные связи» (горизонталь — одноимённые слои разных владельцев) и
      пересчитать матрицу «Что разрешено» под развёртку с обрамляющими `module`
- [ ] пересобрать блоки Valid/Invalid: `entities/bar.ts` → `entities/foo/...` теперь разрешён,
      добавить примеры на импорт барреля слоя и модуля, на `moduleInternals` и на цель без слоя
- [ ] заменить таблицу сообщений: `unknownLayer`/`unknownTargetLayer` → пять актуальных id,
      проверить все ссылки на прежние id в разделе «Поведение в крайних случаях»
- [ ] обновить раздел «Опции правила» (три собственных плюс три общих) и «Подключение» (схема
      обязательна, `files` ограничивает область), снять плашку «правило ещё не реализовано»
- [ ] поправить `docs/settings.md`: `@unknown` в `moduleLayers` допустим, `@modules` там — ошибка,
      `moduleDir` и его валидация, снять плашку «настройки появятся вместе с правилом», дополнить
      раздел про опции правила тремя схемными
- [ ] проверить якоря: ссылки на `#поведение-в-краиних-случаях` и на разделы `settings.md` из обеих
      страниц (VitePress транслитерирует `й`→`и`)
- [ ] добавить правило в список правил `README.md` и поправить там абзац «Статус»
- [ ] `yarn docs:build` — сайт собирается, ссылки и якоря целы
- [ ] run tests - must pass before task 10

### Task 10: Verify acceptance criteria

- [ ] сверить реализацию со страницей правила по пунктам: определение слоя для файла и цели,
      внутренний импорт, горизонталь, `@unknown` на двух уровнях, пять сообщений, отсутствие
      автофикса
- [ ] проверить краевые случаи: файл вне корня репозитория, кривая схема, отсутствующая схема,
      `@modules` без `moduleLayers`, модуль без барреля, импорт `..` и `.`
- [ ] прогнать полный набор: `yarn verify`
- [ ] прогнать `yarn smoke` — регрессия сборки и подключения пакета (само правило скрипт не
      проверяет: оно вне пресетов)
- [ ] убедиться, что обе чистые функции покрыты таблицами, а правило — интеграционно

### Task 11: [Final] Update documentation

- [ ] обновить `CLAUDE.md`: новое правило в «Текущем состоянии», `src/settings/layers.ts` в описании
      слоя настроек, унифицированная форма геттеров `(settings, overrides)` и следствие для типа
      `WeldContext.options`, решение «опции схемы объявляет само правило»
- [ ] проверить, нужна ли правка `docs/core-concepts/` — у правила должен быть парный раздел в
      документации подхода (идея повторов-диапазонов описана только в `docs/drafts/layers.md`)
- [ ] переместить план в `docs/plans/completed/`; проверить, что перемещённый план не ломает
      `yarn docs:build` (директория попадает в собираемый сайт, как и `docs/drafts/`)

## Post-Completion

_Требует ручного действия или отдельного решения — без чекбоксов._

**Ручная проверка:**

- прогнать правило на реальном проекте со слоями и модулями: посмотреть на объём сообщений при
  первом включении (ожидается всплеск `undeclaredLayer`/`undeclaredTargetLayer` — это и есть
  разметка) и убедиться, что подсказки ведут к решению;
- проверить производительность на большом дереве: один `layerOf` на файл плюс один на импорт,
  компиляция схемы на каждый файл без кэша.

**Отдельные решения:**

- **smoke.** Скрипт собирает конфиг только из `configs.recommended`, поэтому новое правило в нём не
  участвует. Расширять ли `scripts/smoke-test.sh` (включить правило явно с минимальной схемой и
  файлом-нарушителем) — отдельное решение, не входит в этот план.
- **dogfooding.** Репозиторий живёт по правилам, которые проверяет плагин, но `settings.weld.layers`
  для самого себя не объявлен. Описывать ли слои `src/` (`path`/`extensions`/`debug` внизу,
  `host`/`settings`/`tsconfig` выше, `rules` сверху) и включать ли правило в `eslint.config.js` —
  отдельная задача.
- **релиз.** Версию проставляет workflow; правило вне пресетов, поэтому обновление плагина не меняет
  поведение существующих конфигов.
