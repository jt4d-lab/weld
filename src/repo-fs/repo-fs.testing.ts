import { dirname } from '@/utils/path/index.js';

import { createRepoFs, type RepoFs } from '@/repo-fs/repo-fs.js';

/**
 * Фейковый `RepoFs` над списком виртуальных путей — без обращения к диску. Это настоящий
 * `createRepoFs` с root в корне ФС (виртуальный путь тогда совпадает с реальным, а `toVirtual`
 * становится identity для путей от `/`) поверх поддельного `exists`: подделывается только диск, а
 * поиск точки входа остается тем же, что и у правил в бою. Своя реализация `hasEntryPoint` здесь
 * разъезжалась бы со слоем на первой же правке правил поиска границы.
 */
export function createFakeRepoFs(files: string[]): RepoFs {
    return createRepoFs('/', { exists: createFakeExists(withAncestorDirectories(files)) });
}

/** Файлы плюс все их директории: `exists` слоя спрашивают и про директорию, и про файл в ней. */
function withAncestorDirectories(files: string[]): string[] {
    const paths = new Set(files);

    for (const file of files) {
        let dir = dirname(file);
        while (!paths.has(dir)) {
            paths.add(dir);
            const parent = dirname(dir);
            if (parent === dir) {
                break;
            }
            dir = parent;
        }
    }

    return [...paths];
}

/**
 * Фейковый предикат `exists` над списком реальных путей: существует ровно то, что в списке. Его
 * спрашивают и `createRepoFs` (опция `exists`), и `findRepoRoot` — форма вопроса одна, поэтому и
 * фейк один, а не по копии на тест каждого из них. Через баррель наружу не выходит: подделывать
 * диск помимо `RepoFs` нужно только самому слою.
 */
export function createFakeExists(realPaths: string[]): (realPath: string) => boolean {
    const set = new Set(realPaths);
    return (realPath) => set.has(realPath);
}
