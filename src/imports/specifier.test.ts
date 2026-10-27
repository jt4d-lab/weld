import { describe, expect, it, vi } from 'vitest';

import type { Alias } from '@/settings/index.js';
import { parseSpecifier, renderAliasPath, renderSpecifier } from '@/imports/specifier.js';

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
        it('точное совпадение со специфаером дает якорь как путь', () => {
            const aliases: Alias[] = [{ prefix: '@src', anchor: '/src', star: true }];
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
            const aliases: Alias[] = [{ prefix: '@src', anchor: '/src', star: true }];
            expect(parseSpecifier('@src/feature/x', '/other', aliases, resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src/feature/x',
                    form: { kind: 'alias', alias: aliases[0] },
                    extension: null,
                },
            });
        });

        it('беззвездочная запись с хвостом — тот же обход, что и звездочная', () => {
            const aliases: Alias[] = [{ prefix: '@pkg', anchor: '/packages/pkg/src', star: false }];
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
            const short: Alias = { prefix: '@src', anchor: '/src', star: true };
            const long: Alias = { prefix: '@src/feature', anchor: '/src/feature', star: true };
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
            const first: Alias = { prefix: '@src', anchor: '/one', star: true };
            const second: Alias = { prefix: '@src', anchor: '/two', star: true };
            expect(parseSpecifier('@src/x', '/other', [first, second], resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/one/x',
                    form: { kind: 'alias', alias: first },
                    extension: null,
                },
            });
        });

        it('префикс `/` (алиас на корень) не становится универсальным', () => {
            // Якорь `/` покрывает весь виртуальный путь, но прямой разбор об этом не знает: иначе
            // такой алиас перехватил бы все голые имена, и `react` перестал бы быть внешней зависимостью.
            const aliases: Alias[] = [{ prefix: '/', anchor: '/src', star: true }];

            expect(parseSpecifier('react', '/other', aliases, resolve)).toEqual({
                kind: 'skip',
                reason: 'external-dependency',
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

        it('относительный подъем выше виртуального корня → out-of-repo', () => {
            expect(parseSpecifier('../../../../shared/x', '/src', [], resolve)).toEqual({
                kind: 'skip',
                reason: 'out-of-repo',
            });
        });
    });

    describe('parseSpecifier — неизвестное расширение уточняется по диску', () => {
        it('резолвер нашел файл — цель берется с диска, расширение остается неуказанным', () => {
            expect(parseSpecifier('./account.entity', '/src/feature', [], resolve)).toEqual({
                kind: 'target',
                target: {
                    path: '/src/feature/account.entity.ts',
                    form: { kind: 'relative' },
                    extension: null,
                },
            });
        });

        it('резолвер ничего не нашел → no-module-found', () => {
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
            const aliases: Alias[] = [{ prefix: '@src', anchor: '/src', star: true }];

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

        it("'.storybook' — путь с точки, но остается относительной формой с префиксом ./", () => {
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
            const alias: Alias = { prefix: '@src', anchor: '/src', star: true };
            expect(
                renderSpecifier({ kind: 'alias', alias }, '/other', '/src/feature', [alias]),
            ).toBe('@src/feature');
        });

        it('D === anchor → голый префикс без завершающего слэша', () => {
            const alias: Alias = { prefix: '@src', anchor: '/src', star: true };
            expect(renderSpecifier({ kind: 'alias', alias }, '/other', '/src', [alias])).toBe(
                '@src',
            );
        });

        it('корневой якорь покрывает границу → префикс с полным хвостом', () => {
            const alias: Alias = { prefix: '@', anchor: '/', star: true };
            expect(
                renderSpecifier({ kind: 'alias', alias }, '/other', '/src/feature', [alias]),
            ).toBe('@/src/feature');
        });

        it('якорь исходного алиаса не покрывает границу → алиас с самым длинным покрывающим якорем', () => {
            const original: Alias = { prefix: '@other', anchor: '/other', star: true };
            const short: Alias = { prefix: '@src', anchor: '/src', star: true };
            const long: Alias = { prefix: '@feature', anchor: '/src/feature', star: true };
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
            const original: Alias = { prefix: '@other', anchor: '/other', star: true };
            expect(
                renderSpecifier(
                    { kind: 'alias', alias: original },
                    '/src/feature',
                    '/src/target',
                    [],
                ),
            ).toBe('../target');
        });

        it('беззвездочный корневой алиас не покрывает поддерево: откат на относительный путь', () => {
            // `paths: { '@root': ['.'] }` резолвит только сам `@root`, поэтому автофикс не должен
            // предлагать `@root/src/other` (tsc: TS2307) — относительный путь резолвится всегда.
            const original: Alias = { prefix: '@deep', anchor: '/src/other/deep', star: true };
            const root: Alias = { prefix: '@root', anchor: '/', star: false };

            expect(
                renderSpecifier({ kind: 'alias', alias: original }, '/src/feature', '/src/other', [
                    root,
                    original,
                ]),
            ).toBe('../other');
        });

        it('исходный беззвездочный корневой алиас тоже не покрывает поддерево', () => {
            // Импорт записан через точный ключ (`@root/src/other/deep/internal` правило читает
            // префиксом), но обратно в поддерево такая запись не рендерится: ключ покрывает только
            // свой якорь, а он — корень репозитория.
            const root: Alias = { prefix: '@root', anchor: '/', star: false };

            expect(
                renderSpecifier({ kind: 'alias', alias: root }, '/src/feature', '/src/other', [
                    root,
                ]),
            ).toBe('../other');
        });

        it('беззвездочный алиас на самом якоре → голый префикс', () => {
            const root: Alias = { prefix: '@root', anchor: '/', star: false };

            expect(renderSpecifier({ kind: 'alias', alias: root }, '/src', '/', [root])).toBe(
                '@root',
            );
        });
    });

    describe('renderSpecifier — специфаер без расширения дает голую директорию', () => {
        it('форма relative: цель без расширения и /index', () => {
            expect(
                renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/feature/inner', []),
            ).not.toMatch(/\.\w+$|\/index$/);
        });

        it('форма alias: цель без расширения и /index', () => {
            const alias: Alias = { prefix: '@src', anchor: '/src', star: true };
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
            const alias: Alias = { prefix: '@src', anchor: '/src', star: true };
            expect(
                renderSpecifier({ kind: 'alias', alias }, '/other', '/src/feature', [alias], 'ts'),
            ).toBe('@src/feature/index.ts');
        });

        it('граница совпадает с якорем алиаса → префикс и точка входа без лишнего слэша', () => {
            const alias: Alias = { prefix: '@src', anchor: '/src', star: true };
            expect(renderSpecifier({ kind: 'alias', alias }, '/other', '/src', [alias], 'ts')).toBe(
                '@src/index.ts',
            );
        });

        it('относительный путь, оканчивающийся на /, не дает удвоенного слэша', () => {
            expect(
                renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/feature', [], 'ts'),
            ).toBe('./index.ts');
        });

        it('расширение берется из специфаера, а не с диска: .js остается .js', () => {
            expect(
                renderSpecifier({ kind: 'relative' }, '/src/feature', '/src/other', [], 'js'),
            ).not.toContain('.ts');
        });
    });
});

describe('renderAliasPath', () => {
    /** Короткая запись ожидания: специфаер и признак «к специфаеру нужно дописать имя файла». */
    const rendered = (specifier: string, needsFileName = false) => ({ specifier, needsFileName });

    it('якорь покрывает путь → путь подставляется в префикс', () => {
        const aliases: Alias[] = [{ prefix: '@', anchor: '/src', star: true }];

        expect(renderAliasPath('/src/feature/internal', aliases)).toEqual(
            rendered('@/feature/internal'),
        );
    });

    it('путь совпадает с якорем звездного алиаса → голый префикс, специфаер неполон', () => {
        const aliases: Alias[] = [{ prefix: '@', anchor: '/src', star: true }];

        expect(renderAliasPath('/src', aliases)).toEqual(rendered('@', true));
    });

    it('якорь с хвостом в самом ключе: путь на якоре даёт голый префикс и признак неполноты', () => {
        const aliases: Alias[] = [{ prefix: '@/feature', anchor: '/src/feature', star: true }];

        // Специфаер `@/feature` в записи `@/feature/*` → `src/feature/*` не резолвится: звездочке
        // нечего подставить. Признак needsFileName говорит об этом вызывающему.
        expect(renderAliasPath('/src/feature', aliases)).toEqual(rendered('@/feature', true));
        expect(renderAliasPath('/src/feature/internal', aliases)).toEqual(
            rendered('@/feature/internal'),
        );
    });

    it('точный ключ: путь на якоре даёт готовый специфаер, а не неполный префикс', () => {
        // `paths: { '@pkg': ['packages/pkg/src'] }` резолвит сам `@pkg`, а `@pkg/index.ts` — нет:
        // звездочки в ключе нет, и хвост к точной записи не подставляется.
        const aliases: Alias[] = [{ prefix: '@pkg', anchor: '/packages/pkg/src', star: false }];

        expect(renderAliasPath('/packages/pkg/src', aliases)).toEqual(rendered('@pkg'));
    });

    it('беззвездочная запись ниже якоря не годится: путь не выражается точным ключом', () => {
        // `paths: { '@pkg': ['packages/pkg/src'] }` совпадает только сам с собой: `@pkg/internal/thing`
        // TypeScript не резолвит (TS2307), хотя прямое сопоставление WELD читает ключ префиксом.
        // Специфаера, который принял бы и tsc, и правило, у этой записи для такого пути нет, поэтому
        // ответ `null`: вызывающий печатает виртуальный путь, а не нерезолвимый алиас.
        const aliases: Alias[] = [{ prefix: '@pkg', anchor: '/packages/pkg/src', star: false }];

        expect(renderAliasPath('/packages/pkg/src/internal/thing', aliases)).toBeNull();
    });

    it('точный ключ ниже якоря уступает широкому звездному: тот дает резолвимый специфаер', () => {
        const exact: Alias = { prefix: '@config', anchor: '/src/config', star: false };
        const star: Alias = { prefix: '@', anchor: '/src', star: true };

        // Якорь точного ключа длиннее, но `@config/other.ts` TypeScript не находит; `@/config/other.ts`
        // из звездной записи резолвится.
        expect(renderAliasPath('/src/config/other.ts', [exact, star])).toEqual(
            rendered('@/config/other.ts'),
        );
    });

    it('точный ключ на самом якоре выигрывает у широкого звездного', () => {
        const exact: Alias = { prefix: '@config', anchor: '/src/config', star: false };
        const star: Alias = { prefix: '@', anchor: '/src', star: true };

        expect(renderAliasPath('/src/config', [exact, star])).toEqual(rendered('@config'));
    });

    it('выигрывает самый длинный покрывающий якорь', () => {
        const short: Alias = { prefix: '@', anchor: '/src', star: true };
        const long: Alias = { prefix: '@feature', anchor: '/src/feature', star: true };

        expect(renderAliasPath('/src/feature/internal', [short, long])).toEqual(
            rendered('@feature/internal'),
        );
    });

    it('при равной длине якоря выигрывает первая запись по порядку', () => {
        const first: Alias = { prefix: '@one', anchor: '/src', star: true };
        const second: Alias = { prefix: '@two', anchor: '/src', star: true };

        expect(renderAliasPath('/src/feature', [first, second])).toEqual(rendered('@one/feature'));
    });

    it('граница по сегменту: /src/features не покрывает /src/features-old', () => {
        const aliases: Alias[] = [{ prefix: '@features', anchor: '/src/features', star: true }];

        expect(renderAliasPath('/src/features-old', aliases)).toBeNull();
    });

    it('граница по сегменту: при широком алиасе путь остается покрыт им', () => {
        const narrow: Alias = { prefix: '@features', anchor: '/src/features', star: true };
        const wide: Alias = { prefix: '@', anchor: '/src', star: true };

        expect(renderAliasPath('/src/features-old', [narrow, wide])).toEqual(
            rendered('@/features-old'),
        );
    });

    it('ни один алиас не покрывает путь → null', () => {
        const aliases: Alias[] = [{ prefix: '@', anchor: '/src', star: true }];

        expect(renderAliasPath('/test/feature', aliases)).toBeNull();
    });

    it('пустой список алиасов → null', () => {
        expect(renderAliasPath('/src/feature/internal', [])).toBeNull();
    });

    it('алиас на корень репозитория покрывает любой путь', () => {
        const aliases: Alias[] = [{ prefix: '@', anchor: '/', star: true }];

        expect(renderAliasPath('/src/feature/internal', aliases)).toEqual(
            rendered('@/src/feature/internal'),
        );
    });

    it('беззвездочный корневой алиас не покрывает поддерево → null', () => {
        // Та же годность, что и в `renderSpecifier`: точный ключ (`'@root': ['.']`) выражает только
        // собственный якорь, поэтому поддерево ему не отдается — специфаер был бы нерезолвимым.
        const aliases: Alias[] = [{ prefix: '@root', anchor: '/', star: false }];

        expect(renderAliasPath('/src/feature/internal', aliases)).toBeNull();
        expect(renderAliasPath('/', aliases)).toEqual(rendered('@root'));
    });

    it('самый длинный из нескольких: корневой алиас не перебивает точный', () => {
        const root: Alias = { prefix: '@', anchor: '/', star: true };
        const exact: Alias = { prefix: '@feature', anchor: '/src/feature', star: true };

        expect(renderAliasPath('/src/feature/internal', [root, exact])).toEqual(
            rendered('@feature/internal'),
        );
    });
});
