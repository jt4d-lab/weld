import { describe, expect, it, vi } from 'vitest';

import { ENTRY_EXTENSIONS } from '../entry-extensions.js';
import { createEntryPointEnv } from './entry-point.js';

describe('createEntryPointEnv', () => {
    it('находит точку входа по любому расширению из ENTRY_EXTENSIONS', () => {
        for (const ext of ENTRY_EXTENSIONS) {
            const exists = vi.fn((path: string) => path === `/repo/src/feature/index.${ext}`);
            const env = createEntryPointEnv({ exists });
            expect(env.hasEntryPoint('/repo/src/feature')).toBe(true);
        }
    });

    it('отсутствие точки входа даёт false', () => {
        const exists = vi.fn(() => false);
        const env = createEntryPointEnv({ exists });
        expect(env.hasEntryPoint('/repo/src/feature')).toBe(false);
    });

    it('повторный вызов для той же директории не дёргает exists снова (кэш)', () => {
        const exists = vi.fn(() => true);
        const env = createEntryPointEnv({ exists });

        env.hasEntryPoint('/repo/src/feature');
        const callsAfterFirst = exists.mock.calls.length;
        env.hasEntryPoint('/repo/src/feature');

        expect(exists.mock.calls.length).toBe(callsAfterFirst);
    });

    it('после сдвига инжектированных часов за 30 секунд exists вызывается снова (TTL)', () => {
        let currentTime = 0;
        const now = () => currentTime;
        const exists = vi.fn(() => true);
        const env = createEntryPointEnv({ now, exists });

        env.hasEntryPoint('/repo/src/feature');
        const callsAfterFirst = exists.mock.calls.length;

        currentTime += 30_000;
        env.hasEntryPoint('/repo/src/feature');

        expect(exists.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });

    it('два вызова createEntryPointEnv не делят кэш', () => {
        const exists = vi.fn(() => true);
        const envA = createEntryPointEnv({ exists });
        const envB = createEntryPointEnv({ exists });

        envA.hasEntryPoint('/repo/src/feature');
        const callsAfterA = exists.mock.calls.length;
        envB.hasEntryPoint('/repo/src/feature');

        expect(exists.mock.calls.length).toBeGreaterThan(callsAfterA);
    });
});
