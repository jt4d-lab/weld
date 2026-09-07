/**
 * Арифметика реальных путей — внутренний словарь слоя `src/host/`, наружу не выходит.
 *
 * Здесь и только здесь живёт знание про формы реального пути: буквы дисков, корень ФС, склейка и
 * подъём вверх. `fs.ts` (перевод реального пути в виртуальный) и `root.ts` (поиск корня репозитория)
 * задают одни и те же вопросы; пока каждый отвечал на них у себя, «что считается диском» было
 * записано тремя литералами, и следующая правка кросс-платформенного поведения нашла бы не все.
 */

import path from 'node:path';

import { toPosix } from '@/path/index.js';

/** Ведущий Windows-диск (`C:`) реального пути после `toPosix`. */
const DRIVE_PREFIX = /^[A-Za-z]:/;

/** Путь — ровно диск без слэша (`C:`): для `win32` это не корень, а текущая директория диска. */
function isDriveRoot(realPath: string): boolean {
    return realPath.length === 2 && DRIVE_PREFIX.test(realPath);
}

/**
 * Абсолютность реального пути: unix (`/…`) или Windows-диск (`C:…`) — уже после `toPosix`.
 *
 * `path.win32.isAbsolute` здесь не подходит: он считает неабсолютными drive-relative пути `C:` и
 * `C:foo`, а нам нужен признак «путь несёт диск или корень» — иначе `resolveRealPath` пытался бы
 * дорезолвить `C:` от `cwd`, и root `C:` (то, во что `normalizeRoot` превращает корень
 * Windows-ФС `C:/`) уехал бы в директорию запуска ESLint.
 */
export function isAbsoluteRealPath(realPath: string): boolean {
    return realPath.startsWith('/') || DRIVE_PREFIX.test(realPath);
}

/**
 * Нормализует root: `toPosix`, без завершающего слэша. Корень ФС (`/`, `C:/`) — как `''` / `C:`,
 * чтобы `root + vpath` не удваивал `/`.
 *
 * `node:path` тут не помощник: `normalize`/`resolve` сохраняют корень как `/` и `C:\`, а нужна
 * именно строка-префикс для склейки `root + vpath`, для корня ФС пустая.
 */
export function normalizeRoot(root: string): string {
    const posix = toPosix(root);
    if (posix === '/') {
        return '';
    }

    return posix.endsWith('/') ? posix.slice(0, -1) : posix;
}

/** Соединяет директорию (в т.ч. корень `/` или `C:/`) с именем файла, не удваивая `/`. */
export function joinReal(dir: string, name: string): string {
    return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

/**
 * Директория выше `dir`. У корня ФС (`/`, `C:/`) родителя нет — возвращает сам корень, по чему
 * вызывающий код и определяет достижение верха.
 */
export function parentOf(dir: string): string {
    const idx = dir.lastIndexOf('/');
    if (idx === -1) {
        return dir;
    }

    const head = dir.slice(0, idx);
    if (head === '') {
        return '/';
    }
    if (isDriveRoot(head)) {
        return `${head}/`;
    }

    return head;
}

/**
 * Сравнение сегментов реального пути. Первый сегмент может быть Windows-диском — тогда буква
 * сравнивается без учёта регистра (`C:` и `c:` — один диск); остальные сегменты — строго:
 * регистрозависимость реальных ФС различается, и строгое сравнение — единственный ответ, не
 * зависящий от платформы запуска.
 */
export function sameSegment(left: string, right: string, index: number): boolean {
    if (index === 0 && DRIVE_PREFIX.test(left) && DRIVE_PREFIX.test(right)) {
        return left.toUpperCase() === right.toUpperCase();
    }

    return left === right;
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
export function resolveRealPath(base: string, target: string): string {
    const posixTarget = toPosix(target);
    if (isAbsoluteRealPath(posixTarget)) {
        return posixTarget;
    }

    const posixBase = toPosix(base);
    const resolveBase = isDriveRoot(posixBase) ? `${posixBase}/` : posixBase;
    const resolve = DRIVE_PREFIX.test(resolveBase) ? path.win32.resolve : path.posix.resolve;

    return toPosix(resolve(resolveBase, posixTarget));
}
