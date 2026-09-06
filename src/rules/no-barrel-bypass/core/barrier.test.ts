import { describe, expect, it } from 'vitest';

import { fakeHasEntryPoint } from '@/host/index.js';
import { findBarrier } from '@/rules/no-barrel-bypass/core/barrier.js';

describe('findBarrier — таблица свойств', () => {
    it('F и T в одной директории — разрешено', () => {
        const hasEntryPoint = fakeHasEntryPoint(['/repo/src/feature/index.ts']);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/feature/util.ts', hasEntryPoint),
        ).toBeNull();
    });

    it('T выше F по дереву — разрешено', () => {
        const hasEntryPoint = fakeHasEntryPoint(['/repo/src/feature/index.ts']);
        expect(findBarrier('/repo/src/feature', '/repo/src/top.ts', hasEntryPoint)).toBeNull();
    });

    it('T внутри соседней директории с index — нарушение, D = эта директория', () => {
        const hasEntryPoint = fakeHasEntryPoint(['/repo/src/other/index.ts']);
        expect(findBarrier('/repo/src/feature', '/repo/src/other/internal.ts', hasEntryPoint)).toBe(
            '/repo/src/other',
        );
    });

    it('T — сам index первой границы на пути — разрешено', () => {
        const hasEntryPoint = fakeHasEntryPoint(['/repo/src/other/index.ts']);
        expect(findBarrier('/repo/src/feature', '/repo/src/other/index', hasEntryPoint)).toBeNull();
    });

    it('T — index.<ext> первой границы (явное расширение) — разрешено', () => {
        const hasEntryPoint = fakeHasEntryPoint(['/repo/src/other/index.ts']);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/other/index.ts', hasEntryPoint),
        ).toBeNull();
    });

    it('T — index директории глубже первой границы — нарушение, D = первая граница', () => {
        const hasEntryPoint = fakeHasEntryPoint([
            '/repo/src/other/index.ts',
            '/repo/src/other/nested/index.ts',
        ]);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/other/nested/index.ts', hasEntryPoint),
        ).toBe('/repo/src/other');
    });

    it('на пути нет ни одной точки входа — разрешено', () => {
        const hasEntryPoint = fakeHasEntryPoint([]);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/other/internal.ts', hasEntryPoint),
        ).toBeNull();
    });

    it('вложенные границы: точки входа у b и c, цель b/c/index — нарушение, D = b', () => {
        const hasEntryPoint = fakeHasEntryPoint(['/repo/src/b/index.ts', '/repo/src/b/c/index.ts']);
        expect(findBarrier('/repo/src/feature', '/repo/src/b/c/index.ts', hasEntryPoint)).toBe(
            '/repo/src/b',
        );
    });

    it('импорт в соседний пакет монорепы — обычный кейс на виртуальных путях', () => {
        const hasEntryPoint = fakeHasEntryPoint(['/packages/b/index.ts']);
        expect(findBarrier('/packages/a/src', '/packages/b/src/internal/y.ts', hasEntryPoint)).toBe(
            '/packages/b',
        );
    });
});
