import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENTRY_EXTENSIONS } from '@/extensions.js';
import { basename, toPosix } from '@/utils/path/index.js';
import { cleanupTmpProjects, makeTmpProject } from '@/testing/index.js';

import { createRepoFs, getRepoFs, resetRepoFsCaches, resolveRoot } from '@/repo-fs/repo-fs.js';
import { createFakeExists, createFakeRepoFs } from '@/repo-fs/repo-fs.testing.js';
import { commonRealDirectory } from '@/repo-fs/real-path.js';

describe('createRepoFs.toVirtual', () => {
    it('путь внутри root → виртуальный от /', () => {
        const repoFs = createRepoFs('/repo');
        expect(repoFs.toVirtual('/repo/src/x.ts')).toBe('/src/x.ts');
    });

    it('сам root → /', () => {
        const repoFs = createRepoFs('/repo');
        expect(repoFs.toVirtual('/repo')).toBe('/');
    });

    it('путь вне root → null', () => {
        const repoFs = createRepoFs('/repo');
        expect(repoFs.toVirtual('/other/x.ts')).toBeNull();
    });

    it('сегментная проверка: /repo-evil при root /repo → null', () => {
        const repoFs = createRepoFs('/repo');
        expect(repoFs.toVirtual('/repo-evil/x.ts')).toBeNull();
    });

    it('Windows-путь C:\\proj\\src\\x.ts при root C:\\proj → /src/x.ts', () => {
        const repoFs = createRepoFs('C:\\proj');
        expect(repoFs.toVirtual('C:\\proj\\src\\x.ts')).toBe('/src/x.ts');
    });

    it('регистр буквы диска не важен: c:\\proj\\src\\x.ts при root C:\\proj → /src/x.ts', () => {
        const repoFs = createRepoFs('C:\\proj');
        expect(repoFs.toVirtual('c:\\proj\\src\\x.ts')).toBe('/src/x.ts');
    });

    it('регистр остальных сегментов важен: C:\\Proj при root C:\\proj → null', () => {
        const repoFs = createRepoFs('C:\\proj');
        expect(repoFs.toVirtual('C:\\Proj\\src\\x.ts')).toBeNull();
    });

    it('относительный путь → null', () => {
        const repoFs = createRepoFs('/repo');
        expect(repoFs.toVirtual('relative/path.ts')).toBeNull();
    });
});

describe('createRepoFs: нормализация root', () => {
    it('root с завершающим слэшем (/repo/)', () => {
        const repoFs = createRepoFs('/repo/');
        expect(repoFs.toVirtual('/repo/x.ts')).toBe('/x.ts');
    });

    it('root — корень ФС unix (/)', () => {
        const exists = vi.fn(() => true);
        const repoFs = createRepoFs('/', { exists });
        expect(repoFs.toVirtual('/x.ts')).toBe('/x.ts');
        expect(repoFs.hasEntryPoint('/src')).toBe(true);
        expect(exists).toHaveBeenCalledWith('/src/index.ts');
    });

    it('root — корень ФС Windows (C:/)', () => {
        const exists = vi.fn(() => true);
        const repoFs = createRepoFs('C:/', { exists });
        expect(repoFs.toVirtual('C:/x.ts')).toBe('/x.ts');
        expect(repoFs.hasEntryPoint('/src')).toBe(true);
        expect(exists).toHaveBeenCalledWith('C:/src/index.ts');
    });

    it('root — корень ФС Windows (C:\\)', () => {
        const exists = vi.fn(() => true);
        const repoFs = createRepoFs('C:\\', { exists });
        expect(repoFs.toVirtual('C:\\x.ts')).toBe('/x.ts');
        expect(repoFs.hasEntryPoint('/src')).toBe(true);
        expect(exists).toHaveBeenCalledWith('C:/src/index.ts');
    });
});

describe('createRepoFs.hasEntryPoint', () => {
    it('директория с index.ts — точка входа', () => {
        const repoFs = createRepoFs('/repo', {
            exists: createFakeExists(['/repo/src/feature', '/repo/src/feature/index.ts']),
        });

        expect(repoFs.hasEntryPoint('/src/feature')).toBe(true);
    });

    it('index с другим известным расширением тоже считается точкой входа', () => {
        const repoFs = createRepoFs('/repo', {
            exists: createFakeExists(['/repo/src/feature', '/repo/src/feature/index.mjs']),
        });

        expect(repoFs.hasEntryPoint('/src/feature')).toBe(true);
    });

    it('директория без index — не точка входа', () => {
        const repoFs = createRepoFs('/repo', {
            exists: createFakeExists(['/repo/src/feature', '/repo/src/feature/other.ts']),
        });

        expect(repoFs.hasEntryPoint('/src/feature')).toBe(false);
    });

    it('несуществующая директория — один вызов exists, без перебора расширений', () => {
        const exists = vi.fn(() => false);
        const repoFs = createRepoFs('/repo', { exists, now: () => 0 });

        expect(repoFs.hasEntryPoint('/src/feature')).toBe(false);
        expect(exists).toHaveBeenCalledTimes(1);
        expect(exists).toHaveBeenCalledWith('/repo/src/feature');
    });

    it('спуск в отсутствующую ветку: диск спрашивается только про первую директорию', () => {
        const exists = vi.fn(() => false);
        const repoFs = createRepoFs('/repo', { exists, now: () => 0 });

        expect(repoFs.hasEntryPoint('/src/src')).toBe(false);
        expect(repoFs.hasEntryPoint('/src/src/client')).toBe(false);
        expect(repoFs.hasEntryPoint('/src/src/client/modules')).toBe(false);

        expect(exists).toHaveBeenCalledTimes(1);
        expect(exists).toHaveBeenCalledWith('/repo/src/src');
    });

    it('ответ «директории нет» кэшируется: повторный вызов не дергает exists снова', () => {
        const exists = vi.fn(() => false);
        const repoFs = createRepoFs('/repo', { exists, now: () => 0 });

        repoFs.hasEntryPoint('/src/feature');
        repoFs.hasEntryPoint('/src/feature');

        expect(exists).toHaveBeenCalledTimes(1);
    });

    it('dir не начинающийся с / → false без вызова нативного exists', () => {
        const exists = vi.fn(() => true);
        const repoFs = createRepoFs('/repo', { exists });

        expect(repoFs.hasEntryPoint('src/feature')).toBe(false);
        expect(exists).not.toHaveBeenCalled();
    });

    it('положительный ответ кэшируется: повторный вызов не дергает exists снова', () => {
        const exists = vi.fn(() => true);
        const repoFs = createRepoFs('/repo', { exists, now: () => 0 });

        repoFs.hasEntryPoint('/src/feature');
        const afterFirst = exists.mock.calls.length;
        repoFs.hasEntryPoint('/src/feature');

        expect(exists.mock.calls.length).toBe(afterFirst);
    });

    it('отрицательный ответ кэшируется одной записью на директорию', () => {
        const exists = vi.fn(createFakeExists(['/repo/src/feature']));
        const repoFs = createRepoFs('/repo', { exists, now: () => 0 });

        expect(repoFs.hasEntryPoint('/src/feature')).toBe(false);
        // Отрицательный ответ стоит проверки директории плюс перебора всех расширений — но ровно
        // одного, на первый вызов.
        expect(exists).toHaveBeenCalledTimes(1 + ENTRY_EXTENSIONS.length);

        expect(repoFs.hasEntryPoint('/src/feature')).toBe(false);
        expect(exists).toHaveBeenCalledTimes(1 + ENTRY_EXTENSIONS.length);
    });
});

describe('createRepoFs.findModuleTarget', () => {
    it('находит файл с модульным расширением по пути без расширения', () => {
        const repoFs = createRepoFs('/repo', {
            exists: createFakeExists(['/repo/src/feature/account.entity.ts']),
        });

        expect(repoFs.findModuleTarget('/src/feature/account.entity')).toBe(
            '/src/feature/account.entity.ts',
        );
    });

    it('находит директорию с index', () => {
        const repoFs = createRepoFs('/repo', {
            exists: createFakeExists([
                '/repo/src/feature',
                '/repo/src/feature/account.entity',
                '/repo/src/feature/account.entity/index.ts',
            ]),
        });

        expect(repoFs.findModuleTarget('/src/feature/account.entity')).toBe(
            '/src/feature/account.entity/index.ts',
        );
    });

    it('ответ про точку входа остается в кэше: hasEntryPoint не дергает диск заново', () => {
        const exists = vi.fn(
            createFakeExists([
                '/repo/src/feature/account.entity',
                '/repo/src/feature/account.entity/index.ts',
            ]),
        );
        const repoFs = createRepoFs('/repo', { exists, now: () => 0 });

        repoFs.findModuleTarget('/src/feature/account.entity');
        const afterFind = exists.mock.calls.length;

        expect(repoFs.hasEntryPoint('/src/feature/account.entity')).toBe(true);
        expect(exists.mock.calls.length).toBe(afterFind);
    });

    it('файл побеждает директорию', () => {
        const repoFs = createRepoFs('/repo', {
            exists: createFakeExists([
                '/repo/src/feature/account.entity.ts',
                '/repo/src/feature/account.entity/index.ts',
            ]),
        });

        expect(repoFs.findModuleTarget('/src/feature/account.entity')).toBe(
            '/src/feature/account.entity.ts',
        );
    });

    it('null, если модуль не найден', () => {
        const repoFs = createRepoFs('/repo', {
            exists: createFakeExists(['/repo/src/feature']),
        });

        expect(repoFs.findModuleTarget('/src/feature/account.entity')).toBeNull();
    });

    it('null для пути без ведущего /', () => {
        const repoFs = createRepoFs('/repo', { exists: vi.fn(() => true) });

        expect(repoFs.findModuleTarget('src/feature/account.entity')).toBeNull();
    });

    it('кэширует результат: повторный вызов не дергает exists', () => {
        const exists = vi.fn(createFakeExists(['/repo/src/feature/account.entity.ts']));
        const repoFs = createRepoFs('/repo', { exists, now: () => 0 });

        repoFs.findModuleTarget('/src/feature/account.entity');
        const afterFirst = exists.mock.calls.length;
        repoFs.findModuleTarget('/src/feature/account.entity');

        expect(exists.mock.calls.length).toBe(afterFirst);
    });
});

describe('createRepoFs: TTL-кэш', () => {
    it('положительный ответ в пределах 10 минут — кэш еще живой', () => {
        let time = 0;
        const exists = vi.fn(() => true);
        const repoFs = createRepoFs('/repo', { exists, now: () => time });

        repoFs.hasEntryPoint('/src/feature');
        time = 599_999;
        repoFs.hasEntryPoint('/src/feature');

        // Директория и первое расширение — на первый вызов; второй обходится кэшем.
        expect(exists).toHaveBeenCalledTimes(2);
    });

    it('положительный ответ после 10 минут — перепроверяет диск', () => {
        let time = 0;
        const exists = vi.fn(() => true);
        const repoFs = createRepoFs('/repo', { exists, now: () => time });

        repoFs.hasEntryPoint('/src/feature');
        time = 600_001;
        repoFs.hasEntryPoint('/src/feature');

        expect(exists).toHaveBeenCalledTimes(4);
    });

    it('отрицательный ответ живет своим, коротким сроком: 5 секунд — уже перепроверка', () => {
        let time = 0;
        const exists = vi.fn(createFakeExists(['/repo/src/feature']));
        const repoFs = createRepoFs('/repo', { exists, now: () => time });

        expect(repoFs.hasEntryPoint('/src/feature')).toBe(false);
        time = 5_001;
        expect(repoFs.hasEntryPoint('/src/feature')).toBe(false);

        // Дописанный за это время index.<ext> правило увидит, не дожидаясь десяти минут. Директорию
        // при этом не перепроверяет: ее наличие — положительный ответ, у него срок прежний.
        expect(exists).toHaveBeenCalledTimes(1 + ENTRY_EXTENSIONS.length * 2);
    });

    it('отрицательный ответ в пределах 5 секунд — кэш еще живой', () => {
        let time = 0;
        const exists = vi.fn(createFakeExists(['/repo/src/feature']));
        const repoFs = createRepoFs('/repo', { exists, now: () => time });

        repoFs.hasEntryPoint('/src/feature');
        time = 4_999;
        repoFs.hasEntryPoint('/src/feature');

        expect(exists).toHaveBeenCalledTimes(1 + ENTRY_EXTENSIONS.length);
    });

    it('два инстанса createRepoFs не делят кэш', () => {
        const exists = vi.fn(() => true);
        const now = () => 0;

        const a = createRepoFs('/repo', { exists, now });
        const b = createRepoFs('/repo', { exists, now });

        a.hasEntryPoint('/src/feature');
        b.hasEntryPoint('/src/feature');

        expect(exists).toHaveBeenCalledTimes(4);
    });
});

describe('getRepoFs', () => {
    afterEach(() => {
        resetRepoFsCaches();
        cleanupTmpProjects();
    });

    it('settings.weld.repoRoot выигрывает у авто-поиска', () => {
        const settings = { weld: { repoRoot: '/explicit-root' } };
        const repoFs = getRepoFs(settings, '/some/cwd');

        expect(repoFs.toVirtual('/explicit-root/x.ts')).toBe('/x.ts');
    });

    it('относительный root резолвится от cwd', () => {
        const settings = { weld: { repoRoot: './packages/app' } };
        const repoFs = getRepoFs(settings, '/home/user/repo');

        expect(repoFs.toVirtual('/home/user/repo/packages/app/x.ts')).toBe('/x.ts');
    });

    it('относительный root с подъемом ..', () => {
        const settings = { weld: { repoRoot: '../shared' } };
        const repoFs = getRepoFs(settings, '/home/user/repo/packages/app');

        expect(repoFs.toVirtual('/home/user/repo/packages/shared/x.ts')).toBe('/x.ts');
    });

    it('settings.weld.repoRoot не строка → исключение', () => {
        const settings = { weld: { repoRoot: 123 } };

        expect(() => getRepoFs(settings, '/some/cwd')).toThrow(/settings\.weld\.repoRoot/);
    });

    it('без настройки — findRepoRoot находит директорию с package.json', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });

        const repoFs = getRepoFs(undefined, `${dir}/src`);

        expect(repoFs.toVirtual(`${dir}/package.json`)).toBe('/package.json');
    });

    it('без настройки, ничего не найдено — фолбэк на cwd', () => {
        const dir = makeTmpProject();

        const repoFs = getRepoFs(undefined, dir);

        expect(repoFs.toVirtual(`${dir}/x.ts`)).toBe('/x.ts');
    });

    it('повторный вызов с тем же root возвращает тот же инстанс', () => {
        const settings = { weld: { repoRoot: '/same-root' } };

        const a = getRepoFs(settings, '/cwd');
        const b = getRepoFs(settings, '/cwd');

        expect(a).toBe(b);
    });

    it('resetRepoFsCaches сбрасывает кэш инстансов', () => {
        const settings = { weld: { repoRoot: '/same-root' } };

        const a = getRepoFs(settings, '/cwd');
        resetRepoFsCaches();
        const b = getRepoFs(settings, '/cwd');

        expect(a).not.toBe(b);
    });
});

describe('commonRealDirectory', () => {
    it('обычные unix-пути: общий префикс — самая глубокая общая директория', () => {
        expect(commonRealDirectory('/a/b/x', '/a/b/y')).toBe('/a/b');
    });

    it('один путь — предок другого', () => {
        expect(commonRealDirectory('/a/b', '/a/b/c')).toBe('/a/b');
    });

    it('общего сегмента нет — общая директория корень ФС', () => {
        expect(commonRealDirectory('/a', '/b')).toBe('/');
    });

    it('сегментная проверка: /repo и /repo-evil не делят /repo', () => {
        expect(commonRealDirectory('/repo/src', '/repo-evil/src')).toBe('/');
    });

    it('Windows-пути с одним диском', () => {
        expect(commonRealDirectory('C:/proj/src', 'C:/proj/lib')).toBe('C:/proj');
    });

    it('Windows-пути с одним диском без общих сегментов — корень диска', () => {
        expect(commonRealDirectory('C:/a', 'C:/b')).toBe('C:/');
    });

    it('регистр буквы диска не важен: C: и c: — один диск', () => {
        expect(commonRealDirectory('C:/proj/src', 'c:/proj/lib')).toBe('C:/proj');
    });

    it('разные диски → общего префикса нет', () => {
        expect(commonRealDirectory('C:/a', 'D:/a')).toBeNull();
    });

    it('Windows-диск против unix-корня → общего префикса нет', () => {
        expect(commonRealDirectory('C:/a', '/a')).toBeNull();
    });
});

describe('resolveRoot', () => {
    afterEach(() => {
        resetRepoFsCaches();
        cleanupTmpProjects();
    });

    it('явный repoRoot побеждает и игнорирует coverDirs', () => {
        const settings = { weld: { repoRoot: '/explicit-root' } };

        expect(resolveRoot(settings, '/some/cwd', undefined, ['/some'])).toBe('/explicit-root');
        expect(resolveRoot(settings, '/some/cwd', '/override-root', ['/some'])).toBe(
            '/override-root',
        );
    });

    it('авто-root поднимается до общей директории с якорем', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });
        const sibling = `${tmpdir()}/weld-fs-sibling`;

        expect(resolveRoot(undefined, dir, undefined, [sibling])).toBe(toPosix(tmpdir()));
    });

    it('якорь без общего префикса (другой диск) игнорируется', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });

        expect(resolveRoot(undefined, dir, undefined, ['D:/elsewhere'])).toBe(toPosix(dir));
    });
});

describe('getRepoFs: coverDirs', () => {
    afterEach(() => {
        resetRepoFsCaches();
        cleanupTmpProjects();
    });

    it('авто-root поднимается до общей директории с coverDirs', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });
        const sibling = `${tmpdir()}/weld-fs-sibling`;

        const repoFs = getRepoFs(undefined, dir, undefined, [sibling]);

        // Общая директория dir и sibling — tmpdir, значит dir виден как /<basename(dir)>.
        expect(repoFs.toVirtual(`${dir}/x.ts`)).toBe(`/${basename(dir)}/x.ts`);
    });

    it('coverDirs ниже найденного root ничего не меняют', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });

        const repoFs = getRepoFs(undefined, dir, undefined, [`${dir}/src`]);

        expect(repoFs.toVirtual(`${dir}/x.ts`)).toBe('/x.ts');
    });

    it('coverDir без общего префикса (другой диск) игнорируется', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });

        const repoFs = getRepoFs(undefined, dir, undefined, ['D:/elsewhere']);

        expect(repoFs.toVirtual(`${dir}/x.ts`)).toBe('/x.ts');
    });

    it('несколько coverDirs сразу: чужой диск игнорируется, поднимающая директория работает', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });
        const sibling = `${tmpdir()}/weld-fs-sibling`;

        const repoFs = getRepoFs(undefined, dir, undefined, ['D:/elsewhere', sibling]);

        // Как и в тесте с одним coverDir: общая директория dir и sibling — tmpdir.
        expect(repoFs.toVirtual(`${dir}/x.ts`)).toBe(`/${basename(dir)}/x.ts`);
    });

    it('явный root игнорирует coverDirs целиком', () => {
        const settings = { weld: { repoRoot: '/explicit-root' } };

        const repoFs = getRepoFs(settings, '/some/cwd', undefined, ['/some']);

        expect(repoFs.toVirtual('/explicit-root/x.ts')).toBe('/x.ts');
        expect(repoFs.toVirtual('/some/other.ts')).toBeNull();
    });

    it('кэш инстансов ключуется итоговым root: разные coverDirs → разные инстансы', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });
        const sibling = `${tmpdir()}/weld-fs-sibling`;

        const raised = getRepoFs(undefined, dir, undefined, [sibling]);
        const plain = getRepoFs(undefined, dir);
        const raisedAgain = getRepoFs(undefined, dir, undefined, [sibling]);

        expect(raised).not.toBe(plain);
        expect(raisedAgain).toBe(raised);
    });
});

describe('createFakeRepoFs', () => {
    it('hasEntryPoint — по наличию index.<ext> в списке', () => {
        const repoFs = createFakeRepoFs(['/src/feature/index.ts']);

        expect(repoFs.hasEntryPoint('/src/feature')).toBe(true);
        expect(repoFs.hasEntryPoint('/src/other')).toBe(false);
    });

    it('toVirtual — identity для путей, начинающихся с /', () => {
        const repoFs = createFakeRepoFs([]);

        expect(repoFs.toVirtual('/src/feature/x.ts')).toBe('/src/feature/x.ts');
    });

    it('toVirtual — null для путей без ведущего /', () => {
        const repoFs = createFakeRepoFs([]);

        expect(repoFs.toVirtual('src/feature/x.ts')).toBeNull();
    });
});
