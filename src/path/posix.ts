/**
 * Сегментные операции над виртуальными путями, без `node:path`.
 *
 * Виртуальный путь — posix-строка от корня репозитория (`/src/feature/x.ts`), корень — `/`.
 * `toPosix` — исключение: работает с реальными путями на границе (`createFsHost`), до перевода в
 * виртуальные; остальные функции здесь принимают только виртуальные пути.
 */

/** Заменяет `\` на `/`. Не резолвит `.`/`..` и ничего не знает о виртуальных путях. */
export function toPosix(path: string): string {
    return path.replace(/\\/g, '/');
}

/** Непустые сегменты пути. Корень (`/`) и пустая строка дают пустой массив. */
export function segments(path: string): string[] {
    return path.split('/').filter(Boolean);
}

/** Собирает виртуальный путь из сегментов. Пустой список — корень (`/`). */
export function joinSegments(segs: string[]): string {
    return segs.length === 0 ? '/' : `/${segs.join('/')}`;
}

/** Последний сегмент виртуального пути после последнего `/`. Корень даёт пустую строку. */
export function basename(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

/** Разбивает basename на имя и расширение (без точки). Расширения нет — `ext` пустой. */
export function splitExtension(base: string): { name: string; ext: string } {
    const match = /^(.+)\.([^./]+)$/.exec(base);
    if (!match) {
        return { name: base, ext: '' };
    }

    return { name: match[1] as string, ext: match[2] as string };
}

/** Директория выше `path`. У корня родителя нет — возвращает сам корень. */
export function dirname(path: string): string {
    const segs = segments(path);
    if (segs.length === 0) {
        return '/';
    }

    return joinSegments(segs.slice(0, -1));
}

/**
 * Резолвит `path` (относительный, с `.`/`..`, или абсолютный) от виртуальной директории `base`.
 * Выход `..` выше `/` — за пределами репозитория, невыразимо виртуальным путём — возвращает `null`.
 */
export function resolvePath(base: string, path: string): string | null {
    const segs = path.startsWith('/') ? [] : segments(base);

    for (const part of path.split('/')) {
        if (part === '' || part === '.') {
            continue;
        }
        if (part === '..') {
            if (segs.length === 0) {
                return null;
            }
            segs.pop();
            continue;
        }
        segs.push(part);
    }

    return joinSegments(segs);
}

/** Самая глубокая общая директория. У виртуальных путей общий корень `/` есть всегда. */
export function commonDirectory(a: string, b: string): string {
    const segsA = segments(a);
    const segsB = segments(b);

    const common: string[] = [];
    let i = 0;
    while (i < segsA.length && i < segsB.length && segsA[i] === segsB[i]) {
        common.push(segsA[i] as string);
        i += 1;
    }

    return joinSegments(common);
}

/**
 * Путь от директории `from` до `to`, без префикса `./` (его добавляет `renderSpecifier`).
 * Совпадающие пути дают пустую строку.
 */
export function relativePath(from: string, to: string): string {
    const segsFrom = segments(from);
    const segsTo = segments(to);

    let i = 0;
    while (i < segsFrom.length && i < segsTo.length && segsFrom[i] === segsTo[i]) {
        i += 1;
    }

    const ups = Array<string>(segsFrom.length - i).fill('..');
    const downs = segsTo.slice(i);

    return [...ups, ...downs].join('/');
}
