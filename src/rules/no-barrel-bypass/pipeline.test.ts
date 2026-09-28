import { describe, expect, it } from 'vitest';

import { createFakeFsHost } from '@/host/index.js';
import type { Alias } from '@/settings/index.js';

import type { CheckDecision } from '@/rules/no-barrel-bypass/pipeline.js';
import { createChecker } from '@/rules/no-barrel-bypass/pipeline.js';

const fromFile = '/repo/src/feature/util.ts';

/** Проверка поверх фейкового диска: список файлов + необязательные алиасы. */
function checker(files: string[], aliases: Alias[] = []): (specifier: string) => CheckDecision {
    return createChecker({ fromFile, aliases }, createFakeFsHost(files));
}

const barrelFiles = ['/repo/src/other/index.ts'];
const otherAlias: Alias[] = [{ prefix: '@other', anchor: '/repo/src/other' }];

describe('checkImport — нарушение и замена', () => {
    it('нарушение с относительным импортом', () => {
        expect(checker(barrelFiles)('../other/internal')).toEqual({
            kind: 'replace',
            target: '/repo/src/other/internal',
            barrier: '/repo/src/other',
            suggestion: '../other',
        });
    });

    it('то же нарушение через алиас — тот же D, другой suggestion', () => {
        expect(checker(barrelFiles, otherAlias)('@other/internal')).toEqual({
            kind: 'replace',
            target: '/repo/src/other/internal',
            barrier: '/repo/src/other',
            suggestion: '@other',
        });
    });

    it('импорт с явным расширением → правка через index.<то же расширение>', () => {
        expect(checker(barrelFiles)('../other/internal.js')).toEqual({
            kind: 'replace',
            target: '/repo/src/other/internal.js',
            barrier: '/repo/src/other',
            suggestion: '../other/index.js',
        });
    });

    it('то же через алиас — расширение сохраняется и в алиасной форме', () => {
        expect(checker(barrelFiles, otherAlias)('@other/internal.ts')).toEqual({
            kind: 'replace',
            target: '/repo/src/other/internal.ts',
            barrier: '/repo/src/other',
            suggestion: '@other/index.ts',
        });
    });
});

describe('checkImport — пропуск с причиной', () => {
    it('голый пакет — external-dependency', () => {
        expect(checker(barrelFiles)('lodash')).toEqual({
            kind: 'skip',
            reason: 'external-dependency',
        });
    });

    it('импорт ассета — asset, даже если рядом баррель', () => {
        const files = ['/repo/src/other/index.ts', '/repo/src/other/logo.svg'];

        expect(checker(files)('../other/logo.svg')).toEqual({ kind: 'skip', reason: 'asset' });
    });

    it('имя с точкой — та же проверка, что и у ассетов', () => {
        expect(checker(barrelFiles)('./account.entity')).toEqual({
            kind: 'skip',
            reason: 'asset',
        });
    });
});

describe('checkImport — нарушения нет', () => {
    it('граница не найдена', () => {
        expect(checker([])('../other/internal')).toEqual({
            kind: 'intact',
            target: '/repo/src/other/internal',
        });
    });

    it('импорт в своей директории', () => {
        expect(checker(barrelFiles)('./sibling')).toEqual({
            kind: 'intact',
            target: '/repo/src/feature/sibling',
        });
    });

    it('импорт наверх', () => {
        expect(checker(barrelFiles)('..')).toEqual({ kind: 'intact', target: '/repo/src' });
    });

    it('импорт самой точки входа', () => {
        expect(checker(barrelFiles)('../other/index')).toEqual({
            kind: 'intact',
            target: '/repo/src/other/index',
        });
    });
});

describe('checkImport — одна проверка на все специфаеры файла', () => {
    it('решение зависит только от специфаера, состояние проверки не копится', () => {
        const check = checker(barrelFiles);

        expect(check('../other/internal.ts')).toEqual({
            kind: 'replace',
            target: '/repo/src/other/internal.ts',
            barrier: '/repo/src/other',
            suggestion: '../other/index.ts',
        });
        expect(check('../sibling/thing.ts')).toEqual({
            kind: 'intact',
            target: '/repo/src/sibling/thing.ts',
        });
    });
});
