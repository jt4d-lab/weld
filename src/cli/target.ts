/**
 * Общее у команд: две части резолва, которые нужны обеим, и единый текст отказа. Внутренняя часть
 * слоя — команды берут части отсюда, а `program.ts` про этот модуль не знает.
 *
 * `weld inspect` и `weld config` спрашивают у резолва разное, но файл вне корня репозитория — один и
 * тот же отказ, и сообщение о нем должно быть одно: это одна причина, а не две похожие.
 */

import type { WeldTarget } from '@/config/index.js';

/**
 * Виртуальный путь файла — то, от чего `inspect` считает путь модуля. Заодно это проверка «файл
 * внутри корня»: `null` у резолва означает, что виртуального пути нет, и показывать нечего.
 */
export function virtualPathOf(target: WeldTarget, filePath: string): string {
    const fromFile = target.getFromFile();

    if (fromFile === null) {
        throw new Error(`${filePath} is outside the repository root`);
    }

    return fromFile;
}

/**
 * Реальный корень репозитория. `null` резолв отдает только поддельному `FsHost` — шов, которым CLI не
 * пользуется; проверка нужна, чтобы сузить тип, и на бою недостижима.
 */
export function repoRootOf(target: WeldTarget, filePath: string): string {
    const root = target.getRoot();

    if (root === null) {
        throw new Error(`repository root could not be resolved for ${filePath}`);
    }

    return root;
}
