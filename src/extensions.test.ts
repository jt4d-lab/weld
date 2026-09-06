import { describe, expect, it } from 'vitest';

import {
    ENTRY_BASENAME,
    ENTRY_EXTENSIONS,
    MODULE_EXTENSIONS,
    entryFileName,
    isEntryExtension,
    isEntryFileName,
    isModuleExtension,
} from '@/extensions.js';

describe('ENTRY_BASENAME', () => {
    it('имя файла точки входа', () => {
        expect(ENTRY_BASENAME).toBe('index');
    });
});

describe('ENTRY_EXTENSIONS', () => {
    it('содержит все ожидаемые расширения', () => {
        expect(ENTRY_EXTENSIONS).toEqual(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs']);
    });
});

describe('MODULE_EXTENSIONS', () => {
    it('содержит все ожидаемые расширения', () => {
        expect(MODULE_EXTENSIONS).toEqual(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs']);
    });
});

describe('isEntryExtension', () => {
    it('true для расширения из списка', () => {
        expect(isEntryExtension('ts')).toBe(true);
    });

    it('false для расширения вне списка', () => {
        expect(isEntryExtension('css')).toBe(false);
    });

    it('false для пустой строки', () => {
        expect(isEntryExtension('')).toBe(false);
    });
});

describe('entryFileName', () => {
    it('дописывает расширение к имени точки входа', () => {
        expect(entryFileName('ts')).toBe('index.ts');
        expect(entryFileName('mjs')).toBe('index.mjs');
    });
});

describe('isEntryFileName', () => {
    it('index с известным расширением — точка входа', () => {
        expect(isEntryFileName('index', 'ts')).toBe(true);
    });

    it('другое имя с известным расширением — нет', () => {
        expect(isEntryFileName('internal', 'ts')).toBe(false);
    });

    it('index с чужим расширением — нет', () => {
        expect(isEntryFileName('index', 'css')).toBe(false);
    });

    it('index без расширения — нет', () => {
        expect(isEntryFileName('index', '')).toBe(false);
    });
});

describe('isModuleExtension', () => {
    it('true для расширения из списка', () => {
        expect(isModuleExtension('tsx')).toBe(true);
    });

    it('false для расширения вне списка', () => {
        expect(isModuleExtension('json')).toBe(false);
    });

    it('false для пустой строки', () => {
        expect(isModuleExtension('')).toBe(false);
    });
});
