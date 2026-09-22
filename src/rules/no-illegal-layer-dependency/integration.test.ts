/**
 * Интеграционные тесты: единственное место, где правило работает поверх настоящего `FsHost`.
 * Остальные наборы инжектят `createFakeFsHost([])`, у которого корень — `/`, поэтому `toVirtual`
 * там тождественно и подмена виртуального пути реальным осталась бы незамеченной. Здесь корень —
 * директория фикстуры, и виртуальный путь от реального отличается.
 */

import { afterEach, describe, it } from 'vitest';

import { resetFsHostCaches } from '@/host/index.js';

import { createRule } from '@/rules/no-illegal-layer-dependency/index.js';
import { consumerFile, createRuleTester, fixtureRoot } from '@/testing/index.js';
import { resetTsconfigCache } from '@/tsconfig/index.js';

const ruleTester = createRuleTester();

/**
 * Слой `testing` в схеме есть только ради этой проверки: он встречается в **реальном** пути
 * фикстуры (`src/testing/fixtures/project/...`) и не встречается в виртуальном (`/src/consumer.ts`).
 * Если правило опознает слой по реальному пути, файл окажется слоем `testing`, и легальный импорт
 * станет нарушением.
 */
const settings = {
    weld: {
        repoRoot: fixtureRoot,
        layers: ['testing', 'feature', '@unknown'],
    },
};

describe('weld/no-illegal-layer-dependency: интеграционные тесты на реальной фикстуре', () => {
    afterEach(() => {
        resetFsHostCaches();
        resetTsconfigCache();
    });

    it('слой считается по виртуальному пути от настоящего repoRoot', () => {
        ruleTester.run('no-illegal-layer-dependency integration', createRule(), {
            valid: [
                {
                    name: 'вне слоёв (@unknown) → feature: разрешено виртуальным путём',
                    code: "import { a } from './feature/index.ts';",
                    filename: consumerFile,
                    settings,
                },
            ],
            invalid: [
                {
                    name: 'та же пара при схеме, где @unknown стоит левее feature',
                    code: "import { a } from './feature/index.ts';",
                    filename: consumerFile,
                    settings: { weld: { repoRoot: fixtureRoot, layers: ['@unknown', 'feature'] } },
                    errors: [
                        {
                            messageId: 'illegalDependency',
                            data: {
                                fromLayer: '@unknown',
                                toLayer: 'feature',
                                target: './feature/index.ts',
                            },
                        },
                    ],
                },
            ],
        });
    });
});
