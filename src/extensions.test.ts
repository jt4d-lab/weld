import { describe, expect, it } from 'vitest';

import {
    ENTRY_EXTENSIONS,
    entryFileName,
    isEntryFileName,
    isModuleExtension,
} from '@/extensions.js';

describe('ENTRY_EXTENSIONS', () => {
    it('содержит все ожидаемые расширения', () => {
        expect(ENTRY_EXTENSIONS).toEqual(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs']);
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
