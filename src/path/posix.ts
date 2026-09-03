// Сегментные операции над posix-путями, без `node:path`. `node:path/posix` не подходит:
// на Windows нормализованный `C:/p/src` для него не абсолютен, и `relative()` молча
// дорезолвит такой путь от `process.cwd()` — скрытая зависимость от глобального состояния
// прямо в ядре правила. Здесь только строковая арифметика над сегментами.

/** Заменяет `\` на `/`. Единственное место, где путь узнаёт про Windows-разделители. */
export function toPosix(path: string): string {
    return path.replaceAll('\\', '/');
}

/**
 * Абсолютен ли путь: posix-корень (`/...`) или путь с диском в качестве первого сегмента
 * (`C:/...`). Оба варианта — общий случай для арифметики на сегментах ниже.
 */
export function isAbsolutePath(path: string): boolean {
    if (path.startsWith('/')) {
        return true;
    }

    const [first] = splitSegments(path);
    return first !== undefined && isDriveSegment(first);
}

/**
 * Директория пути: всё, кроме последнего сегмента. Для пути в корне (`/c.ts`) возвращает
 * корень (`/`), а не пустую строку — иначе арифметика ниже теряет информацию о корне.
 */
export function dirname(path: string): string {
    const root = rootOf(path);
    const segments = splitSegments(path.slice(root.length));
    const dirSegments = segments.slice(0, -1);

    if (dirSegments.length === 0) {
        return root === '' ? '.' : root;
    }

    return root + dirSegments.join('/');
}

/**
 * Резолвит `relativeOrAbsolute` относительно `base`, схлопывая `.` и `..`. Выход выше базы
 * не является ошибкой (импорт в соседний пакет монорепы — обычное дело): сегменты `..`,
 * которым нечего схлопывать, остаются в результате как есть.
 */
export function resolvePath(base: string, relativeOrAbsolute: string): string {
    const path = isAbsolutePath(relativeOrAbsolute)
        ? relativeOrAbsolute
        : `${base}/${relativeOrAbsolute}`;
    const root = rootOf(path);
    const segments = splitSegments(path.slice(root.length));

    const resolved: string[] = [];
    for (const segment of segments) {
        if (segment === '' || segment === '.') {
            continue;
        }
        if (segment === '..') {
            const last = resolved.at(-1);
            if (last !== undefined && last !== '..') {
                resolved.pop();
            } else {
                resolved.push('..');
            }
            continue;
        }
        resolved.push(segment);
    }

    return root + resolved.join('/');
}

/**
 * Самая глубокая общая директория двух абсолютных путей. `null`, если общего корня нет
 * (разные диски на Windows) — арифметика границ в этом случае бессмысленна, а не ошибочна.
 */
export function commonDirectory(a: string, b: string): string | null {
    const rootA = rootOf(a);
    const rootB = rootOf(b);

    if (rootA !== rootB) {
        return null;
    }

    const segmentsA = splitSegments(a.slice(rootA.length));
    const segmentsB = splitSegments(b.slice(rootB.length));

    const common: string[] = [];
    for (let i = 0; i < segmentsA.length && i < segmentsB.length; i++) {
        if (segmentsA[i] !== segmentsB[i]) {
            break;
        }
        common.push(segmentsA[i] as string);
    }

    return rootA + common.join('/');
}

/**
 * Путь `to` относительно `from`, без префикса `./` — его добавляет `renderSpecifier`,
 * которому он нужен не всегда (алиасная форма вывода обходится без него).
 */
export function relativePath(from: string, to: string): string {
    const base = commonDirectory(from, to);
    if (base === null) {
        // разных корней в вызывающем коде не бывает (до сюда доходит только после
        // успешного findBarrier), но на случай прямого вызова — не молчим на NaN-путях.
        throw new Error(`relativePath: no common root between "${from}" and "${to}"`);
    }

    const fromSegments = splitSegments(from.slice(base.length));
    const toSegments = splitSegments(to.slice(base.length));

    const ups = fromSegments.map(() => '..');

    return [...ups, ...toSegments].join('/');
}

function rootOf(path: string): string {
    if (path.startsWith('/')) {
        return '/';
    }

    const [first] = splitSegments(path);
    if (first !== undefined && isDriveSegment(first)) {
        return `${first}/`;
    }

    return '';
}

function isDriveSegment(segment: string): boolean {
    return /^[A-Za-z]:$/.test(segment);
}

function splitSegments(path: string): string[] {
    return path.split('/').filter((segment) => segment !== '');
}
