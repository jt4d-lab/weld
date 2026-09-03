import type { Alias } from './aliases.js';
import { parseAliases } from './aliases.js';

const cache = new WeakMap<object, Alias[]>();

export function getWeldSettings(settings: unknown): Record<string, unknown> | undefined {
    if (typeof settings !== 'object' || settings === null) {
        return undefined;
    }

    const weld = (settings as Record<string, unknown>).weld;
    if (weld === undefined) {
        return undefined;
    }

    if (typeof weld !== 'object' || weld === null) {
        throw new Error('settings.weld must be an object');
    }

    return weld as Record<string, unknown>;
}

export type WeldSettings = {
    getAliases(): Alias[];
};

/**
 * Фасад над `settings.weld`. Единственный сегодня метод — `getAliases()`, кэширующий разбор
 * алиасов по `WeakMap` на объект `weld` (не на `settings`, чтобы кэш переживал повторное чтение
 * настроек ESLint-контекста).
 */
export function createWeldSettings(settings: unknown, cwd: string): WeldSettings {
    return {
        getAliases(): Alias[] {
            const weld = getWeldSettings(settings);
            if (weld === undefined) {
                return [];
            }

            const cached = cache.get(weld);
            if (cached !== undefined) {
                return cached;
            }

            const result = parseAliases(weld, cwd);
            cache.set(weld, result);
            return result;
        },
    };
}
