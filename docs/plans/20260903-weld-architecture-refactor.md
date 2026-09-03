# Рефакторинг архитектуры eslint-plugin-weld под будущие правила

## Overview

Правило `no-barrel-bypass` растёт от MVP до полного ТЗ `strata-import-barrel`: приватные пути
(`privatePrefixes`), белый/чёрный список (`allow`/`deny`), алиасы из `tsconfig.json`, настоящий
резолвер вместо арифметики путей. Одновременно известны ещё три будущих правила: порядок слоёв,
строгая принадлежность файла слою, контроль реэкспортов барреля.

Этот план — **не** реализация перечисленных фич. Это чисто структурный рефакторинг: раскладка кода
меняется так, чтобы каждая будущая фича занимала уже подготовленное место, а общая для нескольких
правил инфраструктура (настройки, wildcard-паттерны) не была похоронена внутри `no-barrel-bypass`.
Публичное поведение правила на существующих тестах не меняется ни в одной задаче.

Итоговая раскладка:

```
src/settings/
  weld.ts            — getWeldSettings() + createWeldSettings() фасад
  aliases.ts          — нормализация aliases (как сейчас, переразложено под фасад)
src/env/
  entry-point.ts       — как сейчас
  tsconfig.ts           — заготовка (сигнатура + зависимость get-tsconfig), не подключена
src/rules/no-barrel-bypass/
  core/
    barrier.ts           — как сейчас, перенесено
    specifier.ts           — как сейчас, перенесено
    verdict.ts              — новый Verdict-тип
  pipeline.ts                — бывший check.ts, возвращает Verdict вместо string|null
  index.ts                    — маппинг Verdict → messageId/data/fix, чтение алиасов через фасад
```

Задачи упорядочены так, чтобы после каждой из них дерево компилировалось и весь набор тестов
проходил — то есть перенос файла и правка всех его потребителей (импортов) всегда лежат в одной
задаче, а не растянуты на несколько.

## Context (from discovery)

- Текущая реализация `no-barrel-bypass` уже содержит рабочую версию арифметики границ
  (`barrier.ts`), разбора/рендера специфаера (`specifier.ts`) и алиасов из `settings.weld.aliases`
  (`src/settings/aliases.ts`) — целиком чистые функции, без резолвера.
- `check.ts` — единственная точка склейки: `parseSpecifier → findBarrier → renderSpecifier`,
  возвращает `string | null`. Тип `CheckEnv` (`{ hasEntryPoint }`) объявлен здесь же и
  переиспользуется в `src/env/entry-point.ts` и трёх тестовых файлах.
- Тесты лежат рядом с кодом (`*.test.ts`), не в отдельной `tests/`, — так уже сложилось в
  репозитории сейчас (актуальнее записи в завершённом плане `20260902-no-barrel-bypass.md`, там ещё
  `tests/`).
- `package.json`: рантайм-зависимостей нет вообще; `get-tsconfig` в `node_modules` отсутствует.
- Известные будущие потребители общей инфраструктуры: правило про порядок слоёв и правило про
  строгую принадлежность слою (оба используют классификацию пути по wildcard-паттернам), правило
  контроля реэкспортов. Ни у одного пока нет отдельного ТЗ.

## Развилки, решённые в брейнсторме

- Имя правила остаётся `no-barrel-bypass`, `strata-import-barrel` — не отдельное правило.
- `settings.weld` будет расти (`aliases`, `layouts`/`moduleLayouts`, `moduleDir`, `privatePrefix`),
  с возможностью переопределения полей на уровне опций конкретного правила. В этом плане **строится
  только общий механизм** (`weld.ts`) и единственное реальное поле (`aliases`) — файлы под ещё не
  специфицированные поля не создаются.
- `src/matching/` (wildcard-паттерны, списки путей) и `core/private.ts` (приватные пути) — не
  создаются в этом плане. Они появятся вместе с реализацией `allow`/`deny`/`privatePrefixes`.
- `env/resolver.ts` — не создаётся вообще, даже заготовкой: реальный резолвер пока не нужен ни для
  одной известной задачи.
- `env/tsconfig.ts` создаётся заготовкой (сигнатура + зависимость `get-tsconfig` в `package.json`),
  но не подключается к правилу — источник алиасов остаётся прежним (`settings.weld.aliases`).

## Development Approach

- **testing approach**: Regular — сначала переносим/переразлагаем код, тесты переносятся и
  адаптируются вместе с ним (не пишутся заново с нуля, это механический перенос).
- каждая задача выполняется полностью, включая прогон тестов, до перехода к следующей
- **CRITICAL: каждая задача обязана содержать актуальные тесты** — либо перенесённые с обновлёнными
  путями импорта, либо новые для нового кода (например, `weld.ts`)
- **CRITICAL: все тесты проходят (`yarn test`) до начала следующей задачи**
- **CRITICAL: план обновляется по ходу, если объём меняется**
- публичное поведение (`meta.messages`, тексты, `messageId`, автофикс) не меняется — рефакторинг
  внутренний
- комментарии — только там, где неочевидна причина решения (как принято в CLAUDE.md репозитория)

## Testing Strategy

- unit-тесты — обязательны для каждого перенесённого/нового файла с поведением, рядом с файлом
  (`*.test.ts`). Исключения, осознанные и перечисленные явно: `core/verdict.ts` (только тип, тестов
  не требует) и `env/tsconfig.ts` (неподключённая заготовка, тело — `throw`, тестировать нечего до
  реализации фичи)
- `rule.test.ts` и `integration.test.ts` не переезжают (тестируют публичное поведение правила
  целиком), но их импорты (`CheckEnv`, `checkImport`) обновляются под новые пути
- `yarn verify` — финальная проверка (lint, prettier, типы, тесты, сборка)

## Progress Tracking

- отмечать выполненное `[x]` сразу
- новые задачи — с префиксом ➕
- проблемы/блокеры — с префиксом ⚠️
- план обновляется по ходу

## What Goes Where

- **Implementation Steps** — код, тесты, документация, полностью выполнимые в этом репозитории.
- **Post-Completion** — ничего, изменения не затрагивают внешние системы или потребителей пакета
  (публичный `exports`/API плагина не меняется).

## Implementation Steps

### Task 1: `src/settings/weld.ts` — общий доступ к `settings.weld` и фасад

Без generic-хелпера на несколько полей — он оправдан только вторым реальным полем, а пока в
`settings.weld` реально используется одно (`aliases`). `resolveWeldField<T>` и параметр `override` у
`getAliases` **не строим** сейчас: это добавляло бы код без потребителя (`meta.schema` правила не
даёт способа передать override) и без тестируемого поведения. Когда появится второе поле или
реальный оverride, эта общая часть выделяется отдельным PR — «паттерн по одной реализации ещё не
паттерн» (CLAUDE.md).

**Files:**

- Create: `src/settings/weld.ts`
- Create: `src/settings/weld.test.ts`
- Modify: `src/settings/aliases.ts`
- Modify: `src/settings/aliases.test.ts`
- Modify: `src/rules/no-barrel-bypass/index.ts`

- [x] в `weld.ts` вынести `getWeldSettings(settings: unknown): Record<string, unknown> | undefined`
      (сейчас приватная функция в `aliases.ts`, логика без изменений — объект/не объект/`null`)
- [x] в `aliases.ts` экспортировать
      `parseAliases(weld: Record<string, unknown>, cwd: string): Alias[]` (сейчас приватная),
      сигнатура и логика не меняются
- [x] в `weld.ts` добавить `WeldSettings` тип и `createWeldSettings(settings, cwd): WeldSettings` с
      единственным методом `getAliases(): Alias[]` — тело инлайнит сегодняшнюю логику `readAliases`
      (кэш по `WeakMap<object, Alias[]>` на объект `weld`, обращение к `getWeldSettings` +
      `parseAliases`), без параметра `override`
- [x] удалить из `aliases.ts` функции `readAliases`, `getWeldSettings` и локальный `WeakMap`-кэш —
      их логика переехала в `weld.ts` (`aliases.ts` после этого содержит только чистую нормализацию:
      `parseAliases` и её приватные помощники)
- [x] обновить `src/rules/no-barrel-bypass/index.ts`: заменить импорт `readAliases` и вызов
      `readAliases(context.settings, context.cwd)` на `createWeldSettings` и
      `createWeldSettings(context.settings, context.cwd).getAliases()`
- [x] в `aliases.test.ts` разбить существующие `describe`-блоки: тесты `readAliases` — «отсутствие
      settings.weld», «исключения валидации», «WeakMap-кэш» — переносятся в `weld.test.ts` и
      переписываются на `createWeldSettings(...).getAliases()`; тесты таблиц нормализации
      (`parseAliases`/`normalizeAnchor`/`hasValidStarShape` и т.п.) остаются в `aliases.test.ts` и
      вызывают экспортированный `parseAliases` напрямую
- [x] прогнать `yarn test` — весь набор проходит без изменений публичного поведения (кроме
      `tests/plugin.test.ts`, где 1 тест падает уже на исходном HEAD этой ветки — не связан с данной
      задачей, см. коммит `b031701`)

### Task 2: `src/env/tsconfig.ts` — заготовка под чтение алиасов из tsconfig.json

**Files:**

- Create: `src/env/tsconfig.ts`
- Modify: `package.json`

- [x] добавить `get-tsconfig` в `devDependencies` (`package.json`), прогнать установку зависимостей
      — пометить коротким комментарием рядом с записью (или в этом пункте плана), что при
      подключении `tsconfig.ts` к сборке (когда фича перестанет быть заготовкой и станет частью
      `dist/`) зависимость нужно переносить в `dependencies`: сейчас пакет собирается без bundling
      рантайм-зависимостей (`tsup` не задаёт `noExternal`), и devDependency в такой конфигурации у
      потребителей пакета просто не установится. `package.json` — JSON, комментарий рядом с записью
      невозможен: заметка про перенос в `dependencies` зафиксирована в шапке `src/env/tsconfig.ts` и
      здесь, в плане
- [x] в `env/tsconfig.ts` объявить сигнатуру будущей функции чтения алиасов из `tsconfig.json`
      (например `export function readTsconfigAliases(fromFile: string): Alias[] | null`), тело —
      явный `throw new Error('not implemented')` или аналогичная заглушка с комментарием, что
      реализация и тесты появятся вместе с фичей auto-discovery алиасов (раздел 5.1 ТЗ
      `strata-import-barrel`)
- [x] файл **не подключается** ни к одному правилу — только компилируется и типизируется
- [x] прогнать `yarn typecheck` и `yarn lint` — новый файл проходит проверки при том, что не
      используется нигде (убедиться, что линт не ругается на неиспользуемый экспорт — это ожидаемо
      для публичного модуля, не для локальной переменной)

### Task 3: `src/rules/no-barrel-bypass/core/` — перенос чистой арифметики

**Files:**

- Create: `src/rules/no-barrel-bypass/core/barrier.ts` (из `barrier.ts`)
- Create: `src/rules/no-barrel-bypass/core/barrier.test.ts` (из `barrier.test.ts`)
- Create: `src/rules/no-barrel-bypass/core/specifier.ts` (из `specifier.ts`)
- Create: `src/rules/no-barrel-bypass/core/specifier.test.ts` (из `specifier.test.ts`)
- Create: `src/rules/no-barrel-bypass/core/verdict.ts`
- Modify: `src/rules/no-barrel-bypass/check.ts` (только импорты, до переименования в Task 4)
- Delete: `src/rules/no-barrel-bypass/barrier.ts`, `barrier.test.ts`, `specifier.ts`,
  `specifier.test.ts`

- [ ] перенести `barrier.ts`/`barrier.test.ts` в `core/` без изменения логики, поправить
      относительные импорты (`../../path/posix.js` → `../../../path/posix.js`)
- [ ] перенести `specifier.ts`/`specifier.test.ts` в `core/` аналогично, поправить импорты
      (`../../entry-extensions.js`, `../../path/posix.js`, `../../settings/aliases.js`)
- [ ] обновить `check.ts`: импорты `./barrier.js`/`./specifier.js` → `./core/barrier.js`/
      `./core/specifier.js` (это единственная правка в файле в этой задаче — `check.ts` остаётся
      рабочим и не переименован, переименование и смена сигнатуры — в Task 4)
- [ ] создать `core/verdict.ts` с типом
      `export type Verdict = { kind: 'ok' } | { kind: 'crossesBarrier'; suggestion: string }` — без
      поля `boundary`: сегодняшний `check.ts` уже осознанно не отдаёт границу наружу («Найденная
      граница наружу не отдаётся: она нужна только для рендера исправленного пути»), Verdict эту
      инвариант сохраняет. Файл только с типом — потребителя (`pipeline.ts`) у него пока нет,
      добавляется в Task 4
- [ ] прогнать `yarn test` — весь набор (включая ещё не переименованный `check.ts`) проходит без
      изменений поведения

### Task 4: `pipeline.ts` — `check.ts` на `Verdict`, обновление всех потребителей

Переименование файла, смена возвращаемого типа `checkImport` и правка всех точек, которые на него
завязаны, — одна задача, чтобы после неё дерево снова полностью собиралось и тестировалось.

**Files:**

- Create: `src/rules/no-barrel-bypass/pipeline.ts` (из `check.ts`)
- Create: `src/rules/no-barrel-bypass/pipeline.test.ts` (из `check.test.ts`)
- Delete: `src/rules/no-barrel-bypass/check.ts`, `check.test.ts`
- Modify: `src/env/entry-point.ts`
- Modify: `src/rules/no-barrel-bypass/index.ts`
- Modify: `src/rules/no-barrel-bypass/rule.test.ts`

- [ ] переименовать `check.ts` → `pipeline.ts`; имя функции `checkImport` сохраняется, но
      возвращаемый тип меняется с `string | null` на `Verdict` (импортированный из
      `./core/verdict.js`): `target === null` или `barrier === null` → `{ kind: 'ok' }`, иначе
      `{ kind: 'crossesBarrier', suggestion: renderSpecifier(...) }` — сама логика поиска границы и
      рендера не меняется, меняется только форма возвращаемого значения
- [ ] обновить `check.test.ts` → `pipeline.test.ts`: проверки на `checkImport(...)` теперь сверяют
      объект `Verdict`, а не строку/`null`
- [ ] обновить `src/env/entry-point.ts`: импорт типа `CheckEnv` теперь из `./pipeline.js`
      (`../rules/no-barrel-bypass/pipeline.js`)
- [ ] обновить `src/rules/no-barrel-bypass/index.ts`: импорт `CheckEnv`/`checkImport` — из
      `./pipeline.js`; заменить прямую сборку `context.report` на разбор `Verdict`:
      `switch (verdict.kind) { case 'ok': return; case 'crossesBarrier': /* сегодняшняя логика report     с messageId 'bypass'/'useBarrel', data, fix/suggest — дословно как сейчас */ }`
- [ ] обновить `rule.test.ts`: путь импорта `CheckEnv` → `./pipeline.js`; тестовые ожидания
      (`messageId`, `data`, `suggestions`) не меняются — это подтверждает, что видимое поведение
      правила не изменилось
- [ ] проверить `integration.test.ts` — он не импортирует `check.js`/`pipeline.js` напрямую (только
      `./index.js`), поэтому изменений не требует; прогоном тестов подтвердить, что он всё равно
      проходит
- [ ] прогнать `yarn test` — весь набор, включая `rule.test.ts` и `integration.test.ts`, проходит
      без изменений ожиданий

### Task 5: Проверка соответствия документации

**Files:**

- Modify: `docs/rules/no-barrel-bypass.md` (если потребуется)
- Modify: `CLAUDE.md` (если потребуется)

- [ ] сверить раздел «Алгоритм» в `docs/rules/no-barrel-bypass.md` с новой раскладкой файлов — если
      там упоминаются конкретные имена файлов/путей (а не только имена функций), актуализировать
- [ ] проверить, что раздел `settings.weld` документации не противоречит новому `weld.ts`-фасаду
      (поведение чтения алиасов не изменилось, значит текст должен остаться верным как есть)
- [ ] проверить раздел CLAUDE.md «Добавление правила» — он описывает раскладку `src/settings/` и
      `src/env/`; при необходимости добавить упоминание `core/`/`pipeline.ts` внутри `rules/<имя>/`
      как сложившегося (для `no-barrel-bypass`) варианта раскладки правила с несколькими проверками
- [ ] если правок не потребовалось — явно зафиксировать это в плане (не оставлять пункт неотмеченным
      без причины)

### Task 6: Итоговая проверка

- [ ] закоммитить изменения (pre-commit хук прогонит `prettier --write`/`eslint --fix` по
      застейдженным файлам, включая этот файл плана — см. CLAUDE.md, вручную форматтеры не
      запускать)
- [ ] `yarn verify` (lint, prettier --check, typecheck, test, build) проходит полностью
- [ ] `yarn smoke` — собранный тарбол ставится во временный проект и ESLint отрабатывает
- [ ] проверить `git status` — не осталось файлов по старым путям (`barrier.ts`, `specifier.ts`,
      `check.ts` и их тестов в корне `no-barrel-bypass/`)
- [ ] убедиться, что `src/matching/`, `core/private.ts`, `env/resolver.ts` **не созданы** — это
      сознательная граница объёма этого плана
- [ ] переместить этот план в `docs/plans/completed/`

## Post-Completion

Нет пунктов, требующих действий вне репозитория — публичный API пакета (`exports`,
`configs.recommended`) не менялся, потребителей плагина обновлять не нужно.
