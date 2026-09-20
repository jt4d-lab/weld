import { describe, expect, it } from 'vitest';

import type { Alias } from '@/settings/index.js';
import { getLayerSchema } from '@/settings/index.js';

import { createChecker } from '@/rules/no-illegal-layer-dependency/pipeline.js';

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

/** Один алиас на весь проект — им проверяется, что форма записи на вердикт не влияет. */
const aliases: Alias[] = [{ prefix: '@', anchor: '/src' }];

const fromFile = '/src/modules/order/features/cart/model.ts';

function check(specifier: string, file: string = fromFile) {
    return createChecker({ fromFile: file, aliases, schema }).checkImport(specifier);
}

describe('createChecker — слой линтуемого файла', () => {
    it('считается один раз и отдаётся наружу: репорт на файл делает правило', () => {
        expect(createChecker({ fromFile, aliases, schema }).from).toEqual({
            layer: 'module:features',
            owner: '/src/modules/order/features',
            moduleRoot: '/src/modules/order',
        });
    });

    it('одна проверка обслуживает все специфаеры файла', () => {
        const { checkImport } = createChecker({ fromFile, aliases, schema });

        expect(checkImport('@/common')).toBeNull();
        expect(checkImport('@/modules/order/widgets/card')).toEqual({
            messageId: 'illegalDependency',
            data: {
                fromLayer: 'features',
                toLayer: 'widgets',
                target: '@/modules/order/widgets/card',
            },
        });
    });
});

describe('checkImport — специфаеры, которые правилу не принадлежат', () => {
    it('голый пакет — не путь внутрь репозитория', () => {
        expect(check('lodash')).toBeNull();
        expect(check('@scope/pkg')).toBeNull();
    });

    it('не-JS ресурс — не импорт кода', () => {
        expect(check('./cart.css')).toBeNull();
    });
});

describe('checkImport — форма записи на вердикт не влияет', () => {
    it('алиасный и относительный специфаер одной цели дают одно нарушение', () => {
        const byAlias = check('@/modules/order/widgets/card');
        const byRelative = check('../../widgets/card');

        expect(byAlias).toEqual({
            messageId: 'illegalDependency',
            data: {
                fromLayer: 'features',
                toLayer: 'widgets',
                target: '@/modules/order/widgets/card',
            },
        });
        // Отличается только `{{target}}` — специфаер, как он записан в исходнике.
        expect(byRelative).toEqual({
            messageId: 'illegalDependency',
            data: { fromLayer: 'features', toLayer: 'widgets', target: '../../widgets/card' },
        });
    });
});

describe('checkImport — легальные импорты', () => {
    it('баррель слоя проекта', () => {
        expect(check('@/common')).toBeNull();
        expect(check('@/common/index.js')).toBeNull();
    });

    it('баррель модуля — своего и чужого', () => {
        expect(check('@/modules/order')).toBeNull();
        expect(check('@/modules/other')).toBeNull();
    });

    it('слой ниже своего в том же модуле', () => {
        expect(check('@/modules/order/entities')).toBeNull();
    });

    it('внутренний импорт своего слоя — общий владелец', () => {
        expect(check('./util.js')).toBeNull();
        expect(check('../other/thing')).toBeNull();
    });
});

describe('checkImport — специфаеры `.` и `..`', () => {
    // Путь директорией, без единого имени файла: цель — сама директория, и слой у неё обычный.
    const inLayer = '/src/modules/order/entities/user/x.ts';

    it('указывают внутрь своей же директории слоя — внутренний импорт', () => {
        expect(check('.', inLayer)).toBeNull();
        expect(check('..', inLayer)).toBeNull();
    });

    it('`..` из корня слоя попадает в баррель своего модуля', () => {
        expect(check('..', '/src/modules/order/entities/x.ts')).toBeNull();
    });

    it('`..` вверх по слоям модуля — нарушение, специфаер подставляется как есть', () => {
        expect(check('..', '/src/modules/order/widgets/card/entities/x.ts')).toEqual({
            messageId: 'illegalDependency',
            data: { fromLayer: 'entities', toLayer: 'widgets', target: '..' },
        });
    });
});

describe('checkImport — нарушения с подстановкой специфаера', () => {
    it('внутренности чужого модуля', () => {
        expect(check('@/modules/other/lib/x')).toEqual({
            messageId: 'moduleInternals',
            data: { fromLayer: 'features', target: '@/modules/other/lib/x' },
        });
    });

    it('неразмеченный код своего модуля', () => {
        expect(check('@/modules/order/lib/x')).toEqual({
            messageId: 'undeclaredTargetLayer',
            data: {
                layer: '@unknown',
                declare: "'@unknown' in moduleLayers",
                target: '@/modules/order/lib/x',
            },
        });
    });

    it('горизонталь одноимённых слоёв разных модулей', () => {
        expect(check('@/modules/other/features')).toEqual({
            messageId: 'horizontalDependency',
            data: { layer: 'features', target: '@/modules/other/features' },
        });
    });

    it('файл вне модулей: импорт вверх по слоям проекта', () => {
        expect(check('@/app/config', '/src/common/ui/button.tsx')).toEqual({
            messageId: 'illegalDependency',
            data: { fromLayer: 'common', toLayer: 'app', target: '@/app/config' },
        });
    });
});
