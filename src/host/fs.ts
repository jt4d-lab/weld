import { existsSync } from 'node:fs';

import { createLogger } from '@/debug.js';
import { ENTRY_FILE_NAMES } from '@/extensions.js';
import { dirname, joinSegments, segments, toPosix } from '@/path/index.js';
import { getRoot } from '@/settings/index.js';

import {
    joinReal,
    normalizeRoot,
    resolveRealPath,
    sameSegment,
    isAbsoluteRealPath,
} from '@/host/real-path.js';
import { findRepoRoot } from '@/host/root.js';

const debug = createLogger('fs');

/** Граница ФС для правил: только виртуальные пути от корня репозитория (`/src/feature/x.ts`). */
export type FsHost = {
    /**
     * Есть ли в директории `dir` (виртуальный путь) точка входа — файл `index.<ext>` с одним из
     * `ENTRY_EXTENSIONS`. Именно этот вопрос, а не сырое «существует ли файл»: ответ на
     * директорию один, и кэшируется он одной записью вместо записи на каждое расширение.
     *
     * Границу намеренно держим узкой — примитив добавляется, когда его просит правило, а не
     * заранее: каждый метод здесь обязаны реализовать все фейки.
     */
    hasEntryPoint(dir: string): boolean;
    /** `null` — `realPath` вне root или не абсолютный. */
    toVirtual(realPath: string): string | null;
};

type CacheEntry = { value: boolean; expiresAt: number };
type Cache = Map<string, CacheEntry>;

type CreateFsHostOptions = {
    now?: () => number;
    exists?: (realPath: string) => boolean;
};

/**
 * TTL положительного ответа. Десять минут: линт монорепы идёт минутами, а найденный `index.<ext>`
 * в рамках одного прогона никуда не девается — под работающим ESLint файлы не удаляют. Меньший TTL
 * просто заставлял бы перепроверять диск посреди прогона.
 */
const TTL_MS = 600_000;

/**
 * TTL отрицательного ответа — заметно короче. Асимметрия отвечает асимметрии самих ответов:
 * «баррель есть» опровергается удалением файла, «барреля нет» — тем, что его дописали, а именно это
 * и делают в редакторе через секунды после того, как правило отрепортило нарушение. Долгий TTL
 * заставлял бы плагин в языковом сервере репортить уже созданный `index.<ext>` ещё десять минут.
 *
 * Кэш от этого не обесценивается: он нужен, чтобы отсутствующая ветка стоила одного обращения к ФС
 * вместо обращения на каждый сегмент, а весь спуск укладывается в линт одного файла — то есть в
 * миллисекунды. Пяти секунд хватает на пачку файлов, ссылающихся в одну и ту же мёртвую ветку.
 */
const NEGATIVE_TTL_MS = 5_000;

/** Живое (непротухшее) значение кэша или `undefined`. */
function peek(cache: Cache, key: string, time: number): boolean | undefined {
    const entry = cache.get(key);
    return entry !== undefined && entry.expiresAt > time ? entry.value : undefined;
}

function remember(cache: Cache, key: string, time: number, value: boolean): boolean {
    cache.set(key, { value, expiresAt: time + (value ? TTL_MS : NEGATIVE_TTL_MS) });
    return value;
}

/**
 * `createFsHost` — единственное место, знающее про реальные пути. Всё, что уходит вглубь правил, —
 * виртуальные пути; реальный root в публичный тип не входит, живёт в замыкании.
 */
export function createFsHost(root: string, options: CreateFsHostOptions = {}): FsHost {
    const normalizedRoot = normalizeRoot(root);
    const rootSegments = segments(normalizedRoot);
    const now = options.now ?? Date.now;
    const nativeExists = options.exists ?? existsSync;
    const entryPointCache: Cache = new Map();
    const directoryCache: Cache = new Map();

    /**
     * Реальный путь директории по виртуальному. Виртуальный путь всегда начинается с `/`, поэтому
     * для root-как-корня-ФС (`normalizedRoot === ''`) склейка сама даёт корректный путь от `/`.
     */
    function toRealDir(dir: string): string {
        return `${normalizedRoot}${dir}`;
    }

    function toVirtual(realPath: string): string | null {
        const posixPath = toPosix(realPath);
        if (!isAbsoluteRealPath(posixPath)) {
            return null;
        }

        const pathSegments = segments(posixPath);
        if (pathSegments.length < rootSegments.length) {
            return null;
        }
        for (let i = 0; i < rootSegments.length; i += 1) {
            if (!sameSegment(pathSegments[i] as string, rootSegments[i] as string, i)) {
                return null;
            }
        }

        return joinSegments(pathSegments.slice(rootSegments.length));
    }

    /**
     * Существует ли сама директория. Отдельный кэш и отдельный вопрос: несуществующие пути приходят
     * не поодиночке, а целыми ветками (промах алиаса, опечатка в специфаере, чужой корень) — и
     * каждая такая директория стоила бы перебора всех точек входа вместо одного обращения к ФС.
     */
    function directoryExists(dir: string): boolean {
        const time = now();
        const cached = peek(directoryCache, dir, time);
        if (cached !== undefined) {
            return cached;
        }

        if (missingParent(dir, time)) {
            // Родителя нет — значит нет и потомка, спрашивать диск не о чем.
            return remember(directoryCache, dir, time, false);
        }

        const found = nativeExists(toRealDir(dir));
        debug('check directory %s: %o', dir, found);
        return remember(directoryCache, dir, time, found);
    }

    /**
     * Известно ли уже, что родителя `dir` нет. Только по кэшу, без обращения к диску: спуск к цели
     * идёт сверху вниз, поэтому про родителя ответ к этому моменту есть — а несуществующие пути
     * приходят ветками, и без этого каждый сегмент отсутствующей ветки стоил бы своего обращения к
     * ФС. Отвечать на промах кэша рекурсивной проверкой предков не годится: она стоила бы обращения
     * на каждого предка там, где хватало одного.
     */
    function missingParent(dir: string, time: number): boolean {
        const parent = dirname(dir);
        if (parent === dir) {
            return false;
        }

        return peek(directoryCache, parent, time) === false;
    }

    /** Кэш по директории, с TTL: диск опрашивается на промахе или после истечения записи. */
    function hasEntryPoint(dir: string): boolean {
        if (!dir.startsWith('/')) {
            return false;
        }

        const time = now();
        const cached = peek(entryPointCache, dir, time);
        if (cached !== undefined) {
            return cached;
        }

        if (!directoryExists(dir)) {
            // Ответ запоминается и здесь: иначе каждый повторный вопрос про ту же отсутствующую
            // директорию заново проходил бы промах кэша точек входа, хотя ответ уже известен.
            return remember(entryPointCache, dir, time, false);
        }

        const realDir = toRealDir(dir);
        const found = ENTRY_FILE_NAMES.some((name) => nativeExists(joinReal(realDir, name)));
        debug('check entry point %s: %o', dir, found);
        return remember(entryPointCache, dir, time, found);
    }

    return { hasEntryPoint, toVirtual };
}

const instanceCache = new Map<string, FsHost>();
const repoRootCache = new Map<string, string | null>();

function findRepoRootCached(cwd: string): string | null {
    // `findRepoRoot` возвращает `string | null`, поэтому `undefined` однозначно значит «не кэшировано».
    const cached = repoRootCache.get(cwd);
    if (cached !== undefined) {
        return cached;
    }

    const found = findRepoRoot(cwd, existsSync);
    repoRootCache.set(cwd, found);
    return found;
}

function resolveRoot(settings: unknown, cwd: string, rootOverride?: unknown): string {
    const explicitRoot = getRoot(settings, rootOverride);
    if (explicitRoot !== undefined) {
        return resolveRealPath(cwd, explicitRoot);
    }

    return findRepoRootCached(cwd) ?? cwd;
}

/**
 * `resolveRoot` + кэш инстансов по root — иначе TTL-кэш обращений к диску обнулялся бы на каждом
 * файле.
 *
 * `rootOverride` — значение root из опций правила; разбирает и проверяет его всё тот же `getRoot`,
 * `src/host/` про формат конфига по-прежнему ничего не знает. Кэш инстансов ключуется уже
 * резолвнутым root, поэтому файлы с разным override не делят инстанс.
 */
export function getFsHost(settings: unknown, cwd: string, rootOverride?: unknown): FsHost {
    const root = resolveRoot(settings, cwd, rootOverride);

    const cached = instanceCache.get(root);
    if (cached) {
        debug('getFsHost: reusing cached instance for root %s', root);
        return cached;
    }

    debug('getFsHost: creating instance for root %s', root);
    const created = createFsHost(root);
    instanceCache.set(root, created);
    return created;
}

/** Сбрасывает кэш инстансов `getFsHost` и мемоизацию `findRepoRoot` — для изоляции тестов. */
export function resetFsHostCaches(): void {
    instanceCache.clear();
    repoRootCache.clear();
}
