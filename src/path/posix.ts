/**
 * Сегментные операции над абсолютными путями, без `node:path`.
 *
 * Путь представляется как posix-строка. Абсолютность бывает двух видов:
 * posix-корень (`/a/b`) или Windows-диск как первый сегмент (`C:/a/b`, уже после {@link toPosix}).
 * `splitAbsolute` — единственное место, которое их различает; всё остальное работает с массивом
 * сегментов, где нулевой элемент кодирует корень (`''` для posix, `'C:'` для диска).
 */

const WINDOWS_DRIVE = /^([A-Za-z]:)\//;

/** Разворачивает `\` в `/`. Не резолвит `.`/`..` и не трогает абсолютность. */
export function toPosix(path: string): string {
    return path.replace(/\\/g, '/');
}

function splitAbsolute(path: string): string[] | null {
    if (path.startsWith('/')) {
        return ['', ...path.slice(1).split('/').filter(Boolean)];
    }

    const drive = WINDOWS_DRIVE.exec(path);
    if (drive) {
        const root = drive[1] as string;
        return [
            root,
            ...path
                .slice(root.length + 1)
                .split('/')
                .filter(Boolean),
        ];
    }

    return null;
}

function joinAbsolute(segments: string[]): string {
    if (segments.length === 1) {
        const root = segments[0] as string;
        return root === '' ? '/' : `${root}/`;
    }

    return segments.join('/');
}

export function isAbsolutePath(path: string): boolean {
    return splitAbsolute(path) !== null;
}

/** Директория выше `path`. Требует абсолютный `path`; у корня родителя нет — возвращает сам корень. */
export function dirname(path: string): string {
    const segments = splitAbsolute(path);
    if (segments === null) {
        throw new Error(`dirname: путь не абсолютный: ${path}`);
    }

    if (segments.length <= 1) {
        return joinAbsolute(segments);
    }

    return joinAbsolute(segments.slice(0, -1));
}

/**
 * Резолвит `path` (может быть относительным, с `.`/`..`, или абсолютным) от абсолютной директории
 * `base`. Попытка подняться выше корня клэмпится — как у `path.resolve`, без выброса ошибки.
 */
export function resolvePath(base: string, path: string): string {
    const baseSegments = splitAbsolute(base);
    if (baseSegments === null) {
        throw new Error(`resolvePath: base не абсолютный: ${base}`);
    }

    const absoluteTarget = splitAbsolute(path);
    const segments = absoluteTarget !== null ? [...absoluteTarget] : [...baseSegments];
    const parts = absoluteTarget !== null ? [] : path.split('/');

    for (const part of parts) {
        if (part === '' || part === '.') {
            continue;
        }
        if (part === '..') {
            if (segments.length > 1) {
                segments.pop();
            }
            continue;
        }
        segments.push(part);
    }

    return joinAbsolute(segments);
}

/** Самая глубокая общая директория. `null`, если корни (posix-корень/диск) различаются. */
export function commonDirectory(a: string, b: string): string | null {
    const segmentsA = splitAbsolute(a);
    const segmentsB = splitAbsolute(b);
    if (segmentsA === null || segmentsB === null) {
        return null;
    }
    if (segmentsA[0] !== segmentsB[0]) {
        return null;
    }

    const common: string[] = [segmentsA[0] as string];
    let i = 1;
    while (i < segmentsA.length && i < segmentsB.length && segmentsA[i] === segmentsB[i]) {
        common.push(segmentsA[i] as string);
        i += 1;
    }

    return joinAbsolute(common);
}

/**
 * Путь от директории `from` до `to`, без префикса `./` (его добавляет `renderSpecifier`).
 * Совпадающие пути дают пустую строку.
 */
export function relativePath(from: string, to: string): string {
    const segmentsFrom = splitAbsolute(from);
    const segmentsTo = splitAbsolute(to);
    if (segmentsFrom === null || segmentsTo === null || segmentsFrom[0] !== segmentsTo[0]) {
        throw new Error(`relativePath: пути не сопоставимы: ${from}, ${to}`);
    }

    let i = 1;
    while (i < segmentsFrom.length && i < segmentsTo.length && segmentsFrom[i] === segmentsTo[i]) {
        i += 1;
    }

    const ups = Array<string>(segmentsFrom.length - i).fill('..');
    const downs = segmentsTo.slice(i);

    return [...ups, ...downs].join('/');
}
