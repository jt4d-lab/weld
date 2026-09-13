/**
 * Временный мини-проект на реальном диске — для тестов, которым нужен настоящий `tsconfig.json`
 * или `package.json`, а не фикстура из `fixtures/`: сценарий с правкой файла между вызовами или с
 * директорией, у которой заведомо нет `.git` над ней.
 *
 * Уборка не на вызывающем: `try/finally` вокруг каждого сценария разъезжается (часть тестов теряла
 * бы директорию на упавшем assert), поэтому созданное копится здесь, а тест зовёт
 * `cleanupTmpProjects` из своего `afterEach`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const created: string[] = [];

/**
 * Создаёт временный проект из пар «относительный путь → содержимое» (директории создаются сами) и
 * возвращает его реальный корень. Без файлов — просто пустая директория.
 */
export function makeTmpProject(files: Record<string, string> = {}): string {
    const root = mkdtempSync(`${tmpdir()}/weld-test-`);
    created.push(root);

    for (const [relPath, content] of Object.entries(files)) {
        const full = `${root}/${relPath}`;
        mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
        writeFileSync(full, content);
    }

    return root;
}

/** Удаляет всё, что создал `makeTmpProject` с прошлой уборки. */
export function cleanupTmpProjects(): void {
    for (const root of created.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
}
