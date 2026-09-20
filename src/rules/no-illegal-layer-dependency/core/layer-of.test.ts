import { describe, expect, it } from 'vitest';

import { layerOf } from '@/rules/no-illegal-layer-dependency/core/layer-of.js';
import type { LayerSchema } from '@/settings/index.js';
import { getLayerSchema } from '@/settings/index.js';

/** Схема из плана: слои проекта вокруг `@modules`, три слоя модуля, `moduleDir` по умолчанию. */
const schema = getLayerSchema({
    weld: {
        layers: ['common', '@unknown', '@modules', 'pages', 'app'],
        moduleLayers: ['entities', 'features', 'widgets'],
    },
});

/** Слой и владелец — то, ради чего зовут `layerOf`; `moduleRoot` проверяется отдельным набором. */
function place(path: string, kind: 'file' | 'target', schemaOverride: LayerSchema = schema) {
    const { layer, owner } = layerOf(path, schemaOverride, kind);

    return { layer, owner };
}

describe('layerOf — файл (сканируется директория файла)', () => {
    it.each([
        ['/src/common/ui/button.tsx', 'root:common', '/src/common'],
        ['/src/common/index.ts', 'root:common', '/src/common'],
        ['/src/common/utils/app/format.ts', 'root:app', '/src/common/utils/app'],
        ['/src/shared/lib/x.ts', 'root:unknown', null],
        ['/src/index.ts', 'root:unknown', null],
        ['/src/modules/x.ts', 'root:unknown', null],
        ['/src/modules/order/index.ts', 'module', '/src/modules/order'],
        ['/src/modules/order/index.test.ts', 'module:unknown', '/src/modules/order'],
        ['/src/modules/order/module.ts', 'module:unknown', '/src/modules/order'],
        ['/src/modules/order/lib/x.ts', 'module:unknown', '/src/modules/order'],
        ['/src/modules/order/pages/x.ts', 'module:unknown', '/src/modules/order'],
        ['/src/modules/order/entities/index.ts', 'module:entities', '/src/modules/order/entities'],
        [
            '/src/modules/order/entities/user/model.ts',
            'module:entities',
            '/src/modules/order/entities',
        ],
        [
            '/src/modules/order/widgets/card/entities/x.ts',
            'module:entities',
            '/src/modules/order/widgets/card/entities',
        ],
        [
            '/src/modules/order/modules/sub/features/x.ts',
            'module:features',
            '/src/modules/order/modules/sub/features',
        ],
        [
            '/src/modules/order/widgets/card/modules/sub/index.ts',
            'module',
            '/src/modules/order/widgets/card/modules/sub',
        ],
        ['/src/common/modules/x/lib/a.ts', 'module:unknown', '/src/common/modules/x'],
    ])('%s → %s (владелец %s)', (path, layer, owner) => {
        expect(place(path, 'file')).toEqual({ layer, owner });
    });
});

describe('layerOf — цель импорта (сканируются все сегменты пути)', () => {
    // Специфаеры записаны из `…/modules/order/entities/user/x.ts`; путь цели уже разрешён
    // `parseSpecifier`, поэтому `layerOf` видит только вторую колонку.
    it.each([
        ['@/common', '/src/common', 'root:common', '/src/common'],
        ['@/common/index.ts', '/src/common/index.ts', 'root:common', '/src/common'],
        // Цена deepest: файл `common/app.ts`, записанный как `@/common/app`, читается как слой `app`.
        ['@/common/app', '/src/common/app', 'root:app', '/src/common/app'],
        ['@/modules/order', '/src/modules/order', 'module', '/src/modules/order'],
        ['@/modules/order/index.ts', '/src/modules/order/index.ts', 'module', '/src/modules/order'],
        ['@/modules/order/lib', '/src/modules/order/lib', 'module:unknown', '/src/modules/order'],
        [
            '@/modules/order/entities',
            '/src/modules/order/entities',
            'module:entities',
            '/src/modules/order/entities',
        ],
        ['@/modules', '/src/modules', 'root:unknown', null],
        ['..', '/src/modules/order/entities', 'module:entities', '/src/modules/order/entities'],
        ['.', '/src/modules/order/entities/user', 'module:entities', '/src/modules/order/entities'],
    ])('%s → %s → %s (владелец %s)', (_specifier, path, layer, owner) => {
        expect(place(path, 'target')).toEqual({ layer, owner });
    });

    it('специфаер без расширения на баррель модуля — тоже публичный интерфейс', () => {
        expect(place('/src/modules/order/index', 'target')).toEqual({
            layer: 'module',
            owner: '/src/modules/order',
        });
    });

    it('внутренний баррель модуля публичным интерфейсом не считается', () => {
        expect(place('/src/modules/order/lib/index.ts', 'target')).toEqual({
            layer: 'module:unknown',
            owner: '/src/modules/order',
        });
    });

    it('баррель слоя модуля остаётся слоем, а не модулем', () => {
        expect(place('/src/modules/order/entities/index.ts', 'target')).toEqual({
            layer: 'module:entities',
            owner: '/src/modules/order/entities',
        });
    });
});

describe('layerOf — краевые случаи', () => {
    it('moduleDir последним сегментом модуля не открывает: имени модуля за ним нет', () => {
        expect(place('/src/app/modules/x.ts', 'file')).toEqual({
            layer: 'root:app',
            owner: '/src/app',
        });
        expect(place('/src/app/modules', 'target')).toEqual({
            layer: 'root:app',
            owner: '/src/app',
        });
    });

    it('moduleDir сразу внутри модуля — вложенный модуль, слой сбрасывается', () => {
        expect(place('/src/modules/order/modules/sub/lib/y.ts', 'target')).toEqual({
            layer: 'module:unknown',
            owner: '/src/modules/order/modules/sub',
        });
        expect(place('/src/modules/order/modules/x.ts', 'file')).toEqual({
            layer: 'module:unknown',
            owner: '/src/modules/order',
        });
    });

    it('вход в модуль сбрасывает найденный снаружи слой', () => {
        expect(place('/src/pages/modules/order/lib/x.ts', 'file')).toEqual({
            layer: 'module:unknown',
            owner: '/src/pages/modules/order',
        });
    });

    it('имя модуля, совпадающее с именем слоя модуля, слоем не считается', () => {
        expect(place('/src/modules/entities/x.ts', 'file')).toEqual({
            layer: 'module:unknown',
            owner: '/src/modules/entities',
        });
    });

    it('имя модуля, совпадающее с именем слоя проекта, слоем не считается', () => {
        expect(place('/src/modules/common/x.ts', 'file')).toEqual({
            layer: 'module:unknown',
            owner: '/src/modules/common',
        });
    });

    it('слой проекта внутри модуля не опознаётся — набор другой', () => {
        expect(place('/src/modules/order/app/x.ts', 'file')).toEqual({
            layer: 'module:unknown',
            owner: '/src/modules/order',
        });
    });

    it('слой модуля вне модулей не опознаётся — набор другой', () => {
        expect(place('/src/entities/user/x.ts', 'file')).toEqual({
            layer: 'root:unknown',
            owner: null,
        });
    });

    it('путь без директорий — код вне слоёв', () => {
        expect(place('/x.ts', 'file')).toEqual({ layer: 'root:unknown', owner: null });
        expect(place('/x.ts', 'target')).toEqual({ layer: 'root:unknown', owner: null });
    });

    it('цель, равная корню, — код вне слоёв', () => {
        expect(place('/', 'target')).toEqual({ layer: 'root:unknown', owner: null });
    });

    it('moduleDir из конфига заменяет modules целиком', () => {
        const packages = getLayerSchema({
            weld: {
                layers: ['common', '@modules', 'app'],
                moduleLayers: ['entities'],
                moduleDir: 'packages',
            },
        });

        expect(place('/src/packages/order/entities/x.ts', 'file', packages)).toEqual({
            layer: 'module:entities',
            owner: '/src/packages/order/entities',
        });
        expect(place('/src/modules/order/entities/x.ts', 'file', packages)).toEqual({
            layer: 'root:unknown',
            owner: null,
        });
    });
});

describe('layerOf — moduleRoot', () => {
    it('совпадает у файлов одного модуля, какой бы слой у них ни был', () => {
        const fromLib = layerOf('/src/modules/order/lib/x.ts', schema, 'file');
        const fromLayer = layerOf('/src/modules/order/entities/user/model.ts', schema, 'file');
        const barrel = layerOf('/src/modules/order/index.ts', schema, 'file');

        expect(fromLib.moduleRoot).toBe('/src/modules/order');
        expect(fromLayer.moduleRoot).toBe('/src/modules/order');
        expect(barrel.moduleRoot).toBe('/src/modules/order');
    });

    it('у вложенного модуля — сам вложенный модуль, а не внешний', () => {
        expect(
            layerOf('/src/modules/order/modules/sub/features/x.ts', schema, 'file').moduleRoot,
        ).toBe('/src/modules/order/modules/sub');
    });

    it('вне модулей — null', () => {
        expect(layerOf('/src/common/ui/button.tsx', schema, 'file').moduleRoot).toBeNull();
        expect(layerOf('/src/shared/lib/x.ts', schema, 'file').moduleRoot).toBeNull();
        expect(layerOf('/src/modules', schema, 'target').moduleRoot).toBeNull();
    });

    it('у цели считается так же, как у файла', () => {
        expect(layerOf('/src/modules/order/entities', schema, 'target').moduleRoot).toBe(
            '/src/modules/order',
        );
    });
});
