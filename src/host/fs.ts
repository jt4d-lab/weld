import { existsSync } from 'node:fs';

import { createLogger } from '@/debug.js';
import { ENTRY_FILE_NAMES, MODULE_EXTENSIONS } from '@/extensions.js';
import { dirname, joinPath, joinSegments, segments, toPosix } from '@/path/index.js';
import { getRepoRoot } from '@/settings/index.js';

import {
    commonRealDirectory,
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
    /** Находит модуль по виртуальному пути без явного расширения или возвращает `null`. */
    findModuleTarget(path: string): string | null;
    /** `null` — `realPath` вне root или не абсолютный. */
    toVirtual(realPath: string): string | null;
};

type CacheEntry<T> = { value: T; expiresAt: number };
type Cache<T> = Map<string, CacheEntry<T>>;

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
function peek<T>(cache: Cache<T>, key: string, time: number): T | undefined {
    const entry = cache.get(key);
    return entry !== undefined && entry.expiresAt > time ? entry.value : undefined;
}

/**
 * Запоминает ответ и отдаёт его же. Срок выбирается по знаку ответа: `false`/`null` — «не найдено»
 * и короткий `NEGATIVE_TTL_MS`, любой другой — «найдено» и `TTL_MS`.
 */
function remember<T extends boolean | string | null>(
    cache: Cache<T>,
    key: string,
    time: number,
    value: T,
): T {
    const found = value !== false && value !== null;
    cache.set(key, { value, expiresAt: time + (found ? TTL_MS : NEGATIVE_TTL_MS) });
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
    const entryPointCache: Cache<string | null> = new Map();
    const directoryCache: Cache<boolean> = new Map();
    const fileCache: Cache<boolean> = new Map();

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

    /**
     * Существует ли файл с виртуальным путём. Кэш отделён от директорий: одни и те же строки не
     * могут быть одновременно файлом и директорией, а промахи приходят пачками.
     */
    function fileExists(filePath: string): boolean {
        const time = now();
        const cached = peek(fileCache, filePath, time);
        if (cached !== undefined) {
            return cached;
        }

        const found = nativeExists(`${normalizedRoot}${filePath}`);
        debug('check file %s: %o', filePath, found);
        return remember(fileCache, filePath, time, found);
    }

    /**
     * Виртуальный путь файла точки входа в директории или `null`. Один вопрос и одна запись кэша на
     * директорию: `hasEntryPoint` — это `!== null`, а `findModuleTarget` берёт сам путь.
     */
    function findEntryPoint(dir: string): string | null {
        if (!dir.startsWith('/')) {
            return null;
        }

        const time = now();
        const cached = peek(entryPointCache, dir, time);
        if (cached !== undefined) {
            return cached;
        }

        if (!directoryExists(dir)) {
            // Ответ запоминается и здесь: иначе каждый повторный вопрос про ту же отсутствующую
            // директорию заново проходил бы промах кэша точек входа, хотя ответ уже известен.
            return remember(entryPointCache, dir, time, null);
        }

        const realDir = toRealDir(dir);
        const name = ENTRY_FILE_NAMES.find((candidate) =>
            nativeExists(joinReal(realDir, candidate)),
        );
        const entryPoint = name === undefined ? null : joinPath(dir, name);
        debug('check entry point %s: %o', dir, entryPoint);
        return remember(entryPointCache, dir, time, entryPoint);
    }

    function hasEntryPoint(dir: string): boolean {
        return findEntryPoint(dir) !== null;
    }

    /**
     * Резолвит виртуальный путь специфаера с неоднозначным расширением в виртуальный путь
     * реального модуля: сначала файл с одним из `MODULE_EXTENSIONS`, потом точка входа директории.
     */
    function findModuleTarget(path: string): string | null {
        if (!path.startsWith('/')) {
            return null;
        }

        for (const ext of MODULE_EXTENSIONS) {
            const candidate = `${path}.${ext}`;
            if (fileExists(candidate)) {
                return candidate;
            }
        }

        return findEntryPoint(path);
    }

    return { hasEntryPoint, findModuleTarget, toVirtual };
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

function resolveRoot(
    settings: unknown,
    cwd: string,
    repoRootOverride: unknown,
    coverDirs: string[],
): string {
    const explicitRoot = getRepoRoot(settings, repoRootOverride);
    if (explicitRoot !== undefined) {
        // Явный root — воля пользователя; инвариант «root покрывает якоря» тут держит не подъём
        // root, а отбрасывание непокрытых якорей существующей валидацией у вызывающего.
        return resolveRealPath(cwd, explicitRoot);
    }

    const base = toPosix(findRepoRootCached(cwd) ?? cwd);
    let root = base;
    for (const coverDir of coverDirs) {
        const combined = commonRealDirectory(root, toPosix(coverDir));
        if (combined === null) {
            debug(
                'resolveRoot: cover dir %s shares no prefix with root %s, ignoring',
                coverDir,
                root,
            );
            continue;
        }
        root = combined;
    }

    if (root !== base) {
        debug('resolveRoot: auto root raised from %s to %s to cover requested dirs', base, root);
    }

    return root;
}

/**
 * `resolveRoot` + кэш инстансов по root — иначе TTL-кэш обращений к диску обнулялся бы на каждом
 * файле.
 *
 * `repoRootOverride` — значение repoRoot из опций правила; разбирает и проверяет его всё тот же
 * `getRepoRoot`, `src/host/` про формат конфига по-прежнему ничего не знает. Кэш инстансов ключуется
 * уже резолвнутым root, поэтому файлы с разным override (или разными `coverDirs`) не делят инстанс.
 *
 * `coverDirs` — реальные директории, которые root обязан покрыть (якоря алиасов из tsconfig).
 * Действует только при автоопределении root: итог — общая директория `findRepoRoot(cwd) ?? cwd` и
 * всех `coverDirs`; директория без общего префикса (другой диск) игнорируется с debug. Явный root
 * побеждает и игнорирует параметр целиком.
 */
export function getFsHost(
    settings: unknown,
    cwd: string,
    repoRootOverride?: unknown,
    coverDirs: string[] = [],
): FsHost {
    const root = resolveRoot(settings, cwd, repoRootOverride, coverDirs);

    const cached = instanceCache.get(root);
    if (cached) {
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
