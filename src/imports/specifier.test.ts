import { describe, expect, it } from 'vitest';

import type { Alias } from '@/settings/index.js';
import { parseSpecifier, renderSpecifier } from '@/imports/specifier.js';

describe('parseSpecifier — относительные формы', () => {
    it("'./x' от /src/feature → /src/feature/x, форма relative", () => {
        expect(parseSpecifier('./x', '/src/feature', [])).toEqual({
            path: '/src/feature/x',
            form: { kind: 'relative' },
            extension: null,
        });
    });

    it("'../x' от /src/feature → /src/x, форма relative", () => {
        expect(parseSpecifier('../x', '/src/feature', [])).toEqual({
            path: '/src/x',
            form: { kind: 'relative' },
            extension: null,
        });
    });

    it("'.' от /src/feature → /src/feature, форма relative", () => {
        expect(parseSpecifier('.', '/src/feature', [])).toEqual({
            path: '/src/feature',
            form: { kind: 'relative' },
            extension: null,
        });
    });

    it("'..' от /src/feature → /src, форма relative", () => {
        expect(parseSpecifier('..', '/src/feature', [])).toEqual({
            path: '/src',
            form: { kind: 'relative' },
            extension: null,
        });
    });
});

describe('parseSpecifier — алиасы', () => {
    it('точное совпадение со специфаером даёт якорь как путь', () => {
        const aliases: Alias[] = [{ prefix: '@src', anchor: '/src' }];
        expect(parseSpecifier('@src', '/other', aliases)).toEqual({
            path: '/src',
            form: { kind: 'alias', alias: aliases[0] },
            extension: null,
        });
    });

    it('префикс с хвостом подставляет хвост в якорь', () => {
        const aliases: Alias[] = [{ prefix: '@src', anchor: '/src' }];
        expect(parseSpecifier('@src/feature/x', '/other', aliases)).toEqual({
            path: '/src/feature/x',
            form: { kind: 'alias', alias: aliases[0] },
            extension: null,
        });
    });

    it('беззвёздочная запись с хвостом — тот же обход, что и звёздочная', () => {
        const aliases: Alias[] = [{ prefix: '@pkg', anchor: '/packages/pkg/src' }];
        expect(parseSpecifier('@pkg/internal/thing', '/other', aliases)).toEqual({
            path: '/packages/pkg/src/internal/thing',
            form: { kind: 'alias', alias: aliases[0] },
            extension: null,
        });
    });

    it('выигрывает самый длинный подходящий префикс', () => {
        const short: Alias = { prefix: '@src', anchor: '/src' };
        const long: Alias = { prefix: '@src/feature', anchor: '/src/feature' };
        expect(parseSpecifier('@src/feature/x', '/other', [short, long])).toEqual({
            path: '/src/feature/x',
            form: { kind: 'alias', alias: long },
            extension: null,
        });
    });

    it('при равных префиксах выигрывает первая запись по порядку', () => {
        const first: Alias = { prefix: '@src', anchor: '/one' };
        const second: Alias = { prefix: '@src', anchor: '/two' };
        expect(parseSpecifier('@src/x', '/other', [first, second])).toEqual({
            path: '/one/x',
            form: { kind: 'alias', alias: first },
            extension: null,
        });
    });
});

describe('parseSpecifier — что отсекается на входе', () => {
    it('голое имя пакета → null', () => {
        expect(parseSpecifier('lodash', '/src/feature', [])).toBeNull();
    });

    it('@scope/pkg → null', () => {
        expect(parseSpecifier('@scope/pkg', '/src/feature', [])).toBeNull();
    });

    it('абсолютный специфаер → null', () => {
        expect(parseSpecifier('/foo', '/src/feature', [])).toBeNull();
    });

    it("специфаер с '?' → null", () => {
        expect(parseSpecifier('./x.svg?url', '/src/feature', [])).toBeNull();
    });

    it("специфаер с '!' → null", () => {
        expect(parseSpecifier('!!raw-loader!./x', '/src/feature', [])).toBeNull();
    });

    it('расширение вне MODULE_EXTENSIONS (.css) → null', () => {
        expect(parseSpecifier('./x.css', '/src/feature', [])).toBeNull();
    });

    it('расширение вне MODULE_EXTENSIONS (.svg) → null', () => {
        expect(parseSpecifier('./x.svg', '/src/feature', [])).toBeNull();
    });

    it('расширение вне MODULE_EXTENSIONS (.json) → null', () => {
        expect(parseSpecifier('./x.json', '/src/feature', [])).toBeNull();
    });

    it('расширение вне MODULE_EXTENSIONS (.png) → null', () => {
        expect(parseSpecifier('./x.png', '/src/feature', [])).toBeNull();
    });

    it('относительный подъём выше виртуального корня → null', () => {
        expect(parseSpecifier('../../../../shared/x', '/src', [])).toBeNull();
    });
});

describe('parseSpecifier — расширения из MODULE_EXTENSIONS не отсекаются', () => {
    it('.ts не вызывает отсечение', () => {
        expect(parseSpecifier('./x.ts', '/src/feature', [])).toEqual({
            path: '/src/feature/x.ts',
            form: { kind: 'relative' },
            extension: 'ts',
        });
    });
});

describe('renderSpecifier — форма relative', () => {
    it('спускается в поддиректорию с префиксом ./', () => {
        expect(
            renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/feature/inner', []),
        ).toBe('./inner');
    });

    it('поднимается наружу без добавления лишнего префикса', () => {
        expect(renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/other', [])).toBe(
            '../other',
        );
    });

    it("'.storybook' — путь с точки, но остаётся относительной формой с префиксом ./", () => {
        expect(
            renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/feature/.storybook', []),
        ).toBe('./.storybook');
    });

    it('граница совпадает с fromDir → относительный путь пуст, но префикс ./ добавляется', () => {
        expect(renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/feature', [])).toBe(
            './',
        );
    });
});

describe('renderSpecifier — форма alias', () => {
    it('якорь исходного алиаса покрывает границу → тот же алиас', () => {
        const alias: Alias = { prefix: '@src', anchor: '/src' };
        expect(renderSpecifier({ kind: 'alias', alias }, '/other', '/src/feature', [alias])).toBe(
            '@src/feature',
        );
    });

    it('D === anchor → голый префикс без завершающего слэша', () => {
        const alias: Alias = { prefix: '@src', anchor: '/src' };
        expect(renderSpecifier({ kind: 'alias', alias }, '/other', '/src', [alias])).toBe('@src');
    });

    it('якорь исходного алиаса не покрывает границу → алиас с самым длинным покрывающим якорем', () => {
        const original: Alias = { prefix: '@other', anchor: '/other' };
        const short: Alias = { prefix: '@src', anchor: '/src' };
        const long: Alias = { prefix: '@feature', anchor: '/src/feature' };
        expect(
            renderSpecifier({ kind: 'alias', alias: original }, '/whatever', '/src/feature/inner', [
                short,
                long,
            ]),
        ).toBe('@feature/inner');
    });

    it('ни один алиас не покрывает границу → откат на относительный путь', () => {
        const original: Alias = { prefix: '@other', anchor: '/other' };
        expect(
            renderSpecifier({ kind: 'alias', alias: original }, '/src/feature', '/src/target', []),
        ).toBe('../target');
    });
});

describe('renderSpecifier — специфаер без расширения даёт голую директорию', () => {
    it('форма relative: цель без расширения и /index', () => {
        expect(
            renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/feature/inner', []),
        ).not.toMatch(/\.\w+$|\/index$/);
    });

    it('форма alias: цель без расширения и /index', () => {
        const alias: Alias = { prefix: '@src', anchor: '/src' };
        expect(
            renderSpecifier({ kind: 'alias', alias }, '/other', '/src/feature', [alias]),
        ).not.toMatch(/\.\w+$|\/index$/);
    });
});

describe('renderSpecifier — расширение исходного специфаера сохраняется', () => {
    it('форма relative: явное расширение → /index.<ext>', () => {
        expect(renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/other', [], 'js')).toBe(
            '../other/index.js',
        );
    });

    it('форма alias: явное расширение → /index.<ext>', () => {
        const alias: Alias = { prefix: '@src', anchor: '/src' };
        expect(
            renderSpecifier({ kind: 'alias', alias }, '/other', '/src/feature', [alias], 'ts'),
        ).toBe('@src/feature/index.ts');
    });

    it('граница совпадает с якорем алиаса → префикс и точка входа без лишнего слэша', () => {
        const alias: Alias = { prefix: '@src', anchor: '/src' };
        expect(renderSpecifier({ kind: 'alias', alias }, '/other', '/src', [alias], 'ts')).toBe(
            '@src/index.ts',
        );
    });

    it('относительный путь, оканчивающийся на /, не даёт удвоенного слэша', () => {
        expect(
            renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/feature', [], 'ts'),
        ).toBe('./index.ts');
    });

    it('расширение берётся из специфаера, а не с диска: .js остаётся .js', () => {
        expect(
            renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/other', [], 'js'),
        ).not.toContain('.ts');
    });
});
