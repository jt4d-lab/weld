import { describe, expect, it } from 'vitest';

import { parseSpecifier, renderSpecifier } from './specifier.js';
import type { Alias } from '../../settings/aliases.js';

const fromDir = '/repo/src/feature';

describe('parseSpecifier — относительные формы', () => {
    it('./x резолвится от fromDir', () => {
        expect(parseSpecifier('./x', fromDir, [])).toEqual({
            path: '/repo/src/feature/x',
            form: { kind: 'relative' },
        });
    });

    it('../x поднимается на уровень выше', () => {
        expect(parseSpecifier('../x', fromDir, [])).toEqual({
            path: '/repo/src/x',
            form: { kind: 'relative' },
        });
    });

    it('. — сам fromDir', () => {
        expect(parseSpecifier('.', fromDir, [])).toEqual({
            path: '/repo/src/feature',
            form: { kind: 'relative' },
        });
    });

    it('.. — родитель fromDir', () => {
        expect(parseSpecifier('..', fromDir, [])).toEqual({
            path: '/repo/src',
            form: { kind: 'relative' },
        });
    });
});

describe('parseSpecifier — алиасы', () => {
    const src: Alias = { prefix: '@src', anchor: '/repo/src' };
    const pkg: Alias = { prefix: '@pkg', anchor: '/repo/packages/pkg/src' };

    it('точное совпадение с префиксом даёт сам якорь', () => {
        expect(parseSpecifier('@src', fromDir, [src])).toEqual({
            path: '/repo/src',
            form: { kind: 'alias', alias: src },
        });
    });

    it('префикс с хвостом подставляется в якорь', () => {
        expect(parseSpecifier('@src/feature/x', fromDir, [src])).toEqual({
            path: '/repo/src/feature/x',
            form: { kind: 'alias', alias: src },
        });
    });

    it('беззвёздочная запись с хвостом (@pkg/internal/x) трактуется как префиксная', () => {
        expect(parseSpecifier('@pkg/internal/x', fromDir, [pkg])).toEqual({
            path: '/repo/packages/pkg/src/internal/x',
            form: { kind: 'alias', alias: pkg },
        });
    });

    it('выигрывает самый длинный подходящий префикс', () => {
        const short: Alias = { prefix: '@a', anchor: '/repo/a-short' };
        const long: Alias = { prefix: '@a/b', anchor: '/repo/a-long' };
        expect(parseSpecifier('@a/b/x', fromDir, [short, long])).toEqual({
            path: '/repo/a-long/x',
            form: { kind: 'alias', alias: long },
        });
    });

    it('двойной слэш сразу после префикса не отбрасывает якорь (@pkg//x/thing.ts)', () => {
        expect(parseSpecifier('@pkg//x/thing.ts', fromDir, [pkg])).toEqual({
            path: '/repo/packages/pkg/src/x/thing.ts',
            form: { kind: 'alias', alias: pkg },
        });
    });

    it('при равных префиксах выигрывает первая запись в порядке объявления', () => {
        const first: Alias = { prefix: '@a', anchor: '/repo/first' };
        const second: Alias = { prefix: '@a', anchor: '/repo/second' };
        expect(parseSpecifier('@a/x', fromDir, [first, second])).toEqual({
            path: '/repo/first/x',
            form: { kind: 'alias', alias: first },
        });
    });
});

describe('parseSpecifier — что отсекается на входе', () => {
    it('голый пакет — null', () => {
        expect(parseSpecifier('lodash', fromDir, [])).toBeNull();
    });

    it('@scope/pkg без совпадающего алиаса — null', () => {
        expect(parseSpecifier('@scope/pkg', fromDir, [])).toBeNull();
    });

    it('абсолютный специфаер (/foo) — null', () => {
        expect(parseSpecifier('/foo', fromDir, [])).toBeNull();
    });

    it('специфаер с ? (./x.svg?url) — null', () => {
        expect(parseSpecifier('./x.svg?url', fromDir, [])).toBeNull();
    });

    it('специфаер с ! (!!raw-loader!./x) — null', () => {
        expect(parseSpecifier('!!raw-loader!./x', fromDir, [])).toBeNull();
    });

    it('последний сегмент с расширением вне ENTRY_EXTENSIONS (.css) — null', () => {
        expect(parseSpecifier('./feature/internal/styles.css', fromDir, [])).toBeNull();
    });
});

describe('parseSpecifier — расширение из ENTRY_EXTENSIONS не отсекается', () => {
    it('./feature/x.ts проходит арифметику', () => {
        expect(parseSpecifier('./feature/x.ts', fromDir, [])).toEqual({
            path: '/repo/src/feature/feature/x.ts',
            form: { kind: 'relative' },
        });
    });
});

describe('renderSpecifier — ветка 1: относительная форма', () => {
    it('добавляет префикс ./ к спуску вниз', () => {
        expect(renderSpecifier({ kind: 'relative' }, fromDir, '/repo/src/feature/sub', [])).toBe(
            './sub',
        );
    });

    it('не дублирует префикс при подъёме вверх (../)', () => {
        expect(renderSpecifier({ kind: 'relative' }, fromDir, '/repo/other', [])).toBe(
            '../../other',
        );
    });

    it('директория с точкой в имени (.storybook) остаётся относительным специфаером с ./', () => {
        expect(
            renderSpecifier({ kind: 'relative' }, fromDir, '/repo/src/feature/.storybook', []),
        ).toBe('./.storybook');
    });
});

describe('renderSpecifier — ветка 2: якорь исходного алиаса покрывает D', () => {
    const src: Alias = { prefix: '@src', anchor: '/repo/src' };

    it('рендерит тем же алиасом с хвостом', () => {
        expect(
            renderSpecifier({ kind: 'alias', alias: src }, fromDir, '/repo/src/feature', [src]),
        ).toBe('@src/feature');
    });

    it('D === anchor даёт голый префикс без слэша', () => {
        expect(renderSpecifier({ kind: 'alias', alias: src }, fromDir, '/repo/src', [src])).toBe(
            '@src',
        );
    });
});

describe('renderSpecifier — ветка 3: исходный якорь не покрывает D', () => {
    it('выигрывает самый длинный покрывающий якорь среди остальных алиасов', () => {
        const original: Alias = { prefix: '@other', anchor: '/repo/other' };
        const src: Alias = { prefix: '@src', anchor: '/repo/src' };
        const feature: Alias = { prefix: '@feature', anchor: '/repo/src/feature' };
        const shortCover: Alias = { prefix: '@short', anchor: '/repo' };

        expect(
            renderSpecifier({ kind: 'alias', alias: original }, fromDir, '/repo/src/feature/sub', [
                src,
                feature,
                shortCover,
            ]),
        ).toBe('@feature/sub');
    });

    it('при равной длине покрывающих якорей выигрывает первый по порядку в списке алиасов', () => {
        const original: Alias = { prefix: '@other', anchor: '/repo/other' };
        const first: Alias = { prefix: '@first', anchor: '/repo/src' };
        const second: Alias = { prefix: '@second', anchor: '/repo/src' };

        expect(
            renderSpecifier({ kind: 'alias', alias: original }, fromDir, '/repo/src/feature', [
                first,
                second,
            ]),
        ).toBe('@first/feature');
    });
});

describe('renderSpecifier — ветка 4: ни один алиас не покрывает D', () => {
    it('откатывается на относительный путь', () => {
        const src: Alias = { prefix: '@src', anchor: '/repo/src' };
        const other: Alias = { prefix: '@other', anchor: '/repo/other' };

        expect(
            renderSpecifier({ kind: 'alias', alias: src }, fromDir, '/repo/elsewhere', [other]),
        ).toBe('../../elsewhere');
    });
});

describe('renderSpecifier — результат без расширения и без хвоста /index', () => {
    it('относительная форма: D — директория, в результате нет /index', () => {
        expect(
            renderSpecifier({ kind: 'relative' }, fromDir, '/repo/src/feature/sub', []),
        ).not.toMatch(/\/index|\.\w+$/);
    });

    it('алиасная форма: D — директория, в результате нет /index', () => {
        const src: Alias = { prefix: '@src', anchor: '/repo/src' };
        expect(
            renderSpecifier({ kind: 'alias', alias: src }, fromDir, '/repo/src/feature/sub', [src]),
        ).not.toMatch(/\/index|\.\w+$/);
    });
});
