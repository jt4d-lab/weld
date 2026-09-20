import { describe, expect, it } from 'vitest';

import type { LayerLocation } from '@/rules/no-illegal-layer-dependency/core/layer-of.js';
import { decide, sourceRights } from '@/rules/no-illegal-layer-dependency/core/verdict.js';
import type { Qualified } from '@/settings/index.js';
import { getLayerSchema } from '@/settings/index.js';

/**
 * Схема из плана. Развёрнутый порядок:
 * `root:common`, `root:unknown`, `module`, `module:entities`, `module:features`, `module:widgets`,
 * `module`, `root:pages`, `root:app`.
 */
const schema = getLayerSchema({
    weld: {
        layers: ['common', '@unknown', '@modules', 'pages', 'app'],
        moduleLayers: ['entities', 'features', 'widgets'],
    },
});

/** Место в дереве: слой плюс владелец и модуль, которые `decide` сравнивает на равенство. */
function at(
    layer: Qualified,
    owner: string | null,
    moduleRoot: string | null = null,
): LayerLocation {
    return { layer, owner, moduleRoot };
}

const ORDERED: Qualified[] = [
    'root:common',
    'root:unknown',
    'module',
    'module:entities',
    'module:features',
    'module:widgets',
    'root:pages',
    'root:app',
];

/**
 * Матрица прав, посчитанная по правилу `first(to) < last(from)` и выписанная руками: таблица должна
 * ловить ошибку в самом правиле, а не повторять его.
 */
const ALLOWED: Record<Qualified, Qualified[]> = {
    // Нижний слой не импортирует ничего, даже соседний файл вне своей директории.
    'root:common': [],
    'root:unknown': ['root:common'],
    // Модуль как целое — диапазон, обрамляющий слои модуля: вниз до `common` и во все слои модулей,
    // включая другой такой же модуль; до `pages`/`app` не достаёт.
    module: [
        'root:common',
        'root:unknown',
        'module',
        'module:entities',
        'module:features',
        'module:widgets',
    ],
    'module:entities': ['root:common', 'root:unknown', 'module'],
    'module:features': ['root:common', 'root:unknown', 'module', 'module:entities'],
    'module:widgets': [
        'root:common',
        'root:unknown',
        'module',
        'module:entities',
        'module:features',
    ],
    'root:pages': [
        'root:common',
        'root:unknown',
        'module',
        'module:entities',
        'module:features',
        'module:widgets',
    ],
    'root:app': [
        'root:common',
        'root:unknown',
        'module',
        'module:entities',
        'module:features',
        'module:widgets',
        'root:pages',
    ],
};

describe('decide — матрица прав', () => {
    describe.each(ORDERED)('источник %s', (from) => {
        it.each(ORDERED)('→ %s', (to) => {
            const verdict = decide(schema, at(from, '/from'), at(to, '/to'));

            expect(verdict.ok).toBe((ALLOWED[from] as Qualified[]).includes(to));
        });
    });

    it('разрешённый импорт — единственный вид ответа без сообщения', () => {
        expect(
            decide(schema, at('root:app', '/src/app'), at('root:common', '/src/common')),
        ).toEqual({ ok: true });
    });

    it('нарушение называет оба слоя простыми именами', () => {
        expect(
            decide(schema, at('root:common', '/src/common'), at('root:app', '/src/app')),
        ).toEqual({
            ok: false,
            messageId: 'illegalDependency',
            data: { fromLayer: 'common', toLayer: 'app' },
        });
    });

    it('слой модуля в сообщении тоже называется просто', () => {
        expect(
            decide(
                schema,
                at('module:entities', '/src/modules/order/entities'),
                at('module:widgets', '/src/modules/order/widgets'),
            ),
        ).toEqual({
            ok: false,
            messageId: 'illegalDependency',
            data: { fromLayer: 'entities', toLayer: 'widgets' },
        });
    });

    it('неразмеченный код вне модулей называется @unknown', () => {
        expect(decide(schema, at('root:unknown', null), at('root:app', '/src/app'))).toEqual({
            ok: false,
            messageId: 'illegalDependency',
            data: { fromLayer: '@unknown', toLayer: 'app' },
        });
    });
});

describe('decide — пропуски', () => {
    it('равные владельцы — внутренний импорт слоя', () => {
        // `…/entities/bar.ts` → `…/entities/foo/user.ts`: одна директория слоя, её внутреннее дело.
        const owner = '/src/modules/order/entities';

        expect(decide(schema, at('module:entities', owner), at('module:entities', owner))).toEqual({
            ok: true,
        });
    });

    it('равные владельцы у слоя проекта — тоже внутренний импорт', () => {
        expect(
            decide(schema, at('root:common', '/src/common'), at('root:common', '/src/common')),
        ).toEqual({ ok: true });
    });

    it('неразмеченный код одного модуля — общий владелец, а значит внутренний импорт', () => {
        const owner = '/src/modules/order';

        expect(
            decide(schema, at('module:unknown', owner, owner), at('module:unknown', owner, owner)),
        ).toEqual({ ok: true });
    });

    it('владелец null у обоих концов общим владельцем не считается', () => {
        // Два неразмеченных файла вне модулей — не одно целое: горизонталь, а не пропуск.
        expect(decide(schema, at('root:unknown', null), at('root:unknown', null))).toEqual({
            ok: false,
            messageId: 'horizontalDependency',
            data: { layer: '@unknown' },
        });
    });

    it('источник module:unknown получает права модуля целиком', () => {
        const from = at('module:unknown', '/src/modules/order', '/src/modules/order');

        // `module:unknown` в схеме не объявлен, и без схлопывания импортировать не мог бы ничего.
        const toLayer = at('module:widgets', '/src/modules/other/widgets', '/src/modules/other');
        const toBarrel = at('module', '/src/modules/other', '/src/modules/other');

        expect(decide(schema, from, toLayer)).toEqual({ ok: true });
        expect(decide(schema, from, toBarrel)).toEqual({ ok: true });
    });

    it('права модуля не дотягиваются до pages и app', () => {
        const from = at('module:unknown', '/src/modules/order', '/src/modules/order');

        expect(decide(schema, from, at('root:app', '/src/app'))).toEqual({
            ok: false,
            messageId: 'illegalDependency',
            data: { fromLayer: 'module', toLayer: 'app' },
        });
    });

    it('схлопывание источника видно и отдельно от вердикта', () => {
        expect(sourceRights('module:unknown')).toBe('module');
        expect(sourceRights('root:unknown')).toBe('root:unknown');
        expect(sourceRights('module:entities')).toBe('module:entities');
    });
});

describe('decide — цель без объявленного слоя', () => {
    it('неразмеченный файл своего же модуля — совет разметить, а не идти через баррель', () => {
        expect(
            decide(
                schema,
                at('module:entities', '/src/modules/order/entities', '/src/modules/order'),
                at('module:unknown', '/src/modules/order', '/src/modules/order'),
            ),
        ).toEqual({
            ok: false,
            messageId: 'undeclaredTargetLayer',
            data: { layer: '@unknown', declare: "'@unknown' in moduleLayers" },
        });
    });

    it('неразмеченный файл чужого модуля — внутренности чужого модуля', () => {
        expect(
            decide(
                schema,
                at('module:entities', '/src/modules/order/entities', '/src/modules/order'),
                at('module:unknown', '/src/modules/other', '/src/modules/other'),
            ),
        ).toEqual({
            ok: false,
            messageId: 'moduleInternals',
            data: { fromLayer: 'entities' },
        });
    });

    it('внутренности чужого модуля из файла вне модулей — тот же случай', () => {
        expect(
            decide(
                schema,
                at('root:app', '/src/app'),
                at('module:unknown', '/src/modules/other', '/src/modules/other'),
            ),
        ).toEqual({
            ok: false,
            messageId: 'moduleInternals',
            data: { fromLayer: 'app' },
        });
    });

    it('цель root:unknown при схеме без @unknown — совет объявить его в layers', () => {
        const strict = getLayerSchema({
            weld: { layers: ['common', '@modules', 'app'], moduleLayers: ['entities'] },
        });

        expect(decide(strict, at('root:app', '/src/app'), at('root:unknown', null))).toEqual({
            ok: false,
            messageId: 'undeclaredTargetLayer',
            data: { layer: '@unknown', declare: "'@unknown' in layers" },
        });
    });

    it('цель module при схеме без @modules — совет объявить @modules', () => {
        const noModules = getLayerSchema({ weld: { layers: ['common', 'app'] } });

        expect(
            decide(
                noModules,
                at('root:app', '/src/app'),
                at('module', '/src/modules/order', '/src/modules/order'),
            ),
        ).toEqual({
            ok: false,
            messageId: 'undeclaredTargetLayer',
            data: { layer: 'module', declare: "'@modules' in layers" },
        });
    });

    it('источник вне схемы сам импортировать не может', () => {
        const strict = getLayerSchema({
            weld: { layers: ['common', '@modules', 'app'], moduleLayers: ['entities'] },
        });

        // `root:unknown` не объявлен: позиции нет, а значит нет и прав. Правило до этого не доходит
        // — такой файл оно репортит целиком, — но вердикт обязан быть определён.
        expect(decide(strict, at('root:unknown', null), at('root:common', '/src/common'))).toEqual({
            ok: false,
            messageId: 'illegalDependency',
            data: { fromLayer: '@unknown', toLayer: 'common' },
        });
    });
});

describe('decide — горизонтальные связи', () => {
    it('одноимённые слои разных модулей', () => {
        expect(
            decide(
                schema,
                at('module:entities', '/src/modules/order/entities', '/src/modules/order'),
                at('module:entities', '/src/modules/other/entities', '/src/modules/other'),
            ),
        ).toEqual({
            ok: false,
            messageId: 'horizontalDependency',
            data: { layer: 'entities' },
        });
    });

    it('одноимённые слои проекта — следствие deepest', () => {
        // `/src/common/utils/app/format.ts` заявляет слой `app` так же буквально, как `/src/app`.
        expect(
            decide(schema, at('root:app', '/src/app'), at('root:app', '/src/common/utils/app')),
        ).toEqual({
            ok: false,
            messageId: 'horizontalDependency',
            data: { layer: 'app' },
        });
    });

    it('одноимённый слой с диапазоном горизонталью не является', () => {
        // У `module` first меньше last, поэтому баррель модуля вправе импортировать чужой баррель.
        expect(
            decide(
                schema,
                at('module', '/src/modules/order', '/src/modules/order'),
                at('module', '/src/modules/other', '/src/modules/other'),
            ),
        ).toEqual({ ok: true });
    });
});
