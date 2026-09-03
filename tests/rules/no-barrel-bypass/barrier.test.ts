import { describe, expect, it } from 'vitest';

import { findBarrier } from '../../../src/rules/no-barrel-bypass/barrier.js';

function hasEntryPointIn(dirs: Iterable<string>): (dir: string) => boolean {
    const set = new Set(dirs);
    return (dir: string) => set.has(dir);
}

describe('findBarrier: таблица свойств', () => {
    it('F и T в одной директории — разрешено', () => {
        const hasEntryPoint = hasEntryPointIn(['/repo/a']);
        const result = findBarrier('/repo/a', '/repo/a/sibling.ts', hasEntryPoint);
        expect(result).toBeNull();
    });

    it('T выше F по дереву — разрешено', () => {
        const hasEntryPoint = hasEntryPointIn(['/repo/a/b']);
        const result = findBarrier('/repo/a/b/c', '/repo/a/b/parent.ts', hasEntryPoint);
        expect(result).toBeNull();
    });

    it('T внутри соседней директории с index — нарушение, D = эта директория', () => {
        const hasEntryPoint = hasEntryPointIn(['/repo/feature']);
        const result = findBarrier('/repo/other', '/repo/feature/internal/thing.ts', hasEntryPoint);
        expect(result).toBe('/repo/feature');
    });

    it('T — сам index первой границы на пути — разрешено', () => {
        const hasEntryPoint = hasEntryPointIn(['/repo/feature']);
        const result = findBarrier('/repo/other', '/repo/feature/index', hasEntryPoint);
        expect(result).toBeNull();
    });

    it('T — index.<ext> первой границы (явное расширение) — разрешено', () => {
        const hasEntryPoint = hasEntryPointIn(['/repo/feature']);
        const result = findBarrier('/repo/other', '/repo/feature/index.ts', hasEntryPoint);
        expect(result).toBeNull();
    });

    it('T — index директории глубже первой границы — нарушение, D = первая граница', () => {
        const hasEntryPoint = hasEntryPointIn(['/repo/feature', '/repo/feature/inner']);
        const result = findBarrier('/repo/other', '/repo/feature/inner/index.ts', hasEntryPoint);
        expect(result).toBe('/repo/feature');
    });

    it('на пути нет ни одной точки входа — разрешено', () => {
        const hasEntryPoint = hasEntryPointIn([]);
        const result = findBarrier('/repo/other', '/repo/feature/internal/thing.ts', hasEntryPoint);
        expect(result).toBeNull();
    });

    it('у dirname(F) и dirname(T) разные корни — разрешено', () => {
        const hasEntryPoint = hasEntryPointIn(['D:/feature']);
        const result = findBarrier('/repo/other', 'D:/feature/internal/thing.ts', hasEntryPoint);
        expect(result).toBeNull();
    });
});

describe('findBarrier: верхняя граница выигрывает у ближней', () => {
    it('точки входа и у b, и у c, цель b/c/index → граница b', () => {
        const hasEntryPoint = hasEntryPointIn(['/repo/b', '/repo/b/c']);
        const result = findBarrier('/repo/other', '/repo/b/c/index.ts', hasEntryPoint);
        expect(result).toBe('/repo/b');
    });
});

describe('findBarrier: границы за пределами общего поддерева', () => {
    it('импорт в соседний пакет монорепы (цель вне поддерева F) — нарушение ловится как обычно', () => {
        const hasEntryPoint = hasEntryPointIn(['/repo/packages/other']);
        const result = findBarrier(
            '/repo/packages/mine/src',
            '/repo/packages/other/internal/thing.ts',
            hasEntryPoint,
        );
        expect(result).toBe('/repo/packages/other');
    });

    it('разные корни (commonDirectory вернул null) — разрешено', () => {
        const hasEntryPoint = hasEntryPointIn(['C:/repo/feature']);
        const result = findBarrier(
            'D:/repo/other',
            'C:/repo/feature/internal/thing.ts',
            hasEntryPoint,
        );
        expect(result).toBeNull();
    });
});
