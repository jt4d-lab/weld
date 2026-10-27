import { describe, expect, it } from 'vitest';

import type { ConfigData, InspectData } from './render.js';
import { renderConfig, renderInspect, renderJson } from './render.js';

/** `ESC` из литерала не собрать: правило `no-control-regex` запрещает control-символы в регэкспе. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** Текст без color-escape-последовательностей: так проверяется, что цвет не меняет сам вывод. */
function plain(text: string): string {
    return text.replace(ANSI, '');
}

const INSPECT: InspectData = {
    file: '/repo/src/feature/internal.ts',
    alias: '@/feature/internal.ts',
};

const CONFIG: ConfigData = {
    file: '/repo/src/feature/index.ts',
    settings: {
        repoRoot: '/repo',
        aliasesBaseUrl: '.',
        tsconfig: 'tsconfig.json',
        aliases: [{ prefix: '@', anchor: '/src' }],
    },
};

describe('renderInspect', () => {
    it('печатает путь файла и путь импорта, выровненные по подписям', () => {
        expect(renderInspect(INSPECT, { color: false })).toBe(
            ['file:  /repo/src/feature/internal.ts', 'alias: @/feature/internal.ts'].join('\n'),
        );
    });

    it('без алиаса печатает то, что подставила команда — виртуальный путь', () => {
        const output = renderInspect(
            { file: '/repo/src/feature/internal.ts', alias: '/src/feature/internal.ts' },
            { color: false },
        );

        expect(output).toContain('alias: /src/feature/internal.ts');
    });

    it('color: false дает текст без escape-последовательностей', () => {
        const output = renderInspect(INSPECT, { color: false });

        expect(plain(output)).toBe(output);
    });

    it('color: true добавляет цвет, не меняя текст', () => {
        const colored = renderInspect(INSPECT, { color: true });

        expect(plain(colored)).not.toBe(colored);
        expect(plain(colored)).toBe(renderInspect(INSPECT, { color: false }));
    });
});

describe('renderConfig: файл', () => {
    it('печатает настройки без пометки сэмпла', () => {
        expect(renderConfig(CONFIG, { color: false })).toBe(
            [
                'file:  /repo/src/feature/index.ts',
                'settings.weld:',
                '  repoRoot:       /repo',
                '  aliasesBaseUrl: .',
                '  tsconfig:       tsconfig.json',
                '  aliases:',
                '    @/* → /src/*',
            ].join('\n'),
        );
    });

    it('пустые алиасы — явное (none) в строке подписи', () => {
        const output = renderConfig(
            { ...CONFIG, settings: { ...CONFIG.settings, aliases: [] } },
            { color: false },
        );

        expect(output).toContain('\n  aliases: (none)');
    });

    it('несколько алиасов печатаются каждый на своей строке', () => {
        const output = renderConfig(
            {
                ...CONFIG,
                settings: {
                    ...CONFIG.settings,
                    aliases: [
                        { prefix: '@', anchor: '/src' },
                        { prefix: '@app', anchor: '/src/app' },
                    ],
                },
            },
            { color: false },
        );

        expect(output.split('\n').slice(-2)).toEqual([
            '    @/* → /src/*',
            '    @app/* → /src/app/*',
        ]);
    });

    it('color: false дает текст без escape-последовательностей', () => {
        const output = renderConfig(CONFIG, { color: false });

        expect(plain(output)).toBe(output);
    });
});

describe('renderConfig: директория', () => {
    it('показывает сэмпл и аргумент директории в том виде, как его ввели', () => {
        const output = renderConfig({ ...CONFIG, sampleOf: 'src/feature' }, { color: false });

        expect(output.split('\n')[0]).toBe(
            'file:  /repo/src/feature/index.ts (sample of src/feature)',
        );
    });

    it('пометка сэмпла приглушенная, путь файла — нет', () => {
        const colored = renderConfig({ ...CONFIG, sampleOf: 'src/feature' }, { color: true });

        expect(plain(colored)).not.toBe(colored);
        expect(plain(colored)).toBe(
            renderConfig({ ...CONFIG, sampleOf: 'src/feature' }, { color: false }),
        );
    });
});

describe('renderJson', () => {
    it('inspect с алиасом', () => {
        expect(renderJson({ file: INSPECT.file, alias: INSPECT.alias })).toBe(
            `{\n  "file": "/repo/src/feature/internal.ts",\n  "alias": "@/feature/internal.ts"\n}`,
        );
    });

    it('inspect без алиаса — alias: null', () => {
        expect(renderJson({ file: '/repo/src/a.ts', alias: null })).toBe(
            `{\n  "file": "/repo/src/a.ts",\n  "alias": null\n}`,
        );
    });

    it('config для файла без sampleOf', () => {
        const value = {
            file: CONFIG.file,
            settings: CONFIG.settings,
        };

        expect(JSON.parse(renderJson(value))).toEqual(value);
        expect(renderJson(value)).not.toContain('sampleOf');
    });

    it('config для директории: sampleOf и алиасы парами prefix/anchor', () => {
        const output = renderJson({ ...CONFIG, sampleOf: 'src/feature' });

        expect(JSON.parse(output)).toEqual({
            file: '/repo/src/feature/index.ts',
            sampleOf: 'src/feature',
            settings: {
                repoRoot: '/repo',
                aliasesBaseUrl: '.',
                tsconfig: 'tsconfig.json',
                aliases: [{ prefix: '@', anchor: '/src' }],
            },
        });
    });
});
