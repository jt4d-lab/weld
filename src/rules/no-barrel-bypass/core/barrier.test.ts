import { describe, expect, it } from 'vitest';

import { createFakeFsHost } from '@/host/index.js';
import { findBarrier } from '@/rules/no-barrel-bypass/core/barrier.js';

/** Точки входа теста — список виртуальных путей вместо целого фейкового `FsHost`. */
const entryPoints = (files: string[]) => createFakeFsHost(files).hasEntryPoint;

describe('findBarrier — таблица свойств', () => {
    it('F и T в одной директории — разрешено', () => {
        const hasEntryPoint = entryPoints(['/repo/src/feature/index.ts']);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/feature/util.ts', hasEntryPoint),
        ).toBeNull();
    });

    it('T выше F по дереву — разрешено', () => {
        const hasEntryPoint = entryPoints(['/repo/src/feature/index.ts']);
        expect(findBarrier('/repo/src/feature', '/repo/src/top.ts', hasEntryPoint)).toBeNull();
    });

    it('T внутри соседней директории с index — нарушение, D = эта директория', () => {
        const hasEntryPoint = entryPoints(['/repo/src/other/index.ts']);
        expect(findBarrier('/repo/src/feature', '/repo/src/other/internal.ts', hasEntryPoint)).toBe(
            '/repo/src/other',
        );
    });

    it('T — сам index первой границы на пути — разрешено', () => {
        const hasEntryPoint = entryPoints(['/repo/src/other/index.ts']);
        expect(findBarrier('/repo/src/feature', '/repo/src/other/index', hasEntryPoint)).toBeNull();
    });

    it('T — index.<ext> первой границы (явное расширение) — разрешено', () => {
        const hasEntryPoint = entryPoints(['/repo/src/other/index.ts']);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/other/index.ts', hasEntryPoint),
        ).toBeNull();
    });

    it('T — index директории глубже первой границы — нарушение, D = первая граница', () => {
        const hasEntryPoint = entryPoints([
            '/repo/src/other/index.ts',
            '/repo/src/other/nested/index.ts',
        ]);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/other/nested/index.ts', hasEntryPoint),
        ).toBe('/repo/src/other');
    });

    it('на пути нет ни одной точки входа — разрешено', () => {
        const hasEntryPoint = entryPoints([]);
        expect(
            findBarrier('/repo/src/feature', '/repo/src/other/internal.ts', hasEntryPoint),
        ).toBeNull();
    });

    it('вложенные границы: точки входа у b и c, цель b/c/index — нарушение, D = b', () => {
        const hasEntryPoint = entryPoints(['/repo/src/b/index.ts', '/repo/src/b/c/index.ts']);
        expect(findBarrier('/repo/src/feature', '/repo/src/b/c/index.ts', hasEntryPoint)).toBe(
            '/repo/src/b',
        );
    });

    it('импорт в соседний пакет монорепы — обычный кейс на виртуальных путях', () => {
        const hasEntryPoint = entryPoints(['/packages/b/index.ts']);
        expect(findBarrier('/packages/a/src', '/packages/b/src/internal/y.ts', hasEntryPoint)).toBe(
            '/packages/b',
        );
    });
});
