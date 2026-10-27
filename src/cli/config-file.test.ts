import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTmpProjects, makeTmpProject } from '@/testing/index.js';

import { CONFIG_FILE_NAMES, findConfigFile, resolveConfigFile } from './config-file.js';

afterEach(() => {
    cleanupTmpProjects();
});

describe('CONFIG_FILE_NAMES', () => {
    it('имена в порядке ESLint 10, включая TS-варианты', () => {
        expect(CONFIG_FILE_NAMES).toEqual([
            'eslint.config.js',
            'eslint.config.mjs',
            'eslint.config.cjs',
            'eslint.config.ts',
            'eslint.config.mts',
            'eslint.config.cts',
        ]);
    });
});

describe('findConfigFile', () => {
    it('находит конфиг корня проекта из глубокой директории', () => {
        const root = makeTmpProject({
            'eslint.config.mjs': '',
            'packages/app/src/deep/keep.txt': '',
        });

        expect(findConfigFile(join(root, 'packages/app/src/deep'))).toBe(
            `${root}/eslint.config.mjs`,
        );
    });

    it('конфиг самой директории выигрывает у конфига над ней', () => {
        const root = makeTmpProject({
            'eslint.config.mjs': '',
            'packages/app/eslint.config.mjs': '',
        });

        expect(findConfigFile(join(root, 'packages/app'))).toBe(
            `${root}/packages/app/eslint.config.mjs`,
        );
    });

    it('ближайший конфиг выигрывает у более далекого', () => {
        const root = makeTmpProject({
            'eslint.config.mjs': '',
            'packages/eslint.config.mjs': '',
            'packages/app/src/keep.txt': '',
        });

        expect(findConfigFile(join(root, 'packages/app/src'))).toBe(
            `${root}/packages/eslint.config.mjs`,
        );
    });

    it('js выигрывает у mjs', () => {
        const root = makeTmpProject({ 'eslint.config.mjs': '', 'eslint.config.js': '' });

        expect(findConfigFile(root)).toBe(`${root}/eslint.config.js`);
    });

    it('mjs выигрывает у cjs', () => {
        const root = makeTmpProject({ 'eslint.config.cjs': '', 'eslint.config.mjs': '' });

        expect(findConfigFile(root)).toBe(`${root}/eslint.config.mjs`);
    });

    it('cjs выигрывает у ts', () => {
        const root = makeTmpProject({ 'eslint.config.ts': '', 'eslint.config.cjs': '' });

        expect(findConfigFile(root)).toBe(`${root}/eslint.config.cjs`);
    });

    it('конфига нет до корня ФС → null', () => {
        const root = makeTmpProject({ 'src/a.js': '' });

        expect(findConfigFile(join(root, 'src'))).toBeNull();
    });

    it('соседние имена с другим расширением за конфиг не считаются', () => {
        const root = makeTmpProject({ 'eslint.config.json': '' });

        expect(findConfigFile(root)).toBeNull();
    });

    it('директория с именем конфига за конфиг не считается', () => {
        const root = makeTmpProject({ 'eslint.config.js/keep.txt': '' });

        expect(findConfigFile(root)).toBeNull();
    });
});

describe('resolveConfigFile', () => {
    it('резолвит существующий файл от cwd', () => {
        const root = makeTmpProject({ 'configs/eslint.config.mjs': '' });

        expect(resolveConfigFile('configs/eslint.config.mjs', root)).toBe(
            `${root}/configs/eslint.config.mjs`,
        );
    });

    it('абсолютный путь принимается как есть', () => {
        const root = makeTmpProject({ 'eslint.config.mjs': '' });

        expect(resolveConfigFile(`${root}/eslint.config.mjs`, '/elsewhere')).toBe(
            `${root}/eslint.config.mjs`,
        );
    });

    it('отсутствующий путь → ошибка', () => {
        const root = makeTmpProject({ 'eslint.config.mjs': '' });

        expect(() => resolveConfigFile('missing.config.mjs', root)).toThrow(
            'config path does not exist: missing.config.mjs',
        );
    });

    it('директория → ошибка', () => {
        const root = makeTmpProject({ 'configs/keep.txt': '' });

        expect(() => resolveConfigFile('configs', root)).toThrow(
            'config path does not exist: configs',
        );
    });
});
