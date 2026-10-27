import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpProjects, makeTmpProject } from '@/testing/index.js';

import { loadLintSettings } from './eslint-config.js';
import { makeCliProject } from './program.testing.js';

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
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        const result = await loadLintSettings('src/a.js', root);

        expect(result).toEqual({
            filePath: `${root}/src/a.js`,
            settings: WELD_SETTINGS,
        });
    });

    it('абсолютный путь тоже принимается', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        const result = await loadLintSettings(`${root}/src/a.js`, root);

        expect(result).toEqual({
            filePath: `${root}/src/a.js`,
            settings: WELD_SETTINGS,
        });
    });

    it('опции правила уходят наружу вместе с настройками', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': `const weld = {
    rules: {
        'no-barrel-bypass': { meta: { schema: [{ type: 'object' }] }, create: () => ({}) },
    },
};

export default [
    {
        files: ['**/*.js'],
        plugins: { weld },
        rules: { 'weld/no-barrel-bypass': ['error', { repoRoot: '.' }] },
    },
];
`,
            'src/a.js': '',
        });

        const result = await loadLintSettings('src/a.js', root);

        expect(result.options).toEqual({ repoRoot: '.' });
    });

    it('файл игнорируется конфигом → ошибка', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'ignored/a.js': '' });

        await expect(loadLintSettings('ignored/a.js', root)).rejects.toThrow(
            `eslint ignores ignored/a.js`,
        );
    });

    it('пути нет → ошибка', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG });

        await expect(loadLintSettings('src/missing.js', root)).rejects.toThrow(
            'path does not exist: src/missing.js',
        );
    });

    it('проект без ESLint-конфига → ошибка про конфиг', async () => {
        const root = makeCliProject({ 'src/a.js': '' });

        await expect(loadLintSettings('src/a.js', root)).rejects.toThrow(
            'no eslint config found for src/a.js',
        );
    });

    it('eslint не установлен в проекте → понятная ошибка', async () => {
        // Проект без `node_modules`: `eslint` ищется от него, а не рядом с файлом плагина.
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        await expect(loadLintSettings('src/a.js', root)).rejects.toThrow(
            'eslint is not installed in this project',
        );
    });
});

describe('loadLintSettings: директория', () => {
    it('берет первый по алфавиту файл и помечает его как сэмпл', async () => {
        const root = makeCliProject({
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
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'src/b.js': '',
            'src/a/deep.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(`${root}/src/a/deep.js`);
    });

    it('пропускает node_modules и dot-директории', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'src/node_modules/pkg/a.js': '',
            'src/.cache/b.js': '',
            'src/z.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(`${root}/src/z.js`);
    });

    it('игнорируемый файл пропускается, сэмплом становится следующий', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'src/generated/a.js': '',
            'src/b.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(`${root}/src/b.js`);
    });

    it('файлы без модульных расширений сэмплом не считаются', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'src/style.css': '',
            'src/data.json': '',
            'src/main.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(`${root}/src/main.js`);
    });

    it('файл-ссылка — такой же файл, как и явный аргумент команды', async () => {
        // `Dirent.isFile()` ссылку файлом не считает, а `weld inspect link.js` тот же файл
        // принимает: без проверки по `stat` проект с исходниками-ссылоками давал бы «нет файлов».
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/real.js': '' });
        symlinkSync(join(root, 'src/real.js'), join(root, 'src/link.js'));

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(`${root}/src/link.js`);
    });

    it('пустая директория → ошибка', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/keep.txt': '' });

        await expect(loadLintSettings('src', root)).rejects.toThrow('no lintable files in src');
    });

    it('проект без ESLint-конфига → ошибка про конфиг', async () => {
        const root = makeCliProject({ 'src/a.js': '' });

        await expect(loadLintSettings('src', root)).rejects.toThrow(
            'no eslint config found for src',
        );
    });
});
