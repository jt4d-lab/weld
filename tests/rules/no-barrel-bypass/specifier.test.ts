import { describe, expect, it } from 'vitest';

import { parseSpecifier } from '../../../src/rules/no-barrel-bypass/specifier.js';
import type { Alias } from '../../../src/settings/aliases.js';

const fromDir = '/repo/src/feature';

describe('parseSpecifier: относительные формы', () => {
    it('./x — резолвится от fromDir, форма relative', () => {
        const result = parseSpecifier('./x', fromDir, []);
        expect(result).toEqual({ path: '/repo/src/feature/x', form: { kind: 'relative' } });
    });

    it('../x — резолвится от fromDir, форма relative', () => {
        const result = parseSpecifier('../x', fromDir, []);
        expect(result).toEqual({ path: '/repo/src/x', form: { kind: 'relative' } });
    });

    it('. — резолвится от fromDir, форма relative', () => {
        const result = parseSpecifier('.', fromDir, []);
        expect(result).toEqual({ path: '/repo/src/feature', form: { kind: 'relative' } });
    });

    it('.. — резолвится от fromDir, форма relative', () => {
        const result = parseSpecifier('..', fromDir, []);
        expect(result).toEqual({ path: '/repo/src', form: { kind: 'relative' } });
    });
});

describe('parseSpecifier: алиасы', () => {
    const aliases: Alias[] = [
        { prefix: '@src', anchor: '/repo/src' },
        { prefix: '@pkg', anchor: '/repo/packages/pkg' },
    ];

    it('точное совпадение с префиксом', () => {
        const result = parseSpecifier('@src', fromDir, aliases);
        expect(result).toEqual({
            path: '/repo/src',
            form: { kind: 'alias', alias: { prefix: '@src', anchor: '/repo/src' } },
        });
    });

    it('префикс с хвостом', () => {
        const result = parseSpecifier('@src/feature/thing', fromDir, aliases);
        expect(result).toEqual({
            path: '/repo/src/feature/thing',
            form: { kind: 'alias', alias: { prefix: '@src', anchor: '/repo/src' } },
        });
    });

    it('беззвёздочная запись с хвостом (@pkg/internal/x) трактуется как префиксная', () => {
        const result = parseSpecifier('@pkg/internal/x', fromDir, aliases);
        expect(result).toEqual({
            path: '/repo/packages/pkg/internal/x',
            form: { kind: 'alias', alias: { prefix: '@pkg', anchor: '/repo/packages/pkg' } },
        });
    });

    it('выигрывает самый длинный подходящий префикс', () => {
        const overlapping: Alias[] = [
            { prefix: '@a', anchor: '/repo/a' },
            { prefix: '@a/b', anchor: '/repo/b' },
        ];
        const result = parseSpecifier('@a/b/x', fromDir, overlapping);
        expect(result).toEqual({
            path: '/repo/b/x',
            form: { kind: 'alias', alias: { prefix: '@a/b', anchor: '/repo/b' } },
        });
    });

    it('при равных префиксах выигрывает первая запись по порядку объявления', () => {
        const duplicated: Alias[] = [
            { prefix: '@x', anchor: '/repo/first' },
            { prefix: '@x', anchor: '/repo/second' },
        ];
        const result = parseSpecifier('@x/thing', fromDir, duplicated);
        expect(result).toEqual({
            path: '/repo/first/thing',
            form: { kind: 'alias', alias: { prefix: '@x', anchor: '/repo/first' } },
        });
    });
});

describe('parseSpecifier: отсечение на входе', () => {
    it('голый пакет — null', () => {
        expect(parseSpecifier('lodash', fromDir, [])).toBeNull();
    });

    it('@scope/pkg без подходящего алиаса — null', () => {
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

    it('последний сегмент с расширением вне ENTRY_EXTENSIONS (./feature/internal/styles.css) — null', () => {
        expect(parseSpecifier('./feature/internal/styles.css', fromDir, [])).toBeNull();
    });
});

describe('parseSpecifier: расширения из ENTRY_EXTENSIONS не вызывают отсечения', () => {
    it('./feature/x.ts проверяется, а не отсекается', () => {
        const result = parseSpecifier('./feature/x.ts', fromDir, []);
        expect(result).toEqual({
            path: '/repo/src/feature/feature/x.ts',
            form: { kind: 'relative' },
        });
    });
});
