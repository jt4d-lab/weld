import { describe, expect, it, vi } from 'vitest';

import { ENTRY_EXTENSIONS } from '../../src/entry-extensions.js';
import { createEntryPointEnv } from '../../src/env/entry-point.js';

describe('createEntryPointEnv', () => {
    it('находит точку входа по любому расширению из ENTRY_EXTENSIONS', () => {
        for (const extension of ENTRY_EXTENSIONS) {
            const exists = (path: string) => path === `/repo/feature/index.${extension}`;
            const env = createEntryPointEnv({ exists });

            expect(env.hasEntryPoint('/repo/feature')).toBe(true);
        }
    });

    it('нет точки входа ни по одному расширению — false', () => {
        const env = createEntryPointEnv({ exists: () => false });

        expect(env.hasEntryPoint('/repo/feature')).toBe(false);
    });

    it('повторный вызов для той же директории не дёргает exists снова (кэш)', () => {
        const exists = vi.fn(() => true);
        const env = createEntryPointEnv({ exists });

        env.hasEntryPoint('/repo/feature');
        const callsAfterFirst = exists.mock.calls.length;
        env.hasEntryPoint('/repo/feature');

        expect(exists.mock.calls.length).toBe(callsAfterFirst);
    });

    it('после сдвига инжектированных часов за 30 секунд exists вызывается снова (TTL истёк)', () => {
        let time = 0;
        const exists = vi.fn(() => true);
        const env = createEntryPointEnv({ exists, now: () => time });

        env.hasEntryPoint('/repo/feature');
        const callsAfterFirst = exists.mock.calls.length;

        time += 30_000;
        env.hasEntryPoint('/repo/feature');

        expect(exists.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });

    it('в пределах TTL exists не вызывается повторно', () => {
        let time = 0;
        const exists = vi.fn(() => true);
        const env = createEntryPointEnv({ exists, now: () => time });

        env.hasEntryPoint('/repo/feature');
        const callsAfterFirst = exists.mock.calls.length;

        time += 29_999;
        env.hasEntryPoint('/repo/feature');

        expect(exists.mock.calls.length).toBe(callsAfterFirst);
    });

    it('два вызова createEntryPointEnv не делят кэш между собой', () => {
        const exists = vi.fn(() => true);

        const envA = createEntryPointEnv({ exists });
        const envB = createEntryPointEnv({ exists });

        envA.hasEntryPoint('/repo/feature');
        const callsAfterA = exists.mock.calls.length;

        envB.hasEntryPoint('/repo/feature');

        expect(exists.mock.calls.length).toBeGreaterThan(callsAfterA);
    });
});
