import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpProjects, makeTmpProject } from '@/testing/index.js';

import { loadLintSettings } from './eslint-config.js';

/**
 * Чужой проект на реальном диске: ESLint читает конфиг с диска, поэтому временный проект — самый
 * честный полигон. `settings.weld` лежит в конфиге, чтобы проверять не только факт «конфиг найден»,
 * но и то, что наружу уходят именно настройки.
 */
const CONFIG = `export default [
    {
        files: ['**/*.js'],
        settings: { weld: { aliases: { '@/*': ['src/*'] } } },
    },
    { ignores: ['ignored/**', '**/generated/**'] },
];
`;

const WELD_SETTINGS = { weld: { aliases: { '@/*': ['src/*'] } } };

afterEach(() => {
    cleanupTmpProjects();
});

describe('loadLintSettings: файл', () => {
    it('отдает filePath и settings из эффективного конфига, без sampleOf', async () => {
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        const result = await loadLintSettings('src/a.js', root);

        expect(result).toEqual({
            filePath: `${root}/src/a.js`,
            settings: WELD_SETTINGS,
        });
        expect(result.sampleOf).toBeUndefined();
    });

    it('абсолютный путь тоже принимается', async () => {
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        const result = await loadLintSettings(`${root}/src/a.js`, root);

        expect(result.filePath).toBe(`${root}/src/a.js`);
    });

    it('файл игнорируется конфигом → ошибка', async () => {
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG, 'ignored/a.js': '' });

        await expect(loadLintSettings('ignored/a.js', root)).rejects.toThrow(
            `eslint ignores ignored/a.js`,
        );
    });

    it('пути нет → ошибка', async () => {
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG });

        await expect(loadLintSettings('src/missing.js', root)).rejects.toThrow(
            'path does not exist: src/missing.js',
        );
    });

    it('проект без ESLint-конфига → ошибка про конфиг', async () => {
        const root = makeTmpProject({ 'src/a.js': '' });

        await expect(loadLintSettings('src/a.js', root)).rejects.toThrow(
            'no eslint config found for src/a.js',
        );
    });
});

describe('loadLintSettings: директория', () => {
    it('берет первый по алфавиту файл и помечает его как сэмпл', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/b.js': '',
            'src/a.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result).toEqual({
            filePath: `${root}/src/a.js`,
            settings: WELD_SETTINGS,
            sampleOf: 'src',
        });
    });

    it('спускается во вложенные директории в алфавитном порядке', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/b.js': '',
            'src/a/deep.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(`${root}/src/a/deep.js`);
    });

    it('пропускает node_modules и dot-директории', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/node_modules/pkg/a.js': '',
            'src/.cache/b.js': '',
            'src/z.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(`${root}/src/z.js`);
    });

    it('игнорируемый файл пропускается, сэмплом становится следующий', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/generated/a.js': '',
            'src/b.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(`${root}/src/b.js`);
    });

    it('файлы без модульных расширений сэмплом не считаются', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/style.css': '',
            'src/data.json': '',
            'src/main.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(`${root}/src/main.js`);
    });

    it('пустая директория → ошибка', async () => {
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG, 'src/keep.txt': '' });

        await expect(loadLintSettings('src', root)).rejects.toThrow('no lintable files in src');
    });

    it('каталог вместо файла без линтуемых файлов → ошибка', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/style.css': '',
            'src/data.json': '',
        });

        await expect(loadLintSettings('src', root)).rejects.toThrow('no lintable files in src');
    });

    it('проект без ESLint-конфига → ошибка про конфиг', async () => {
        const root = makeTmpProject({ 'src/a.js': '' });

        await expect(loadLintSettings('src', root)).rejects.toThrow(
            'no eslint config found for src',
        );
    });
});
