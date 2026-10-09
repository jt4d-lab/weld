# Слои модулей

Модуль может быть слоеным или безслойным.

## Слоеный модуль

Слоеный модуль публикует все точки входа, расположенные непосредственно в его корневой директории,
если они не помечены приватными соглашениями. Один модуль может иметь несколько точек входа:

```text
/modules/auth/interceptors
/modules/auth/entities
/modules/auth/widgets
/modules/auth/providers
```

Точка входа относится к слою, если её имя совпадает с именем из `moduleLayers`. Например, при
настройке:

```js
moduleLayers: ['entities', 'widgets'];
```

`/modules/auth/entities` относится к слою `entities`, а `/modules/auth/widgets` — к слою `widgets`.

Слои сохраняют порядок из `moduleLayers`: `widgets` может импортировать `entities`, а `entities` не
может импортировать `widgets`.

Точки входа, чьи имена отсутствуют в `moduleLayers`, относятся к `@unknown`. В примере это
`/modules/auth/interceptors` и `/modules/auth/providers`.

Для других модулей точки входа обрабатываются в следующем порядке:

```text
@unknown, entities, widgets
```

Внутри собственного модуля используется порядок:

```text
@unknown, entities, widgets, @unknown
```

Первый `@unknown` обозначает точки входа других модулей, а последний — неизвестные точки входа
текущего модуля.

## Безслойный модуль

Безслойный модуль публикует API через корневой баррель:

```text
/modules/auth/index.ts
```

Безслойный модуль трактуется как `@unknown`.
