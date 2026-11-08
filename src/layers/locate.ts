/**
 * Метаданные файла по его виртуальному пути: в каком модуле и слое он лежит и где внутри слоя.
 *
 * Модуль не читает диск и не знает ни ESLint, ни `src/config/`: на входе виртуальный путь и
 * разобранная схема, на выходе чистые данные, которые будущее правило сравнивает с цепочками других
 * файлов. Поэтому имя модуля хранится цепочкой, а строкой становится только при выводе.
 *
 * Принадлежность к слою определяется первым сегментом директории от корня проекта или модуля —
 * глубже слой не ищется. Последний сегмент пути — файл, поэтому директорией ни модуля, ни слоя он не
 * бывает.
 */

import { joinPath, relativePath, segments } from '@/utils/path/index.js';
import type { Scheme } from '@/settings/index.js';
import { UNKNOWN_MARKER } from '@/settings/index.js';

/** Разделитель имен в цепочке модулей при выводе. */
const MODULE_SEPARATOR = '::';

/** Имя корневого модуля в выводе: пустая цепочка — файл лежит прямо в `srcDir`. */
const ROOT_MODULE_NAME = '@root';

/** Имя пути внутри `srcDir`: `@` занят метками схемы, `:` — разделителем `MODULE_SEPARATOR`. */
const RESERVED_IN_NAME = /[@:]/;

/** Метаданные файла. */
export type FileMeta = {
    /** Цепочка имен модулей от внешнего к внутреннему; пустая — корень `srcDir`. */
    module: readonly string[];
    /** Имя слоя либо `@unknown`, если слой не определен. */
    layer: string;
    /** Путь от корня слоя, а при `@unknown` — от корня модуля (`@root` — от `srcDir`). */
    innerPath: string;
};

/**
 * Определяет метаданные файла.
 *
 * Путь вне `srcDir` метаданных не имеет — исключение; имена внутри `srcDir` с `@` или `:` тоже,
 * иначе имя модуля или слоя нельзя было бы напечатать однозначно. Путь, равный самому `srcDir`,
 * ошибки не дает: это `@root` без слоя и с пустым `innerPath`.
 *
 * @param shownPath Путь в тексте ошибок: метаданные считаются по виртуальному, а CLI показывает
 * аргумент в том виде, как его ввели.
 */
export function locateFile(path: string, scheme: Scheme, shownPath = path): FileMeta {
    const inner = insideSrcDir(path, scheme.srcDir);

    if (inner === null) {
        throw new Error(`${shownPath} is outside srcDir ${scheme.srcDir}`);
    }

    for (const segment of inner) {
        if (RESERVED_IN_NAME.test(segment)) {
            throw new Error(`${shownPath}: "${segment}" must not contain "@" or ":"`);
        }
    }

    const { module, rest, root } = descendModules(inner, scheme);
    const layers = module.length === 0 ? scheme.layers : scheme.moduleLayers;
    const layer = layerOf(rest, layers);
    const layerRoot = layer === UNKNOWN_MARKER ? root : joinPath(root, layer);

    return { module, layer, innerPath: relativePath(layerRoot, path) };
}

/** Имя модуля для вывода: цепочка соединяется через `::`, пустая цепочка — `@root`. */
export function renderModuleName(module: readonly string[]): string {
    return module.length === 0 ? ROOT_MODULE_NAME : module.join(MODULE_SEPARATOR);
}

/** Сегменты пути ниже `srcDir`; `null` — путь в нее не входит. */
function insideSrcDir(path: string, srcDir: string): string[] | null {
    const rootSegments = segments(srcDir);
    const pathSegments = segments(path);

    if (pathSegments.length < rootSegments.length) {
        return null;
    }

    const inside = rootSegments.every((segment, index) => pathSegments[index] === segment);
    return inside ? pathSegments.slice(rootSegments.length) : null;
}

/**
 * Спуск по контейнерам модулей: `modules/billing/modules/subscription/...` дает цепочку
 * `billing::subscription`.
 *
 * Контейнер — на каждом уровне вложенного режима; в `flatModules` — только внутри модулей, в корне
 * корневой модуль лежит прямо в `srcDir`. Без слоев модулей модулей в схеме нет: контейнер
 * `modulesDir` — обычная директория.
 *
 * @returns Цепочка модулей, сегменты ниже последнего модуля и виртуальный корень последнего
 * найденного модуля (`srcDir`, пока модулей нет).
 */
function descendModules(
    inner: string[],
    scheme: Scheme,
): { module: string[]; rest: string[]; root: string } {
    if (scheme.moduleLayers.length === 0) {
        return { module: [], rest: inner, root: scheme.srcDir };
    }

    const flat = scheme.flatModules;
    const module: string[] = [];
    let root = scheme.srcDir;
    let index = 0;

    // В flat-режиме корневой контейнер не распознается, и корневой модуль — первый сегмент,
    // только если это директория (под ней есть что-то), а не имя слоя и не сам контейнер.
    if (
        flat &&
        inner.length >= 2 &&
        !scheme.layers.includes(inner[0] as string) &&
        inner[0] !== scheme.modulesDir
    ) {
        module.push(inner[0] as string);
        root = joinPath(root, inner[0] as string);
        index = 1;
    }

    // Контейнер — директория, поэтому он засчитывается, только если под ним остались имя модуля и
    // что-то внутри него. В flat-режиме корневой контейнер цикл не поглощает (иначе `src/modules/x`
    // стал бы модулем `x`), но вложенные контейнеры работают на любой глубине.
    while (
        (!flat || module.length > 0) &&
        inner[index] === scheme.modulesDir &&
        index + 2 < inner.length
    ) {
        const name = inner[index + 1] as string;
        module.push(name);
        root = joinPath(joinPath(root, scheme.modulesDir), name);
        index += 2;
    }

    return { module, rest: inner.slice(index), root };
}

/** Слой по первому сегменту директории; файл слоем не бывает, незнакомое имя — `@unknown`. */
function layerOf(rest: readonly string[], layers: readonly string[]): string {
    // Слой — только директория: путь короче двух сегментов — файл или корень, не слой.
    if (rest.length < 2) {
        return UNKNOWN_MARKER;
    }

    const first = rest[0] as string;
    return layers.includes(first) ? first : UNKNOWN_MARKER;
}
