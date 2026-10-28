import { describe, expect, it } from 'vitest';

import { repoPath } from './target.js';

describe('repoPath', () => {
    it('путь под корнем печатается от корня', () => {
        expect(repoPath('/repo', '/repo/src/feature/internal.ts')).toBe('src/feature/internal.ts');
    });

    it('путь вне корня остается абсолютным', () => {
        expect(repoPath('/repo/packages/app', '/repo/src/a.ts')).toBe('/repo/src/a.ts');
        expect(repoPath('/repo', '/home/user/configs/eslint.config.mjs')).toBe(
            '/home/user/configs/eslint.config.mjs',
        );
    });

    it('корень `/`: под ним всё, путь считается от него', () => {
        expect(repoPath('/', '/src/a.ts')).toBe('src/a.ts');
    });

    it('сам корень остается абсолютным: относительного пути у него нет', () => {
        expect(repoPath('/repo', '/repo')).toBe('/repo');
    });

    it('соседняя директория с общим префиксом имени — не под корнем', () => {
        // Проверка по первому сегменту, а не по строковому префиксу: `/repo-other` не внутри `/repo`.
        expect(repoPath('/repo', '/repo-other/src/a.ts')).toBe('/repo-other/src/a.ts');
    });
});
