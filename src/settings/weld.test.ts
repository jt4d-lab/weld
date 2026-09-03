import { describe, expect, it } from 'vitest';

import { createWeldSettings } from './weld.js';

const cwd = '/repo';

describe('createWeldSettings().getAliases: отсутствие settings.weld', () => {
    it('нет settings.weld — пустой массив', () => {
        expect(createWeldSettings({}, cwd).getAliases()).toEqual([]);
    });

    it('settings совсем не задан — пустой массив', () => {
        expect(createWeldSettings(undefined, cwd).getAliases()).toEqual([]);
    });
});

describe('createWeldSettings().getAliases: исключения валидации', () => {
    it('aliases не объект', () => {
        const settings = { weld: { aliases: 'nope' } };
        expect(() => createWeldSettings(settings, cwd).getAliases()).toThrow();
    });

    it('значение не строка и не массив — текст называет ключ', () => {
        const settings = { weld: { aliases: { '@x': 42 } } };
        expect(() => createWeldSettings(settings, cwd).getAliases()).toThrow(/@x/);
    });

    it('элемент массива не строка — текст называет ключ', () => {
        const settings = { weld: { aliases: { '@x': ['src/x', 42] } } };
        expect(() => createWeldSettings(settings, cwd).getAliases()).toThrow(/@x/);
    });
});

describe('createWeldSettings().getAliases: WeakMap-кэш', () => {
    it('повторный вызов с тем же объектом settings.weld возвращает ту же ссылку', () => {
        const settings = { weld: { aliases: { '@src/*': ['src/*'] } } };
        const weldSettings = createWeldSettings(settings, cwd);
        const first = weldSettings.getAliases();
        const second = weldSettings.getAliases();
        expect(first).toBe(second);
    });

    it('разные объекты settings.weld не делят кэш', () => {
        const settingsA = { weld: { aliases: { '@src/*': ['src/*'] } } };
        const settingsB = { weld: { aliases: { '@src/*': ['src/*'] } } };
        const first = createWeldSettings(settingsA, cwd).getAliases();
        const second = createWeldSettings(settingsB, cwd).getAliases();
        expect(first).not.toBe(second);
        expect(first).toEqual(second);
    });
});
