/**
 * Временный мини-проект на реальном диске — для тестов, которым нужен настоящий `tsconfig.json`
 * или `package.json`, а не фикстура из `fixtures/`: сценарий с правкой файла между вызовами или с
 * директорией, у которой заведомо нет `.git` над ней.
 *
 * Уборка не на вызывающем: `try/finally` вокруг каждого сценария разъезжается (часть тестов теряла
 * бы директорию на упавшем assert), поэтому созданное копится здесь, а тест зовет
 * `cleanupTmpProjects` из своего `afterEach`.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from './paths.js';

const created: string[] = [];

/**
 * Вид ссылки: на Windows директорную ссылку (`dir`) создает только процесс с правами
 * администратора или включенным Developer Mode, а junction доступен всем и целится абсолютным путем.
 * На posix `junction` не существует, поэтому там обычная ссылка на директорию.
 */
const DIRECTORY_LINK_TYPE: 'dir' | 'junction' = process.platform === 'win32' ? 'junction' : 'dir';

/**
 * Создает временный проект из пар «относительный путь → содержимое» (директории создаются сами) и
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

/**
 * Ставит в проект `node_modules` этого репозитория симлинком. Нужно тестам, которые запускают
 * настоящий ESLint из проекта-потребителя (`weld` грузит `eslint` оттуда, а не от себя): пакет
 * оказывается там же, где он лежит у пользователя, а распаковывать его в каждый тест незачем.
 */
export function linkRepoNodeModules(root: string): void {
    symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), DIRECTORY_LINK_TYPE);
}

/** Удаляет всё, что создал `makeTmpProject` с прошлой уборки. */
export function cleanupTmpProjects(): void {
    for (const root of created.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
}
