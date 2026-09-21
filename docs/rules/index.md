# ESLint-плагин

`eslint-plugin-weld` проверяет правила подхода в CI и редакторе: договорённостями в команде границы
между модулями и направление зависимостей не удерживаются.

```sh
npm i -D eslint-plugin-weld
```

```js
// eslint.config.js
import weld from 'eslint-plugin-weld';

export default [
    weld.configs.recommended,
    {
        files: ['src/**'],
        settings: {
            weld: {
                layers: ['common', '@modules', 'pages', 'app'],
                moduleLayers: ['entities', 'features', 'widgets'],
            },
        },
    },
];
```

Плагин рассчитан на flat config ESLint 9+. Схема слоёв в примере не украшение: оба пресета включают
`no-illegal-layer-dependency`, а оно без `settings.weld.layers` роняет прогон — схему задаёт проект,
у плагина её быть не может.

## Правила

| правило                                                                | что проверяет                                                                | в пресетах              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------- |
| [`weld/no-barrel-bypass`](./no-barrel-bypass.md)                       | импорты внутрь модуля мимо его точки входа (`index.*`)                       | `recommended`, `strict` |
| [`weld/no-illegal-layer-dependency`](./no-illegal-layer-dependency.md) | импорты против порядка слоёв, объявленного проектом в `settings.weld.layers` | `recommended`, `strict` |

## Настройки

Корень репозитория, алиасы путей и схема слоёв задаются один раз на весь плагин — в секции
[`settings.weld`](../settings.md); там же описано, как перекрыть их опциями конкретного правила.
