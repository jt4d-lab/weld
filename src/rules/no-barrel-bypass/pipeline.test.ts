import { describe, expect, it } from 'vitest';

import { fakeHasEntryPoint } from '@/host/index.js';
import type { Alias } from '@/settings/index.js';

import { createChecker } from '@/rules/no-barrel-bypass/pipeline.js';

const fromFile = '/repo/src/feature/util.ts';

/** Проверка поверх фейкового диска: список файлов + необязательные алиасы. */
function checker(files: string[], aliases: Alias[] = []): (specifier: string) => string | null {
    return createChecker({ fromFile, aliases }, { hasEntryPoint: fakeHasEntryPoint(files) });
}

const barrelFiles = ['/repo/src/other/index.ts'];
const otherAlias: Alias[] = [{ prefix: '@other', anchor: '/repo/src/other' }];

describe('checkImport — сквозная связка', () => {
    it('нарушение с относительным импортом', () => {
        expect(checker(barrelFiles)('../other/internal')).toBe('../other');
    });

    it('то же нарушение через алиас — тот же D, другой suggestion', () => {
        expect(checker(barrelFiles, otherAlias)('@other/internal')).toBe('@other');
    });

    it('импорт с явным расширением → правка через index.<то же расширение>', () => {
        expect(checker(barrelFiles)('../other/internal.js')).toBe('../other/index.js');
    });

    it('то же через алиас — расширение сохраняется и в алиасной форме', () => {
        expect(checker(barrelFiles, otherAlias)('@other/internal.ts')).toBe('@other/index.ts');
    });

    it('специфаер, отсечённый parseSpecifier (голый пакет) — ok', () => {
        expect(checker(barrelFiles)('lodash')).toBeNull();
    });

    it('граница не найдена — ok', () => {
        expect(checker([])('../other/internal')).toBeNull();
    });

    it('одна проверка обслуживает все специфаеры файла', () => {
        const check = checker(barrelFiles);

        expect(check('../other/internal.ts')).toBe('../other/index.ts');
        expect(check('../sibling/thing.ts')).toBeNull();
    });
});
