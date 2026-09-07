import { existsSync } from 'node:fs';
import path from 'node:path';

import { createLogger } from '@/debug.js';
import { ENTRY_EXTENSIONS, entryFileName } from '@/extensions.js';
import { dirname, segments, toPosix } from '@/path/index.js';
import { getRoot } from '@/settings/index.js';

import { findRepoRoot } from '@/host/root.js';

const debug = createLogger('fs');

/** Граница ФС для правил: только виртуальные пути от корня репозитория (`/src/feature/x.ts`). */
export type FsHost = {
    /**
     * Есть ли в директории `dir` (виртуальный путь) точка входа — файл `index.<ext>` с одним из
     * {@link ENTRY_EXTENSIONS}. Именно этот вопрос, а не сырое «существует ли файл»: ответ на
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

type CreateFsHostOptions = {
    now?: () => number;
    exists?: (realPath: string) => boolean;
};

/**
 * TTL кэша обращений к диску. Десять минут: линт монорепы идёт минутами, а наличие `index.<ext>`
 * в рамках одного прогона стабильно — файлы не появляются и не исчезают под работающим ESLint.
 * Меньший TTL просто заставлял бы перепроверять диск посреди прогона.
 */
const TTL_MS = 600_000;

/** Ведущий Windows-диск (`C:`) реального пути после `toPosix`. */
const DRIVE_PREFIX = /^[A-Za-z]:/;

/**
 * Абсолютность реального пути: unix (`/…`) или Windows-диск (`C:…`) — уже после `toPosix`.
 *
 * `path.win32.isAbsolute` здесь не подходит: он считает неабсолютными drive-relative пути `C:` и
 * `C:foo`, а нам нужен признак «путь несёт диск или корень» — иначе `resolveRealPath` пытался бы
 * дорезолвить `C:` от `cwd`, и root `C:` (то, во что `normalizeRoot` превращает корень
 * Windows-ФС `C:/`) уехал бы в директорию запуска ESLint.
 */
function isAbsoluteRealPath(realPath: string): boolean {
    return realPath.startsWith('/') || DRIVE_PREFIX.test(realPath);
}

/**
 * Нормализует root: `toPosix`, без завершающего слэша. Корень ФС (`/`, `C:/`) — как `''` / `C:`,
 * чтобы `root + vpath` не удваивал `/`.
 *
 * `node:path` тут не помощник: `normalize`/`resolve` сохраняют корень как `/` и `C:\`, а нужна
 * именно строка-префикс для склейки `root + vpath`, для корня ФС пустая.
 */
function normalizeRoot(root: string): string {
    const posix = toPosix(root);
    if (posix === '/') {
        return '';
    }

    return posix.endsWith('/') ? posix.slice(0, -1) : posix;
}

/**
 * Сравнение сегментов реального пути с сегментами root. Первый сегмент может быть Windows-диском —
 * тогда буква сравнивается без учёта регистра (`C:` и `c:` — один диск); остальные сегменты —
 * строго: регистрозависимость реальных ФС различается, и строгое сравнение — единственный ответ,
 * не зависящий от платформы запуска.
 */
function sameSegment(left: string | undefined, right: string | undefined, index: number): boolean {
    if (left === undefined || right === undefined) {
        return left === right;
    }

    if (index === 0 && DRIVE_PREFIX.test(left) && DRIVE_PREFIX.test(right)) {
        return left.toUpperCase() === right.toUpperCase();
    }

    return left === right;
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
    const entryPointCache = new Map<string, CacheEntry>();
    const directoryCache = new Map<string, CacheEntry>();

    /** Реальный путь директории по виртуальному. Для root-как-корня-ФС `''` — это `/`. */
    function toRealDir(dir: string): string {
        return `${normalizedRoot}${dir}` || '/';
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
            if (!sameSegment(pathSegments[i], rootSegments[i], i)) {
                return null;
            }
        }

        const remaining = pathSegments.slice(rootSegments.length);
        return remaining.length === 0 ? '/' : `/${remaining.join('/')}`;
    }

    /**
     * Существует ли сама директория. Отдельный кэш и отдельный вопрос: несуществующие пути приходят
     * не поодиночке, а целыми ветками (промах алиаса, опечатка в специфаере, чужой корень) — и
     * каждая такая директория стоила бы перебора всех {@link ENTRY_EXTENSIONS} вместо одного
     * обращения к ФС.
     */
    function directoryExists(dir: string): boolean {
        const time = now();
        const entry = directoryCache.get(dir);
        if (entry && entry.expiresAt > time) {
            return entry.value;
        }

        if (missingParent(dir, time)) {
            // Родителя нет — значит нет и потомка, спрашивать диск не о чем.
            directoryCache.set(dir, { value: false, expiresAt: time + TTL_MS });
            return false;
        }

        const found = nativeExists(toRealDir(dir));
        debug('check directory %s: %o', dir, found);
        directoryCache.set(dir, { value: found, expiresAt: time + TTL_MS });
        return found;
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

        const entry = directoryCache.get(parent);
        return entry !== undefined && entry.expiresAt > time && !entry.value;
    }

    /** Кэш по директории, с TTL: диск опрашивается на промахе или после истечения записи. */
    function hasEntryPoint(dir: string): boolean {
        if (!dir.startsWith('/')) {
            return false;
        }

        const time = now();
        const entry = entryPointCache.get(dir);
        if (entry && entry.expiresAt > time) {
            return entry.value;
        }

        if (!directoryExists(dir)) {
            return false;
        }

        const found = ENTRY_EXTENSIONS.some((ext) =>
            nativeExists(`${toRealDir(dir)}/${entryFileName(ext)}`),
        );
        debug('check entry point %s: %o', dir, found);
        entryPointCache.set(dir, { value: found, expiresAt: time + TTL_MS });
        return found;
    }

    return { hasEntryPoint, toVirtual };
}

/**
 * Резолвит `target` от `base` — оба реальные пути. `target` абсолютный (unix или Windows-диск) —
 * возвращается как есть; иначе схлопывается с `base` силами `node:path`.
 *
 * Ветка `node:path` выбирается по форме `base`, а не по текущей платформе: `win32.resolve` знает
 * про диски, `posix.resolve` — про unix-пути, и на абсолютном `base` обе чистые (к `process.cwd()`
 * они обращаются, только когда ни один аргумент не абсолютен). Один `win32.resolve` на оба случая
 * не годится: unix-путь без диска он достраивает диском из `process.cwd()`, и под Windows `/repo`
 * стал бы `C:/repo` — результат зависел бы от платформы, на которой запущен ESLint.
 *
 * Голый диск `C:` для `win32` — не корень, а «текущая директория диска C», поэтому перед резолвом
 * он дополняется до `C:/` (в таком виде root и приходит из `normalizeRoot`).
 */
function resolveRealPath(base: string, target: string): string {
    const posixTarget = toPosix(target);
    if (isAbsoluteRealPath(posixTarget)) {
        return posixTarget;
    }

    const posixBase = toPosix(base).replace(/^([A-Za-z]:)$/, '$1/');
    const resolve = DRIVE_PREFIX.test(posixBase) ? path.win32.resolve : path.posix.resolve;

    return toPosix(resolve(posixBase, posixTarget));
}

const instanceCache = new Map<string, FsHost>();
const repoRootCache = new Map<string, string | null>();

function findRepoRootCached(cwd: string): string | null {
    if (repoRootCache.has(cwd)) {
        return repoRootCache.get(cwd) as string | null;
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
