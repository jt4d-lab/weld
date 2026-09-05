import { describe, expect, it } from 'vitest';

import { findBarrier } from './barrier.js';

function entryPointSet(dirs: string[]): (dir: string) => boolean {
    const set = new Set(dirs);
    return (dir) => set.has(dir);
}

describe('findBarrier — таблица свойств', () => {
    it('F и T в одной директории — разрешено', () => {
        const hasEntryPoint = entryPointSet(['/repo/src/feature']);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/feature/util.ts', hasEntryPoint),
        ).toBeNull();
    });

    it('T выше F по дереву — разрешено', () => {
        const hasEntryPoint = entryPointSet(['/repo/src/feature']);
        expect(findBarrier('/repo/src/feature', '/repo/src/top.ts', hasEntryPoint)).toBeNull();
    });

    it('T внутри соседней директории с index — нарушение, D = эта директория', () => {
        const hasEntryPoint = entryPointSet(['/repo/src/other']);
        expect(findBarrier('/repo/src/feature', '/repo/src/other/internal.ts', hasEntryPoint)).toBe(
            '/repo/src/other',
        );
    });

    it('T — сам index первой границы на пути — разрешено', () => {
        const hasEntryPoint = entryPointSet(['/repo/src/other']);
        expect(findBarrier('/repo/src/feature', '/repo/src/other/index', hasEntryPoint)).toBeNull();
    });

    it('T — index.<ext> первой границы (явное расширение) — разрешено', () => {
        const hasEntryPoint = entryPointSet(['/repo/src/other']);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/other/index.ts', hasEntryPoint),
        ).toBeNull();
    });

    it('T — index директории глубже первой границы — нарушение, D = первая граница', () => {
        const hasEntryPoint = entryPointSet(['/repo/src/other', '/repo/src/other/nested']);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/other/nested/index.ts', hasEntryPoint),
        ).toBe('/repo/src/other');
    });

    it('на пути нет ни одной точки входа — разрешено', () => {
        const hasEntryPoint = entryPointSet([]);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/other/internal.ts', hasEntryPoint),
        ).toBeNull();
    });

    it('у dirname(F) и dirname(T) разные корни — разрешено', () => {
        const hasEntryPoint = entryPointSet(['/other']);
        expect(findBarrier('/repo/src/feature', 'C:/other/file.ts', hasEntryPoint)).toBeNull();
    });

    it('импорт в соседний пакет монорепы (цель вне поддерева F)', () => {
        const hasEntryPoint = entryPointSet(['/repo/packages/lib']);
        expect(
            findBarrier(
                '/repo/packages/app/src/feature',
                '/repo/packages/lib/src/index.ts',
                hasEntryPoint,
            ),
        ).toBe('/repo/packages/lib');
    });
});
