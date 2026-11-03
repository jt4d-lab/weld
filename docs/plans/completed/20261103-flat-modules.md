# Плоские корневые модули: опция `flatModules`

## Цель

Добавить в схему слоев опцию `flatModules` (`boolean`, по умолчанию `false`). При `true` корневые
модули живут прямо в `srcDir`, а не в контейнере `modulesDir`; вложенные модули внутри модулей
находятся по-прежнему через контейнер.

Примеры при `layers: ['app', '@modules', 'common']`, `moduleLayers: ['entities']`, flat=true:

- `src/app/file.ts` → `@root / app` (без изменений: слой побеждает);
- `src/common/file.ts` → `@root / common` (без изменений);
- `src/modules/x/file.ts` → `@root / @unknown` (контейнер в корне не признается);
- `src/auth/entities/file.ts` → `auth / entities` (корневой модуль прямо в `srcDir`).

Вложенный режим (дефолт) не меняется поведением: при `flat=false` `locateFile` отдает те же
результаты. Существующие тесты проходят после механического добавления `flatModules: false` в
литералы `Scheme` и полные `toEqual`-ожидания (обязательное поле схемы их ломает).

Обязательное поле в `Scheme` механически обновляет: типизированный литерал `const scheme: Scheme` в
`src/layers/locate.test.ts` и полные `toEqual`-ожидания схемы в `src/settings/layers.test.ts`,
`src/settings/weld.test.ts`, `src/config/resolve.test.ts`, `src/rules/context.test.ts`.

## Контекст

- `src/settings/layers.ts` — `Scheme`, `SchemeField`, `SCHEME_FIELDS`, `parseScheme`,
  `parseSchemeReport`; дефолты `srcDir`/`modulesDir` подставляет вызывающий (`weld.ts`).
- `src/settings/weld.ts` — `getScheme` (кэш с ключом по `SCHEME_FIELDS`), `getSchemeRaw`,
  `readScheme`.
- `src/layers/locate.ts` — `descendModules` спускается по контейнеру `modulesDir` на каждом уровне;
  `layerOf` определяет слой по первому сегменту.
- `src/rules/context.ts` — `WELD_OPTION_PROPERTIES`: четыре разрешительных поля схемы.
- `src/config/report.ts` — `schemeStates` собирает сырой объект схемы явно по четырём полям; дальше
  все обходы идут по `SCHEME_FIELDS`.
- `src/cli/config.ts` — `CONFIG_SETTING_NAMES`: единственный список полей отчета в порядке печати.
- `src/cli/render.ts` — `settingValueText` знает только списочные и строковые поля.
- Документация: `docs/rules/settings.md` (раздел «Схема»), `docs/mechanics/layers.md` (семантика
  схемы).
- Рантайм-сообщения — на английском; форматирование делает pre-commit хук.

## Решение

### Поле в схеме

`flatModules` — пятое поле `Scheme` (`boolean`, дефолт `false`), на равных с `srcDir`/`modulesDir`,
которые тоже несут дефолты. Поле добавляется в конец — в конец `Scheme`, `SCHEME_FIELDS` и
`CONFIG_SETTING_NAMES`: порядок объекта, списков и печати остается одним.

- `parseScheme`: поле разбирается после `moduleLayers`, до совместных проверок (при двух сломанных
  полях текст ошибки зависит от порядка); обязателен `boolean`, иначе ошибка
  `flatModules must be a boolean, got <typeof>` с источником поля (`settings.weld.flatModules` /
  `options.flatModules`). Совместные проверки (`@modules`, общие имена) на поле не влияют.
- `parseSchemeReport`: состояние поля — `value` / `invalid`; `not set` не бывает, дефолт `false`
  подставляется в `getSchemeRaw`, как у `srcDir`; нечитабельная секция без override дает
  промежуточный `invalid` ("got undefined"), который `schemeStates` в `src/config/report.ts`
  перезаписывает на `unresolved: settings.weld`, как у остальных полей.
- `SchemeReport` получает `flatModules: SettingState<boolean>` наряду с остальными полями.
- `readScheme` и `getSchemeRaw` в `weld.ts`: `flatModules: pick('flatModules', false)`; типы
  `fallback` у `pick` и `pickSchemeValue` расширяются с `string` до `string | boolean`.
- `WELD_OPTION_PROPERTIES`: пятое разрешительное свойство `flatModules: {}` — ESLint пропускает его
  в любом виде, проверяет WELD при запросе схемы; опция правила перекрывает
  `settings.weld.flatModules` целиком, как четыре других поля.
- `@modules` в flat-режиме остается обязательным: метка задает вертикальную позицию модулей в схеме
  для будущих правил направления.

### Спуск по модулям

Меняются `descendModules` в `src/layers/locate.ts`. В flat-режиме контейнер `modulesDir` не
признается в корне — ни плоским `if`, ни циклом:

```text
if flat:
    # Контейнер в корне не распознается. Первый сегмент — корневой модуль,
    # только если это директория (ниже есть что-то), не имя слоя и не modulesDir.
    if inner.length >= 2 and inner[0] ∉ scheme.layers and inner[0] !== scheme.modulesDir:
        module.push(inner[0]); root = srcDir/inner[0]; index = 1

while (!flat || module.length > 0)
       and inner[index] === scheme.modulesDir and index + 2 < inner.length:
    module.push(inner[index + 1]); root = root/modulesDir/inner[index + 1]; index += 2
    # Вложенные модули через контейнер, на любой глубине; в flat-режиме корневой
    # контейнер цикл не поглощает (иначе src/modules/x стал бы модулем x).
```

В non-flat режиме условие `!flat || …` истинно всегда — цикл идентичен текущему.

Дальше, как сейчас: слой — первый сегмент `rest` по `layers` (корневой модуль) или `moduleLayers`
(внутри модуля); `innerPath` — от корня слоя, при `@unknown` — от корня модуля.

Примеры при `layers: ['app', '@modules', 'common']`, `moduleLayers: ['entities']`, flat=true:

| путь                                    | модуль      | слой       | innerPath           |
| --------------------------------------- | ----------- | ---------- | ------------------- |
| `src/app/file.ts`                       | `@root`     | `app`      | `file.ts`           |
| `src/common/file.ts`                    | `@root`     | `common`   | `file.ts`           |
| `src/modules/x/file.ts`                 | `@root`     | `@unknown` | `modules/x/file.ts` |
| `src/auth/entities/file.ts`             | `auth`      | `entities` | `file.ts`           |
| `src/auth/modules/bar/entities/file.ts` | `auth::bar` | `entities` | `file.ts`           |
| `src/file.ts`                           | `@root`     | `@unknown` | `file.ts`           |
| `src/auth/file.ts`                      | `auth`      | `@unknown` | `file.ts`           |

Граничные случаи:

- Имя из `layers` в корне всегда побеждает модуль: `src/app` — слой. Метки `@modules`/`@unknown` не
  могут совпасть с реальным именем директории — `@` в имени уже исключение.
- Модуль может называться как слой модулей (`src/entities/file.ts` → модуль `entities`) — так же,
  как сегодня `src/modules/entities` может быть модулем при `entities` в `moduleLayers`.
- `src/modules/…` в flat-режиме целиком `@unknown`: поддерево не скрывается, файлы в нем линтятся и
  получают метаданные.

### Отчет и вывод

- `schemeStates` в `src/config/report.ts`: в литерале сырого объекта появляется пятое поле
  `flatModules: undefined` (тип `RawScheme` укажет на забытое поле); остальное строится по
  `SCHEME_FIELDS`; `ConfigReport.settings` получает `flatModules: SettingState<boolean>`.
- `CONFIG_SETTING_NAMES` в `src/cli/config.ts`: поле добавляется в конец списка.
- `settingValueText` в `src/cli/render.ts`: булево поле печатает `true`/`false` в состоянии `value`,
  маркеры остальных состояний — как у строковых.
- `weld inspect` кода не требует: печатает результат `locateFile`.

## Задачи

### Задача 1: поле `flatModules` в `src/settings/`

**Файлы:**

- Изменить: `src/settings/layers.ts`, `src/settings/weld.ts`
- Изменить: `src/settings/layers.test.ts`, `src/settings/weld.test.ts`, `src/config/resolve.test.ts`

- [x] Добавить `flatModules: boolean` в `Scheme`; дописать в конец `SCHEME_FIELDS` и в
      `SchemeReport` (`SettingState<boolean>`).
- [x] `parseScheme`: разобрать `flatModules` после `moduleLayers`, до совместных проверок;
      обязателен `boolean`, ошибка с источником поля.
- [x] `parseSchemeReport`: состояние поля (`value` / `invalid`).
- [x] `readScheme` и `getSchemeRaw`: `flatModules: pick('flatModules', false)`; расширить тип
      `fallback` у `pick`/`pickSchemeValue` до `string | boolean`.
- [x] Тесты в `layers.test.ts`: `true`/`false`, не-`boolean` (тексты ошибок
      `settings.weld.flatModules` и `options.flatModules`), независимость от ошибок списков.
- [x] Тесты в `weld.test.ts`: дефолт `false`, перекрытие опцией правила, кэш (разное значение —
      разные результаты, одинаковое — тот же объект).
- [x] Механически дописать `flatModules: false` в полные `toEqual`-ожидания схемы:
      `src/settings/layers.test.ts`, `src/settings/weld.test.ts`, `src/config/resolve.test.ts`.
- [x] Запустить `yarn test`; до следующей задачи все тесты проходят.

### Задача 2: плоский спуск в `src/layers/locate.ts`

**Файлы:**

- Изменить: `src/layers/locate.ts`, `src/layers/locate.test.ts`

- [x] `descendModules`: в flat-режиме контейнер `modulesDir` не признается в корне — ни плоским
      `if`, ни циклом (условие `(!flat || module.length > 0) && …`).
- [x] Спуск по вложенным контейнерам внутри модулей на любой глубине не менять.
- [x] Тесты: таблица примеров выше (flat=true) и те же пути при flat=false (модули через контейнер,
      `src/modules/x` → `x`).
- [x] Тесты граничных случаев: файл прямо в `srcDir`, файл в корне модуля, модуль с именем слоя
      модулей, поддерево `src/modules/…` как `@unknown`, файл прямо в корневом контейнере в
      flat-режиме (`src/modules/file.ts`), собственный `modulesDir` (например `mods`) в flat-режиме.
- [x] Механически дописать `flatModules: false` в типизированный литерал `const scheme: Scheme` в
      `src/layers/locate.test.ts`.
- [x] Запустить `yarn test`; до следующей задачи все тесты проходят.

### Задача 3: опция правила и отчет `weld config`

**Файлы:**

- Изменить: `src/rules/context.ts`, `src/rules/context.test.ts`
- Изменить: `src/config/report.ts`, `src/config/report.test.ts`
- Изменить: `src/cli/config.ts`, `src/cli/render.ts`, `src/cli/config.test.ts`,
  `src/cli/render.test.ts`

- [x] `WELD_OPTION_PROPERTIES`: пятое разрешительное свойство `flatModules: {}`; обновить тест
      `toEqual` и дописать `flatModules: false` в полное `toEqual`-ожидание схемы в
      `src/rules/context.test.ts`.
- [x] `schemeStates`: пятое поле в сыром объекте; `ConfigReport.settings` —
      `flatModules:     SettingState<boolean>`; тесты отчета — дефолт, перекрытие опцией, `invalid`,
      `unresolved` при невалидной секции.
- [x] `CONFIG_SETTING_NAMES`: добавить `flatModules` в конец.
- [x] `settingValueText`: печать булева поля (`true`/`false` + маркеры состояний).
- [x] Дописать строку `flatModules: false` во все полнотекстовые ожидания `src/cli/config.test.ts` и
      `src/cli/render.test.ts` (ширина колонки подписей не меняется: `aliasesBaseUrl:` длиннее);
      добавить новые тесты на строку в текстовом и JSON-выводе, код 1 при `invalid`, код 0 при
      `value`.
- [x] Запустить `yarn test`; до следующей задачи все тесты проходят.

### Задача 4: документация и приемка

**Файлы:**

- Изменить: `docs/rules/settings.md`, `docs/mechanics/layers.md`
- Изменить при необходимости: `docs/cli/inspect.md`, `docs/cli/config.md`, `README.md`

- [x] `docs/rules/settings.md`: раздел `flatModules` после `moduleLayers` (формат, дефолт, что
      меняется) и строка в примере конфига в шапке; дописать поле в список опций правил; «четыре
      поля схемы» в разделе опций правил — «пять».
- [x] `docs/mechanics/layers.md`: раздел о плоской схеме — корневые модули в `srcDir`, судьба
      контейнера в корне, пример дерева для обоих режимов.
- [x] `docs/cli/config.md`: секция `### flatModules` рядом с полями схемы (дефолт `false`,
      состояния; `(not set)` не бывает) и `"flatModules": false` в JSON-примерах; в
      `docs/cli/inspect.md` — описание `module` как «файл не попал ни в один модуль» верно только
      для дефолтного режима, добавить flat-вариант; в README и JSDoc `src/settings/index.ts`
      («четыре ее поля») проверить упоминания полей схемы.
- [x] Не добавлять новые кросс-ссылки между статьями.
- [x] Запустить `yarn verify`.
- [x] Сверить реализацию с решениями этого плана и отметить выполненные пункты.

## Критерии приемки

- [x] При `flatModules` не задан или `false` поведение `locateFile` не меняется; существующие тесты
      проходят после добавления `flatModules: false` в литералы `Scheme` и полные
      `toEqual`-ожидания.
- [x] При flat=true `src/modules/x/file.ts` → `@root/@unknown` с `innerPath` `modules/x/file.ts`:
      цикл спуска не поглощает корневой контейнер.
- [x] Примеры из заявки при `layers: ['app', '@modules', 'common']`, flat=true: `src/app/file.ts` →
      `@root/app`, `src/common/file.ts` → `@root/common`, `src/modules/x/file.ts` →
      `@root/@unknown`, `src/auth/entities/file.ts` → `auth/entities`.
- [x] Вложенные модули в flat-режиме находятся через контейнер: `src/auth/modules/bar` →
      `auth::bar`.
- [x] Имя из `layers` в корне побеждает модуль; модуль может называться как слой модулей.
- [x] `flatModules` присутствует в схеме, в опциях правил и в отчете `weld config` (текст и JSON);
      текст ошибки — на английском.
- [x] `yarn verify` проходит.
