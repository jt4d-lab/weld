import { describe, expect, it } from 'vitest';

import type { RawScheme, SchemeField } from '@/settings/layers.js';
import { parseScheme, parseSchemeReport } from '@/settings/layers.js';

/** Схема, которую разбирает каждый тест, если он не переопределил поле. */
const validScheme: RawScheme = {
    srcDir: 'src',
    modulesDir: 'modules',
    layers: ['app', '@modules'],
    moduleLayers: ['features'],
    flatModules: false,
};

function settingsSource(field: SchemeField): string {
    return `settings.weld.${field}`;
}

function parse(
    raw: Partial<RawScheme>,
    sourceOf: (field: SchemeField) => string = settingsSource,
): ReturnType<typeof parseScheme> {
    return parseScheme({ ...validScheme, ...raw }, sourceOf);
}

describe('parseScheme — значения', () => {
    it('srcDir нормализуется в виртуальный путь', () => {
        expect(parse({ srcDir: './source/./code/' }).srcDir).toBe('/source/code');
    });

    it("srcDir: '.' — корень репозитория", () => {
        expect(parse({ srcDir: '.' }).srcDir).toBe('/');
    });

    it('modulesDir возвращается как задан', () => {
        expect(parse({ modulesDir: 'mods' }).modulesDir).toBe('mods');
    });

    it('точка внутри имени директории модулей допустима', () => {
        expect(parse({ modulesDir: 'mod.v2' }).modulesDir).toBe('mod.v2');
    });

    it('точка внутри имени слоя допустима', () => {
        expect(parse({ layers: ['app.v2', '@modules'], moduleLayers: ['widgets.ui'] })).toEqual({
            srcDir: '/src',
            modulesDir: 'modules',
            layers: ['app.v2', '@modules'],
            moduleLayers: ['widgets.ui'],
            flatModules: false,
        });
    });

    it('метки стоят в layers на своих местах', () => {
        expect(parse({ layers: ['app', '@unknown', '@modules', 'common'] }).layers).toEqual([
            'app',
            '@unknown',
            '@modules',
            'common',
        ]);
    });

    it('порядок и повторы обычных имен сохраняются', () => {
        const scheme = parse({
            layers: ['app', 'pages', 'app', '@modules'],
            moduleLayers: ['widgets', 'features', 'features'],
        });

        expect(scheme.layers).toEqual(['app', 'pages', 'app', '@modules']);
        expect(scheme.moduleLayers).toEqual(['widgets', 'features', 'features']);
    });

    it('разобранная схема не делит массивы со значениями конфига', () => {
        const layers = ['app', '@modules'];
        const raw: RawScheme = { ...validScheme, layers };

        expect(parseScheme(raw, settingsSource).layers).not.toBe(layers);
    });
});

describe('parseScheme — srcDir', () => {
    it('не строка → исключение называет тип', () => {
        expect(() => parse({ srcDir: 42 })).toThrow(
            'settings.weld.srcDir must be a string, got number',
        );
    });

    it('путь выше корня → исключение', () => {
        expect(() => parse({ srcDir: '../src' })).toThrow(
            'settings.weld.srcDir must not point above the repository root, got "../src"',
        );
    });
});

describe('parseScheme — modulesDir', () => {
    it('не строка → исключение называет тип', () => {
        expect(() => parse({ modulesDir: 42 })).toThrow(
            'settings.weld.modulesDir must be a string, got number',
        );
    });

    it('пустая строка → исключение про пустоту', () => {
        expect(() => parse({ modulesDir: '' })).toThrow(
            'settings.weld.modulesDir must not be empty',
        );
    });

    it.each(['.', '..', 'a/b', 'a\\b', '@mods', 'mod:s'])(
        'недопустимое имя "%s" → исключение',
        (modulesDir) => {
            expect(() => parse({ modulesDir })).toThrow(
                `settings.weld.modulesDir must be a single directory name without "/", "\\", "@" or ":", not "." or "..", got "${modulesDir}"`,
            );
        },
    );
});

describe('parseScheme — обязательность списков', () => {
    it('нет layers → исключение', () => {
        expect(() => parse({ layers: undefined })).toThrow('settings.weld.layers is required');
    });

    it('нет moduleLayers → исключение', () => {
        expect(() => parse({ moduleLayers: undefined })).toThrow(
            'settings.weld.moduleLayers is required',
        );
    });

    it('пустой layers → исключение', () => {
        expect(() => parse({ layers: [] })).toThrow('settings.weld.layers must not be empty');
    });

    it('пустой moduleLayers → исключение', () => {
        expect(() => parse({ moduleLayers: [] })).toThrow(
            'settings.weld.moduleLayers must not be empty',
        );
    });

    it('layers не массив → исключение называет тип', () => {
        expect(() => parse({ layers: 'app' })).toThrow(
            'settings.weld.layers must be an array of strings, got string',
        );
    });

    it('moduleLayers не массив → исключение называет тип', () => {
        expect(() => parse({ moduleLayers: 42 })).toThrow(
            'settings.weld.moduleLayers must be an array of strings, got number',
        );
    });

    it('нестроковый элемент → исключение с индексом', () => {
        expect(() => parse({ layers: ['app', 42] })).toThrow(
            'settings.weld.layers[1] must be a string, got number',
        );
    });

    it('нестроковый элемент moduleLayers → исключение с индексом', () => {
        expect(() => parse({ moduleLayers: ['features', 42] })).toThrow(
            'settings.weld.moduleLayers[1] must be a string, got number',
        );
    });
});

describe('parseScheme — имена слоев и метки', () => {
    it.each(['1app', '-app', 'a/b', 'a b', '@foo', ''])(
        'недопустимое имя слоя "%s" → исключение с индексом',
        (name) => {
            expect(() => parse({ layers: ['app', name, '@modules'] })).toThrow(
                `settings.weld.layers[1] is not a valid layer name: "${name}"`,
            );
        },
    );

    it('метка в moduleLayers → исключение', () => {
        expect(() => parse({ moduleLayers: ['features', '@unknown'] })).toThrow(
            'settings.weld.moduleLayers[1]: "@unknown" marker is not allowed here',
        );
    });

    it('недопустимое имя в moduleLayers → исключение с индексом', () => {
        expect(() => parse({ moduleLayers: ['features', '1bad'] })).toThrow(
            'settings.weld.moduleLayers[1] is not a valid layer name: "1bad"',
        );
    });

    it('нелатинское имя слоя допустимо', () => {
        expect(parse({ layers: ['слой', '@modules'] }).layers).toEqual(['слой', '@modules']);
    });

    it('повтор метки в layers → исключение', () => {
        expect(() => parse({ layers: ['app', '@modules', '@unknown', '@modules'] })).toThrow(
            'settings.weld.layers[3]: "@modules" marker is allowed only once',
        );
    });

    it('имя слоя проекта не может совпадать с modulesDir', () => {
        expect(() => parse({ layers: ['app', 'modules', '@modules'] })).toThrow(
            'settings.weld.layers[1]: "modules" must not be the modulesDir name',
        );
    });

    it('имя слоя модуля не может совпадать с modulesDir', () => {
        expect(() => parse({ modulesDir: 'mods', moduleLayers: ['mods'] })).toThrow(
            'settings.weld.moduleLayers[0]: "mods" must not be the modulesDir name',
        );
    });

    it('общее имя в обоих списках → исключение называет оба источника', () => {
        expect(() =>
            parse({ layers: ['app', '@modules', 'shared'], moduleLayers: ['shared'] }),
        ).toThrow('settings.weld.moduleLayers[0]: "shared" is also listed in settings.weld.layers');
    });

    it('без метки @modules в layers moduleLayers не принимается', () => {
        expect(() => parse({ layers: ['app', 'pages'] })).toThrow(
            'settings.weld.layers must contain the "@modules" marker',
        );
    });
});

describe('parseScheme — flatModules', () => {
    it('true сохраняется как есть', () => {
        expect(parse({ flatModules: true }).flatModules).toBe(true);
    });

    it('false сохраняется как есть', () => {
        expect(parse({ flatModules: false }).flatModules).toBe(false);
    });

    it('не boolean → исключение называет settings.weld.flatModules', () => {
        expect(() => parse({ flatModules: 'yes' })).toThrow(
            'settings.weld.flatModules must be a boolean, got string',
        );
    });

    it('не boolean из опций → исключение называет options.flatModules', () => {
        expect(() => parse({ flatModules: 1 }, (field) => `options.${field}`)).toThrow(
            'options.flatModules must be a boolean, got number',
        );
    });

    it('не boolean независимо от ошибок списков', () => {
        expect(() => parse({ layers: ['app', '@modules'], flatModules: 'no' })).toThrow(
            'settings.weld.flatModules must be a boolean, got string',
        );
    });

    it('обратный порядок: кривой список бьет кривое flatModules — списки разбираются раньше', () => {
        expect(() => parse({ layers: ['app', '9bad'], flatModules: 'no' })).toThrow(
            'settings.weld.layers[1] is not a valid layer name: "9bad"',
        );
    });

    it('flatModules не мешает другим полям', () => {
        expect(parse({ flatModules: true }).modulesDir).toBe('modules');
    });
});

describe('parseScheme — источники значений', () => {
    it('ошибка значения из опций называет options.<поле>', () => {
        expect(() => parse({ layers: [] }, (field) => `options.${field}`)).toThrow(
            'options.layers must not be empty',
        );
    });

    it('пересечение списков из разных источников называет оба', () => {
        const fromSettings = (field: SchemeField): string =>
            field === 'layers' ? 'settings.weld.layers' : `options.${field}`;

        expect(() =>
            parse(
                { layers: ['app', '@modules', 'shared'], moduleLayers: ['shared'] },
                fromSettings,
            ),
        ).toThrow('options.moduleLayers[0]: "shared" is also listed in settings.weld.layers');
    });
});

describe('parseSchemeReport — состояния', () => {
    function report(
        raw: Partial<RawScheme>,
        sourceOf: (field: SchemeField) => string = settingsSource,
    ) {
        return parseSchemeReport({ ...validScheme, ...raw }, sourceOf);
    }

    it('валидная схема — все поля value', () => {
        const result = report({});

        expect(result.srcDir).toEqual({ status: 'value', value: '/src' });
        expect(result.modulesDir).toEqual({ status: 'value', value: 'modules' });
        expect(result.layers).toEqual({ status: 'value', value: ['app', '@modules'] });
        expect(result.moduleLayers).toEqual({ status: 'value', value: ['features'] });
        expect(result.flatModules).toEqual({ status: 'value', value: false });
    });

    it('нет layers → not set, остальные поля не ломаются', () => {
        const result = report({ layers: undefined });

        expect(result.layers).toEqual({ status: 'not-set' });
        expect(result.moduleLayers.status).toBe('value');
    });

    it('нет moduleLayers → not set, остальные поля не ломаются', () => {
        const result = report({ moduleLayers: undefined });

        expect(result.moduleLayers).toEqual({ status: 'not-set' });
        expect(result.layers.status).toBe('value');
    });

    it('отсутствие одного списка не делает другим ошибкой: layers без @modules и нет moduleLayers — value', () => {
        const result = report({ layers: ['app'], moduleLayers: undefined });

        expect(result.layers).toEqual({ status: 'value', value: ['app'] });
        expect(result.moduleLayers).toEqual({ status: 'not-set' });
    });

    it('обратная сторона: moduleLayers без пары layers — value, layers — not set', () => {
        const result = report({ layers: undefined, moduleLayers: ['features'] });

        expect(result.moduleLayers).toEqual({ status: 'value', value: ['features'] });
        expect(result.layers).toEqual({ status: 'not-set' });
    });

    it('оба списка отсутствуют → оба not set, без ошибок', () => {
        const result = report({ layers: undefined, moduleLayers: undefined });

        expect(result.layers).toEqual({ status: 'not-set' });
        expect(result.moduleLayers).toEqual({ status: 'not-set' });
        expect(result.srcDir.status).toBe('value');
        expect(result.modulesDir.status).toBe('value');
    });

    it('невалидный srcDir получает собственную ошибку', () => {
        const result = report({ srcDir: 42 });

        expect(result.srcDir).toEqual({
            status: 'invalid',
            message: 'settings.weld.srcDir must be a string, got number',
        });
    });

    it('невалидный modulesDir получает собственную ошибку', () => {
        const result = report({ modulesDir: 'a/b' });

        expect(result.modulesDir).toEqual({
            status: 'invalid',
            message:
                'settings.weld.modulesDir must be a single directory name without "/", "\\", "@" or ":", not "." or "..", got "a/b"',
        });
    });

    it('невалидное имя слоя получает сообщение с индексом', () => {
        const result = report({ layers: ['app', '1bad', '@modules'] });

        expect(result.layers).toEqual({
            status: 'invalid',
            message: 'settings.weld.layers[1] is not a valid layer name: "1bad"',
        });
    });

    it('метка в moduleLayers — ошибка этого поля', () => {
        const result = report({ moduleLayers: ['features', '@unknown'] });

        expect(result.moduleLayers).toEqual({
            status: 'invalid',
            message: 'settings.weld.moduleLayers[1]: "@unknown" marker is not allowed here',
        });
    });

    it('несколько собственных ошибок не прячутся друг под другом', () => {
        const result = report({
            srcDir: 1,
            modulesDir: 2,
            layers: ['app', 3, '@modules'],
            moduleLayers: ['features', 4],
        });

        expect(result.srcDir.status).toBe('invalid');
        expect(result.modulesDir.status).toBe('invalid');
        expect(result.layers).toEqual({
            status: 'invalid',
            message: 'settings.weld.layers[1] must be a string, got number',
        });
        expect(result.moduleLayers).toEqual({
            status: 'invalid',
            message: 'settings.weld.moduleLayers[1] must be a string, got number',
        });
    });

    it('корректное поле, зависящее от кривого modulesDir, получает unresolved', () => {
        const result = report({ modulesDir: 42, layers: ['app', '@modules'] });

        expect(result.modulesDir.status).toBe('invalid');
        expect(result.layers).toEqual({ status: 'unresolved', dependency: 'modulesDir' });
    });

    it('корректное поле, зависящее от кривого modulesDir, получает unresolved даже при невалидном srcDir', () => {
        const result = report({
            srcDir: 1,
            modulesDir: 2,
            layers: ['app', '@modules'],
            moduleLayers: ['features'],
        });

        expect(result.srcDir.status).toBe('invalid');
        expect(result.modulesDir.status).toBe('invalid');
        expect(result.layers).toEqual({ status: 'unresolved', dependency: 'modulesDir' });
        expect(result.moduleLayers).toEqual({ status: 'unresolved', dependency: 'modulesDir' });
    });

    it('собственная ошибка списка имеет приоритет над unresolved', () => {
        const result = report({ modulesDir: 42, layers: ['app', 'bad name', '@modules'] });

        expect(result.modulesDir.status).toBe('invalid');
        expect(result.layers).toEqual({
            status: 'invalid',
            message: 'settings.weld.layers[1] is not a valid layer name: "bad name"',
        });
    });

    it('отсутствие @modules — ошибка прикрепляется к layers', () => {
        const result = report({ layers: ['app', 'pages'] });

        expect(result.layers).toEqual({
            status: 'invalid',
            message: 'settings.weld.layers must contain the "@modules" marker',
        });
        expect(result.moduleLayers.status).toBe('value');
    });

    it('общее имя в списках — ошибка прикрепляется к moduleLayers', () => {
        const result = report({ layers: ['app', '@modules', 'shared'], moduleLayers: ['shared'] });

        expect(result.layers.status).toBe('value');
        expect(result.moduleLayers).toEqual({
            status: 'invalid',
            message:
                'settings.weld.moduleLayers[0]: "shared" is also listed in settings.weld.layers',
        });
    });

    it('ошибка общего имени называет источник обоих списков', () => {
        const fromSettings = (field: SchemeField): string =>
            field === 'layers' ? 'settings.weld.layers' : `options.${field}`;

        const result = parseSchemeReport(
            { ...validScheme, layers: ['app', '@modules', 'shared'], moduleLayers: ['shared'] },
            fromSettings,
        );

        expect(result.moduleLayers).toEqual({
            status: 'invalid',
            message: 'options.moduleLayers[0]: "shared" is also listed in settings.weld.layers',
        });
    });
});
