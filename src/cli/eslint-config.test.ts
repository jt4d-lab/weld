import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpProjects, linkRepoNodeModules, makeTmpProject } from '@/testing/index.js';

import { explainConfigLoadError, loadLintSettings } from './eslint-config.js';
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

/** Конфиг вложенного пакета: свои настройки, чтобы выбор конфига было видно по результату. */
const PACKAGE_CONFIG = `export default [
    {
        files: ['**/*.js'],
        settings: { weld: { aliases: { '@pkg/*': ['src/*'] } } },
    },
];
`;

const PACKAGE_SETTINGS = { weld: { aliases: { '@pkg/*': ['src/*'] } } };

/**
 * Конфиг вне директории цели (`--config`): `files` отсчитываются от `cwd` пользователя, поэтому
 * шаблон покрывает файл, лежащий выше самого конфига.
 */
const OTHER_CONFIG_PATH = 'configs/other.config.mjs';

const OTHER_CONFIG = `export default [
    {
        files: ['**/*.js'],
        settings: { weld: { aliases: { '@other/*': ['src/*'] } } },
    },
];
`;

const OTHER_SETTINGS = { weld: { aliases: { '@other/*': ['src/*'] } } };

afterEach(() => {
    cleanupTmpProjects();
});

describe('loadLintSettings: файл', () => {
    it('отдает filePath, configFile и settings из эффективного конфига, без sampleOf', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        const result = await loadLintSettings('src/a.js', root);

        expect(result).toEqual({
            filePath: `${root}/src/a.js`,
            configFile: `${root}/eslint.config.mjs`,
            settings: WELD_SETTINGS,
        });
    });

    it('абсолютный путь тоже принимается', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        const result = await loadLintSettings(`${root}/src/a.js`, root);

        expect(result).toEqual({
            filePath: `${root}/src/a.js`,
            configFile: `${root}/eslint.config.mjs`,
            settings: WELD_SETTINGS,
        });
    });

    it('вложенный пакетный конфиг выигрывает у корневого', async () => {
        // Раньше ESLint искал конфиг от `cwd`, и из корня монорепа был виден только корневой: файл
        // пакета получал чужие настройки.
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'packages/app/eslint.config.mjs': PACKAGE_CONFIG,
            'packages/app/src/a.js': '',
            'src/b.js': '',
        });

        const inPackage = await loadLintSettings('packages/app/src/a.js', root);
        const inRoot = await loadLintSettings('src/b.js', root);

        expect(inPackage).toEqual({
            filePath: `${root}/packages/app/src/a.js`,
            configFile: `${root}/packages/app/eslint.config.mjs`,
            settings: PACKAGE_SETTINGS,
        });
        expect(inRoot.configFile).toBe(`${root}/eslint.config.mjs`);
    });

    it('конфиг над корнем проекта тоже применяется', async () => {
        // Проект без своего конфига: поиск уходит выше временной директории, но `cwd` ESLint —
        // директория найденного конфига, поэтому файл проекта остается в области его шаблонов.
        const outer = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'project/src/a.js': '',
        });
        const root = join(outer, 'project');
        linkRepoNodeModules(root);

        const result = await loadLintSettings('src/a.js', root);

        expect(result).toEqual({
            filePath: `${root}/src/a.js`,
            configFile: `${outer}/eslint.config.mjs`,
            settings: WELD_SETTINGS,
        });
    });

    it('--config отменяет поиск: настройки берутся из указанного конфига', async () => {
        // Файл лежит выше директории конфига, и шаблон `files` все равно его покрывает: при
        // `--config` `cwd` ESLint — директория пользователя, как у `eslint --config`.
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            [OTHER_CONFIG_PATH]: OTHER_CONFIG,
            'src/a.js': '',
        });

        const result = await loadLintSettings('src/a.js', root, OTHER_CONFIG_PATH);

        expect(result).toEqual({
            filePath: `${root}/src/a.js`,
            configFile: `${root}/${OTHER_CONFIG_PATH}`,
            settings: OTHER_SETTINGS,
        });
    });

    it('--config на отсутствующий путь → ошибка про путь конфига', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        await expect(loadLintSettings('src/a.js', root, 'nope.config.mjs')).rejects.toThrow(
            'config path does not exist: nope.config.mjs',
        );
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
            configFile: `${root}/eslint.config.mjs`,
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

    it('--config отменяет поиск: сэмпл ищется под указанным конфигом', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            [OTHER_CONFIG_PATH]: OTHER_CONFIG,
            'src/a.js': '',
        });

        const result = await loadLintSettings('src', root, OTHER_CONFIG_PATH);

        expect(result).toEqual({
            filePath: `${root}/src/a.js`,
            configFile: `${root}/${OTHER_CONFIG_PATH}`,
            settings: OTHER_SETTINGS,
            sampleOf: 'src',
        });
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

describe('explainConfigLoadError', () => {
    const configFile = '/project/eslint.config.ts';

    it('ошибку ESLint 9 про TS-конфиг объясняет причиной и выходом', () => {
        const cause = new Error(`Unknown file extension ".ts" for ${configFile}`);

        const error = explainConfigLoadError(cause, configFile);

        expect(error.message).toBe(
            `eslint config ${configFile} is a TypeScript file and this ESLint version cannot load ` +
                'it: enable `unstable_ts_config` or point `--config` at a JavaScript config',
        );
        expect(error.cause).toBe(cause);
    });

    it('mts и cts — те же TS-конфиги', () => {
        const error = explainConfigLoadError(
            new Error('Unknown file extension ".mts" for /project/eslint.config.mts'),
            '/project/eslint.config.mts',
        );

        expect(error.message).toContain('enable `unstable_ts_config`');
    });

    it('прочие ошибки отдает как есть', () => {
        const cause = new Error('something else');

        expect(explainConfigLoadError(cause, '/project/eslint.config.mjs')).toBe(cause);
    });

    it('не-Error превращает в Error с тем же текстом', () => {
        expect(explainConfigLoadError('boom', '/project/eslint.config.mjs').message).toBe('boom');
    });
});
