import { describe, expect, it, vi } from 'vitest';

import type { Alias } from '@/settings/index.js';
import { parseSpecifier, renderSpecifier } from '@/imports/specifier.js';

const resolve = (path: string): string | null =>
    path === '/src/feature/account.entity' ? '/src/feature/account.entity.ts' : null;

describe('parseSpecifier', () => {
    describe('parseSpecifier — относительные формы', () => {
        it("'./x' от /src/feature → /src/feature/x, форма relative", () => {
            expect(parseSpecifier('./x', '/src/feature', [], resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src/feature/x',
                    form: { kind: 'relative' },
                    extension: null,
                },
            });
        });

        it("'../x' от /src/feature → /src/x, форма relative", () => {
            expect(parseSpecifier('../x', '/src/feature', [], resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src/x',
                    form: { kind: 'relative' },
                    extension: null,
                },
            });
        });

        it("'.' от /src/feature → /src/feature, форма relative", () => {
            expect(parseSpecifier('.', '/src/feature', [], resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src/feature',
                    form: { kind: 'relative' },
                    extension: null,
                },
            });
        });

        it("'..' от /src/feature → /src, форма relative", () => {
            expect(parseSpecifier('..', '/src/feature', [], resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src',
                    form: { kind: 'relative' },
                    extension: null,
                },
            });
        });
    });

    describe('parseSpecifier — алиасы', () => {
        it('точное совпадение со специфаером даёт якорь как путь', () => {
            const aliases: Alias[] = [{ prefix: '@src', anchor: '/src' }];
            expect(parseSpecifier('@src', '/other', aliases, resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src',
                    form: { kind: 'alias', alias: aliases[0] },
                    extension: null,
                },
            });
        });

        it('префикс с хвостом подставляет хвост в якорь', () => {
            const aliases: Alias[] = [{ prefix: '@src', anchor: '/src' }];
            expect(parseSpecifier('@src/feature/x', '/other', aliases, resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src/feature/x',
                    form: { kind: 'alias', alias: aliases[0] },
                    extension: null,
                },
            });
        });

        it('беззвёздочная запись с хвостом — тот же обход, что и звёздочная', () => {
            const aliases: Alias[] = [{ prefix: '@pkg', anchor: '/packages/pkg/src' }];
            expect(parseSpecifier('@pkg/internal/thing', '/other', aliases, resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/packages/pkg/src/internal/thing',
                    form: { kind: 'alias', alias: aliases[0] },
                    extension: null,
                },
            });
        });

        it('выигрывает самый длинный подходящий префикс', () => {
            const short: Alias = { prefix: '@src', anchor: '/src' };
            const long: Alias = { prefix: '@src/feature', anchor: '/src/feature' };
            expect(parseSpecifier('@src/feature/x', '/other', [short, long], resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src/feature/x',
                    form: { kind: 'alias', alias: long },
                    extension: null,
                },
            });
        });

        it('при равных префиксах выигрывает первая запись по порядку', () => {
            const first: Alias = { prefix: '@src', anchor: '/one' };
            const second: Alias = { prefix: '@src', anchor: '/two' };
            expect(parseSpecifier('@src/x', '/other', [first, second], resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/one/x',
                    form: { kind: 'alias', alias: first },
                    extension: null,
                },
            });
        });
    });

    describe('parseSpecifier — что отсекается на входе', () => {
        it('голое имя пакета → external-dependency', () => {
            expect(parseSpecifier('lodash', '/src/feature', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'external-dependency',
            });
        });

        it('@global-scope/pkg → external-dependency', () => {
            expect(parseSpecifier('@global-scope/pkg', '/src/feature', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'external-dependency',
            });
        });

        it('абсолютный специфаер → asset', () => {
            expect(parseSpecifier('/foo', '/src/feature', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'asset',
            });
        });

        it("специфаер с '?' → asset", () => {
            expect(parseSpecifier('./x.svg?url', '/src/feature', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'asset',
            });
        });

        it("специфаер с '!' → asset", () => {
            expect(parseSpecifier('!!raw-loader!./x', '/src/feature', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'asset',
            });
        });

        it('расширение вне MODULE_EXTENSIONS (.css) → asset', () => {
            expect(parseSpecifier('./x.css', '/src/feature', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'asset',
            });
        });

        it('расширение вне MODULE_EXTENSIONS (.svg) → asset', () => {
            expect(parseSpecifier('./x.svg', '/src/feature', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'asset',
            });
        });

        it('расширение вне MODULE_EXTENSIONS (.json) → asset', () => {
            expect(parseSpecifier('./x.json', '/src/feature', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'asset',
            });
        });

        it('расширение вне MODULE_EXTENSIONS (.png) → asset', () => {
            expect(parseSpecifier('./x.png', '/src/feature', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'asset',
            });
        });

        it('относительный подъём выше виртуального корня → out-of-repo', () => {
            expect(parseSpecifier('../../../../shared/x', '/src', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'out-of-repo',
            });
        });
    });

    describe('parseSpecifier — неизвестное расширение уточняется по диску', () => {
        it('резолвер нашёл файл — цель берётся с диска, расширение остаётся неуказанным', () => {
            expect(parseSpecifier('./account.entity', '/src/feature', [], resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src/feature/account.entity.ts',
                    form: { kind: 'relative' },
                    extension: null,
                },
            });
        });

        it('резолвер ничего не нашёл → no-module-found', () => {
            expect(parseSpecifier('./account.unknown', '/src/feature', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'no-module-found',
            });
        });

        it('ассетное расширение отсекается без обращения к резолверу', () => {
            const never = vi.fn(() => '/src/feature/x.css');

            expect(parseSpecifier('./x.css', '/src/feature', [], never)).toEqual({
                kind: 'skip',
                reason: 'asset',
            });
            expect(never).not.toHaveBeenCalled();
        });

        it('то же через алиас — форма записи сохраняется в цели', () => {
            const aliases: Alias[] = [{ prefix: '@src', anchor: '/src' }];

            expect(
                parseSpecifier('@src/feature/account.entity', '/other', aliases, resolve),
            ).toEqual({
                kind: 'target',
                target: {
                    path: '/src/feature/account.entity.ts',
                    form: { kind: 'alias', alias: aliases[0] },
                    extension: null,
                },
            });
        });
    });

    describe('parseSpecifier — расширения из MODULE_EXTENSIONS не отсекаются', () => {
        it('.ts не вызывает отсечение', () => {
            expect(parseSpecifier('./x.ts', '/src/feature', [], resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src/feature/x.ts',
                    form: { kind: 'relative' },
                    extension: 'ts',
                },
            });
        });
    });
});

describe('renderSpecifier', () => {
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
                renderSpecifier(
                    { kind: 'relative' },
                    '/src/feature',
                    '/src/feature/.storybook',
                    [],
                ),
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
            expect(
                renderSpecifier({ kind: 'alias', alias }, '/other', '/src/feature', [alias]),
            ).toBe('@src/feature');
        });

        it('D === anchor → голый префикс без завершающего слэша', () => {
            const alias: Alias = { prefix: '@src', anchor: '/src' };
            expect(renderSpecifier({ kind: 'alias', alias }, '/other', '/src', [alias])).toBe(
                '@src',
            );
        });

        it('якорь исходного алиаса не покрывает границу → алиас с самым длинным покрывающим якорем', () => {
            const original: Alias = { prefix: '@other', anchor: '/other' };
            const short: Alias = { prefix: '@src', anchor: '/src' };
            const long: Alias = { prefix: '@feature', anchor: '/src/feature' };
            expect(
                renderSpecifier(
                    { kind: 'alias', alias: original },
                    '/whatever',
                    '/src/feature/inner',
                    [short, long],
                ),
            ).toBe('@feature/inner');
        });

        it('ни один алиас не покрывает границу → откат на относительный путь', () => {
            const original: Alias = { prefix: '@other', anchor: '/other' };
            expect(
                renderSpecifier(
                    { kind: 'alias', alias: original },
                    '/src/feature',
                    '/src/target',
                    [],
                ),
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
            expect(
                renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/other', [], 'js'),
            ).toBe('../other/index.js');
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
});
