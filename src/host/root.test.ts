import { describe, expect, it, vi } from 'vitest';

import { createFakeExists } from '@/host/fs.testing.js';
import { findRepoRoot } from '@/host/root.js';

describe('findRepoRoot', () => {
    it('находит единственный package.json выше startDir', () => {
        const exists = createFakeExists(['/a/b/package.json']);

        expect(findRepoRoot('/a/b/c', exists)).toBe('/a/b');
    });

    it('при нескольких package.json побеждает самый верхний', () => {
        const exists = createFakeExists(['/a/package.json', '/a/b/package.json']);

        expect(findRepoRoot('/a/b/c', exists)).toBe('/a');
    });

    it('ни одного package.json → null', () => {
        const exists = createFakeExists([]);

        expect(findRepoRoot('/a/b/c', exists)).toBeNull();
    });

    it('startDir сам содержит package.json', () => {
        const exists = createFakeExists(['/a/b/package.json']);

        expect(findRepoRoot('/a/b', exists)).toBe('/a/b');
    });

    it('package.json выше .git-директории не учитывается', () => {
        const exists = createFakeExists(['/package.json', '/a/.git']);

        expect(findRepoRoot('/a/b', exists)).toBeNull();
    });

    it('package.json в самой директории с .git учитывается (граница включительно)', () => {
        const exists = createFakeExists(['/a/package.json', '/a/.git']);

        expect(findRepoRoot('/a/b', exists)).toBe('/a');
    });

    it('подъём останавливается на корне ФС (unix), не зацикливаясь', () => {
        const exists = vi.fn(() => false);

        expect(findRepoRoot('/a/b', exists)).toBeNull();
        expect(exists.mock.calls.length).toBeLessThan(20);
    });

    it('подъём останавливается на корне ФС (Windows-корень C:/)', () => {
        const exists = createFakeExists(['C:/a/package.json']);

        expect(findRepoRoot('C:/a/b/c', exists)).toBe('C:/a');
    });

    it('подъём до Windows-корня не зацикливается, если ничего не найдено', () => {
        const exists = vi.fn(() => false);

        expect(findRepoRoot('C:/a/b', exists)).toBeNull();
        expect(exists.mock.calls.length).toBeLessThan(20);
    });

    it('нормализует обратные слэши startDir (Windows-запись пути)', () => {
        const exists = createFakeExists(['C:/a/package.json']);

        expect(findRepoRoot('C:\\a\\b\\c', exists)).toBe('C:/a');
    });
});
