import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpProjects, linkRepoNodeModules, makeTmpProject } from '@/testing/index.js';

import { explainConfigLoadError, loadLintSettings } from './eslint-config.js';
import { OTHER_CONFIG, OTHER_CONFIG_PATH, makeCliProject } from './program.testing.js';

const CONFIG = `export default [
    {
        files: ['**/*.js'],
        settings: { weld: { aliases: { '@/*': ['src/*'] } } },
    },
    { ignores: ['ignored/**', '**/generated/**'] },
];
`;

const WELD_SETTINGS = { weld: { aliases: { '@/*': ['src/*'] } } };

const SRC_ONLY_CONFIG = `export default [
    {
        files: ['src/**/*.js'],
        settings: { weld: { aliases: { '@/*': ['src/*'] } } },
    },
];
`;

const ALL_FILES_CONFIG = `export default [
    {
        settings: { weld: { aliases: { '@/*': ['src/*'] } } },
    },
];
`;

/**
 * Конфиг вложенного пакета: шаблон отсчитан от директории самого конфига, поэтому файл пакета он
 * покрывает только тогда, когда `cwd` инстанса ESLint — эта директория (в этом и смысл выбора).
 */
const PACKAGE_CONFIG = `export default [
    {
        files: ['src/**/*.js'],
        settings: { weld: { aliases: { '@pkg/*': ['src/*'] } } },
    },
];
`;

const GLOBAL_LAYER_CONFIG = `export default [
    { rules: { 'no-unused-vars': 'error' } },
    {
        files: ['src/**/*.js'],
        settings: { weld: { aliases: { '@/*': ['src/*'] } } },
    },
];
`;

/** Опции правила вместо `settings`: тоже настройки WELD, и тоже только в files-слое. */
const GLOBAL_LAYER_OPTIONS_CONFIG = `const weld = {
    rules: {
        'no-barrel-bypass': { meta: { schema: [{ type: 'object' }] }, create: () => ({}) },
    },
};

export default [
    { rules: { 'no-unused-vars': 'error' } },
    {
        files: ['src/**/*.js'],
        plugins: { weld },
        rules: { 'weld/no-barrel-bypass': ['error', { repoRoot: '.' }] },
    },
];
`;

/** Настроек WELD в конфиге нет вовсе: представителя с настройками в проекте не найти. */
const GLOBAL_ONLY_CONFIG = `export default [
    { rules: { 'no-unused-vars': 'error' } },
];
`;

const PACKAGE_SETTINGS = { weld: { aliases: { '@pkg/*': ['src/*'] } } };

const OTHER_SETTINGS = {
    weld: { aliasesBaseUrl: '.', aliases: { '@other/*': ['src/*'] } },
};

afterEach(() => {
    cleanupTmpProjects();
});

describe('loadLintSettings: файл', () => {
    it('отдает filePath, configFile и settings из эффективного конфига, без sampleOf', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        const result = await loadLintSettings('src/a.js', root);

        expect(result).toEqual({
            filePath: join(root, 'src/a.js'),
            configFile: join(root, 'eslint.config.mjs'),
            settings: WELD_SETTINGS,
        });
    });

    it('абсолютный путь тоже принимается', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        const result = await loadLintSettings(join(root, 'src/a.js'), root);

        expect(result).toEqual({
            filePath: join(root, 'src/a.js'),
            configFile: join(root, 'eslint.config.mjs'),
            settings: WELD_SETTINGS,
        });
    });

    it('вложенный пакетный конфиг выигрывает у корневого', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'packages/app/eslint.config.mjs': PACKAGE_CONFIG,
            'packages/app/src/a.js': '',
            'src/b.js': '',
        });

        const inPackage = await loadLintSettings('packages/app/src/a.js', root);
        const inRoot = await loadLintSettings('src/b.js', root);

        expect(inPackage).toEqual({
            filePath: join(root, 'packages/app/src/a.js'),
            configFile: join(root, 'packages/app/eslint.config.mjs'),
            settings: PACKAGE_SETTINGS,
        });
        expect(inRoot.configFile).toBe(join(root, 'eslint.config.mjs'));
    });

    it('конфиг над корнем проекта тоже применяется', async () => {
        const outer = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'project/src/a.js': '',
        });
        const root = join(outer, 'project');
        linkRepoNodeModules(root);

        const result = await loadLintSettings('src/a.js', root);

        expect(result).toEqual({
            filePath: join(root, 'src/a.js'),
            configFile: join(outer, 'eslint.config.mjs'),
            settings: WELD_SETTINGS,
        });
    });

    it('--config отменяет поиск: настройки берутся из указанного конфига', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            [OTHER_CONFIG_PATH]: OTHER_CONFIG,
            'src/a.js': '',
        });

        const result = await loadLintSettings('src/a.js', root, OTHER_CONFIG_PATH);

        expect(result).toEqual({
            filePath: join(root, 'src/a.js'),
            configFile: join(root, OTHER_CONFIG_PATH),
            settings: OTHER_SETTINGS,
        });
    });

    it('--config на отсутствующий путь → ошибка про путь конфига', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        await expect(loadLintSettings('src/a.js', root, 'nope.config.mjs')).rejects.toThrow(
            'config path does not exist: nope.config.mjs',
        );
    });

    it('--config на директорию → ошибка про файл, а не про отсутствие', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        await expect(loadLintSettings('src/a.js', root, 'src')).rejects.toThrow(
            'config path is not a file: src',
        );
    });

    it('--config: путь вне cwd → ошибка про базу конфига, а не про игнор', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });
        const outside = makeTmpProject({ 'a.js': '' });

        await expect(
            loadLintSettings(join(outside, 'a.js'), root, 'eslint.config.mjs'),
        ).rejects.toThrow(
            `${join(outside, 'a.js')} is outside the config base directory: ` +
                `files and ignores are counted from ${root}`,
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
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG, 'src/a.js': '' });

        await expect(loadLintSettings('src/a.js', root)).rejects.toThrow(
            'eslint is not installed in this project',
        );
    });

    it('конфиг падает при загрузке → ошибка уходит наружу, а не теряется', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': "throw new Error('config is broken');",
            'src/a.js': '',
        });

        await expect(loadLintSettings('src/a.js', root)).rejects.toThrow('config is broken');
    });

    it('eslint есть, но точка входа не резолвится → ошибка с cwd', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/a.js': '',
            'node_modules/eslint/package.json': 'not json',
        });

        await expect(loadLintSettings('src/a.js', root)).rejects.toThrow(
            `eslint could not be resolved from ${root}`,
        );
    });

    it('eslint есть, но падает при загрузке → ошибка с причиной', async () => {
        const root = makeTmpProject({
            'eslint.config.mjs': CONFIG,
            'src/a.js': '',
            'node_modules/eslint/package.json':
                '{ "name": "eslint", "version": "9.0.0", "type": "module", "main": "broken.js" }',
            'node_modules/eslint/broken.js': "throw new Error('eslint is broken');",
        });

        await expect(loadLintSettings('src/a.js', root)).rejects.toThrow(
            `eslint could not be loaded from ${root}: eslint is broken`,
        );
    });

    it('путь, который файловая система не может прочитать → ошибка cannot read', async () => {
        const root = makeTmpProject({ 'eslint.config.mjs': CONFIG });
        symlinkSync(join(root, 'loop.js'), join(root, 'loop.js'));

        await expect(loadLintSettings('loop.js', root)).rejects.toThrow('cannot read');
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
            filePath: join(root, 'src/a.js'),
            configFile: join(root, 'eslint.config.mjs'),
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

        expect(result.filePath).toBe(join(root, 'src/a/deep.js'));
    });

    it('пропускает node_modules и dot-директории', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'src/node_modules/pkg/a.js': '',
            'src/.cache/b.js': '',
            'src/z.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(join(root, 'src/z.js'));
    });

    it('игнорируемый файл пропускается, сэмплом становится следующий', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'src/generated/a.js': '',
            'src/b.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(join(root, 'src/b.js'));
    });

    it('файлы без модульных расширений сэмплом не считаются', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'src/style.css': '',
            'src/data.json': '',
            'src/main.js': '',
        });

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(join(root, 'src/main.js'));
    });

    it('файл-ссылка — такой же файл, как и явный аргумент команды', async () => {
        const root = makeCliProject({ 'eslint.config.mjs': CONFIG, 'src/real.js': '' });
        symlinkSync(join(root, 'src/real.js'), join(root, 'src/link.js'));

        const result = await loadLintSettings('src', root);

        expect(result.filePath).toBe(join(root, 'src/link.js'));
    });

    it('--config отменяет поиск: сэмпл ищется под указанным конфигом', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            [OTHER_CONFIG_PATH]: OTHER_CONFIG,
            'src/a.js': '',
        });

        const result = await loadLintSettings('src', root, OTHER_CONFIG_PATH);

        expect(result).toEqual({
            filePath: join(root, 'src/a.js'),
            configFile: join(root, OTHER_CONFIG_PATH),
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

    it('найденный конфиг сэмплом директории не становится', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALL_FILES_CONFIG,
            'packages/app/eslint.config.mjs': ALL_FILES_CONFIG,
            'packages/app/src/a.js': '',
        });

        const result = await loadLintSettings('packages/app', root);

        expect(result.filePath).toBe(join(root, 'packages/app/src/a.js'));
    });

    it('конфиг с другим именем тоже сэмплом не становится', async () => {
        // `eslint.config.other.mjs` не входит в `CONFIG_FILE_NAMES` и потому не считается конфигом
        // проекта, но лежит в директории и линтуется тем же конфигом без `files`: сэмплом он
        // становиться не должен — это конфиг, а не файл проекта.
        const root = makeCliProject({
            'eslint.config.mjs': ALL_FILES_CONFIG,
            'eslint.config.other.mjs': ALL_FILES_CONFIG,
            'src/a.js': '',
        });

        const result = await loadLintSettings('.', root);

        expect(result.filePath).toBe(join(root, 'src/a.js'));
    });

    it('tool-конфиг вне шаблона files сэмплом не становится', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': SRC_ONLY_CONFIG,
            'jest.config.js': 'export default {};',
            'next.config.mjs': 'export default {};',
            'src/a.js': '',
        });

        const result = await loadLintSettings('.', root);

        expect(result).toEqual({
            filePath: join(root, 'src/a.js'),
            configFile: join(root, 'eslint.config.mjs'),
            settings: WELD_SETTINGS,
            sampleOf: '.',
        });
    });

    it('файлов под шаблоном files нет → ошибка, а не сэмпл без настроек', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': SRC_ONLY_CONFIG,
            'jest.config.js': 'export default {};',
        });

        await expect(loadLintSettings('.', root)).rejects.toThrow('no lintable files in .');
    });

    it('tool-конфиг не становится сэмплом и под глобальным слоем конфига', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': GLOBAL_LAYER_CONFIG,
            'jest.config.js': 'export default {};',
            'src/a.js': '',
        });

        const result = await loadLintSettings('.', root);

        expect(result).toEqual({
            filePath: join(root, 'src/a.js'),
            configFile: join(root, 'eslint.config.mjs'),
            settings: WELD_SETTINGS,
            sampleOf: '.',
        });
    });

    it('опции правила в files-слое отсеивают tool-конфиг так же, как settings', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': GLOBAL_LAYER_OPTIONS_CONFIG,
            'jest.config.js': 'export default {};',
            'src/a.js': '',
        });

        const result = await loadLintSettings('.', root);

        expect(result.filePath).toBe(join(root, 'src/a.js'));
        expect(result.options).toEqual({ repoRoot: '.' });
    });

    it('настроек WELD в конфиге нет — сэмплом становится первый годный файл', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': GLOBAL_ONLY_CONFIG,
            'jest.config.js': 'export default {};',
            'src/a.js': '',
        });

        const result = await loadLintSettings('.', root);

        expect(result.filePath).toBe(join(root, 'jest.config.js'));
        expect(result.settings).toBeUndefined();
    });

    it('обход уперся в предел, но годный файл уже найден → отдает его', async () => {
        const files: Record<string, string> = {
            'eslint.config.mjs': GLOBAL_ONLY_CONFIG,
            'a.js': '',
        };

        for (let index = 0; index < 5001; index += 1) {
            files[`file-${String(index).padStart(4, '0')}.txt`] = '';
        }

        const root = makeCliProject(files);

        const result = await loadLintSettings('.', root);

        expect(result.filePath).toBe(join(root, 'a.js'));
    });

    it('файлы пакета с собственным конфигом сэмплом не становятся', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'packages/a/eslint.config.mjs': PACKAGE_CONFIG,
            'packages/a/src/x.js': '',
            'packages/readme.js': '',
        });

        const result = await loadLintSettings('packages', root);

        expect(result).toEqual({
            filePath: join(root, 'packages/readme.js'),
            configFile: join(root, 'eslint.config.mjs'),
            settings: WELD_SETTINGS,
            sampleOf: 'packages',
        });
    });

    it('под выбранным конфигом файлов нет → ошибка', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            'packages/a/eslint.config.mjs': PACKAGE_CONFIG,
            'packages/a/src/x.js': '',
        });

        await expect(loadLintSettings('packages', root)).rejects.toThrow(
            'no lintable files in packages',
        );
    });

    it('--config не считается с вложенными конфигами', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': CONFIG,
            [OTHER_CONFIG_PATH]: OTHER_CONFIG,
            'packages/a/eslint.config.mjs': PACKAGE_CONFIG,
            'packages/a/src/x.js': '',
        });

        const result = await loadLintSettings('packages', root, OTHER_CONFIG_PATH);

        expect(result).toEqual({
            filePath: join(root, 'packages/a/src/x.js'),
            configFile: join(root, OTHER_CONFIG_PATH),
            settings: OTHER_SETTINGS,
            sampleOf: 'packages',
        });
    });

    it('обход директории останавливается после 5000 записей', async () => {
        const files: Record<string, string> = { 'eslint.config.mjs': CONFIG };

        for (let index = 0; index < 5001; index += 1) {
            files[`src/file-${String(index).padStart(4, '0')}.txt`] = '';
        }

        const root = makeCliProject(files);

        await expect(loadLintSettings('src', root)).rejects.toThrow(
            'no lintable files in src (stopped after 5000 entries)',
        );
    });
});

describe('explainConfigLoadError', () => {
    it.each(['ts', 'mts', 'cts'])('%s — TS-конфиг, который не может импортировать Node', (ext) => {
        const configFile = `/project/eslint.config.${ext}`;
        const cause = new Error(`Unknown file extension ".${ext}" for ${configFile}`);

        const error = explainConfigLoadError(cause, configFile);

        expect(error.message).toBe(
            `eslint config ${configFile} is a TypeScript file and this Node.js version cannot ` +
                'import it: point `--config` at a JavaScript config, or run on a Node.js version ' +
                'that imports TypeScript natively (22.18+)',
        );
        expect(error.cause).toBe(cause);
    });

    it('отсутствующий jiti (ESLint 10) объясняется установкой пакета', () => {
        const configFile = '/project/eslint.config.ts';
        const cause = new Error(
            "The 'jiti' library is required for loading TypeScript configuration files. " +
                'Make sure to install it.',
        );

        const error = explainConfigLoadError(cause, configFile);

        expect(error.message).toBe(
            `eslint config ${configFile} is a TypeScript file and ESLint needs the ` +
                "'jiti' library to load it: install `jiti`, or point `--config` at a JavaScript config",
        );
        expect(error.cause).toBe(cause);
    });

    it('прочие ошибки отдает как есть', () => {
        const cause = new Error('something else');

        expect(explainConfigLoadError(cause, '/project/eslint.config.mjs')).toBe(cause);
    });

    it('не-Error превращает в Error с тем же текстом', () => {
        expect(explainConfigLoadError('boom', '/project/eslint.config.mjs').message).toBe('boom');
    });
});
