import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENTRY_EXTENSIONS } from '@/extensions.js';
import { basename } from '@/path/index.js';
import { cleanupTmpProjects, makeTmpProject } from '@/testing/index.js';

import { createFsHost, getFsHost, resetFsHostCaches } from '@/host/fs.js';
import { createFakeExists, createFakeFsHost } from '@/host/fs.testing.js';
import { commonRealDirectory } from '@/host/real-path.js';

describe('createFsHost.toVirtual', () => {
    it('путь внутри root → виртуальный от /', () => {
        const fsHost = createFsHost('/repo');
        expect(fsHost.toVirtual('/repo/src/x.ts')).toBe('/src/x.ts');
    });

    it('сам root → /', () => {
        const fsHost = createFsHost('/repo');
        expect(fsHost.toVirtual('/repo')).toBe('/');
    });

    it('путь вне root → null', () => {
        const fsHost = createFsHost('/repo');
        expect(fsHost.toVirtual('/other/x.ts')).toBeNull();
    });

    it('сегментная проверка: /repo-evil при root /repo → null', () => {
        const fsHost = createFsHost('/repo');
        expect(fsHost.toVirtual('/repo-evil/x.ts')).toBeNull();
    });

    it('Windows-путь C:\\proj\\src\\x.ts при root C:\\proj → /src/x.ts', () => {
        const fsHost = createFsHost('C:\\proj');
        expect(fsHost.toVirtual('C:\\proj\\src\\x.ts')).toBe('/src/x.ts');
    });

    it('регистр буквы диска не важен: c:\\proj\\src\\x.ts при root C:\\proj → /src/x.ts', () => {
        const fsHost = createFsHost('C:\\proj');
        expect(fsHost.toVirtual('c:\\proj\\src\\x.ts')).toBe('/src/x.ts');
    });

    it('регистр остальных сегментов важен: C:\\Proj при root C:\\proj → null', () => {
        const fsHost = createFsHost('C:\\proj');
        expect(fsHost.toVirtual('C:\\Proj\\src\\x.ts')).toBeNull();
    });

    it('относительный путь → null', () => {
        const fsHost = createFsHost('/repo');
        expect(fsHost.toVirtual('relative/path.ts')).toBeNull();
    });
});

describe('createFsHost: нормализация root', () => {
    it('root с завершающим слэшем (/repo/)', () => {
        const fsHost = createFsHost('/repo/');
        expect(fsHost.toVirtual('/repo/x.ts')).toBe('/x.ts');
    });

    it('root — корень ФС unix (/)', () => {
        const exists = vi.fn(() => true);
        const fsHost = createFsHost('/', { exists });
        expect(fsHost.toVirtual('/x.ts')).toBe('/x.ts');
        expect(fsHost.hasEntryPoint('/src')).toBe(true);
        expect(exists).toHaveBeenCalledWith('/src/index.ts');
    });

    it('root — корень ФС Windows (C:/)', () => {
        const exists = vi.fn(() => true);
        const fsHost = createFsHost('C:/', { exists });
        expect(fsHost.toVirtual('C:/x.ts')).toBe('/x.ts');
        expect(fsHost.hasEntryPoint('/src')).toBe(true);
        expect(exists).toHaveBeenCalledWith('C:/src/index.ts');
    });

    it('root — корень ФС Windows (C:\\)', () => {
        const exists = vi.fn(() => true);
        const fsHost = createFsHost('C:\\', { exists });
        expect(fsHost.toVirtual('C:\\x.ts')).toBe('/x.ts');
        expect(fsHost.hasEntryPoint('/src')).toBe(true);
        expect(exists).toHaveBeenCalledWith('C:/src/index.ts');
    });
});

describe('createFsHost.hasEntryPoint', () => {
    it('директория с index.ts — точка входа', () => {
        const fsHost = createFsHost('/repo', {
            exists: createFakeExists(['/repo/src/feature', '/repo/src/feature/index.ts']),
        });

        expect(fsHost.hasEntryPoint('/src/feature')).toBe(true);
    });

    it('index с другим известным расширением тоже считается точкой входа', () => {
        const fsHost = createFsHost('/repo', {
            exists: createFakeExists(['/repo/src/feature', '/repo/src/feature/index.mjs']),
        });

        expect(fsHost.hasEntryPoint('/src/feature')).toBe(true);
    });

    it('директория без index — не точка входа', () => {
        const fsHost = createFsHost('/repo', {
            exists: createFakeExists(['/repo/src/feature', '/repo/src/feature/other.ts']),
        });

        expect(fsHost.hasEntryPoint('/src/feature')).toBe(false);
    });

    it('несуществующая директория — один вызов exists, без перебора расширений', () => {
        const exists = vi.fn(() => false);
        const fsHost = createFsHost('/repo', { exists, now: () => 0 });

        expect(fsHost.hasEntryPoint('/src/feature')).toBe(false);
        expect(exists).toHaveBeenCalledTimes(1);
        expect(exists).toHaveBeenCalledWith('/repo/src/feature');
    });

    it('спуск в отсутствующую ветку: диск спрашивается только про первую директорию', () => {
        const exists = vi.fn(() => false);
        const fsHost = createFsHost('/repo', { exists, now: () => 0 });

        expect(fsHost.hasEntryPoint('/src/src')).toBe(false);
        expect(fsHost.hasEntryPoint('/src/src/client')).toBe(false);
        expect(fsHost.hasEntryPoint('/src/src/client/modules')).toBe(false);

        expect(exists).toHaveBeenCalledTimes(1);
        expect(exists).toHaveBeenCalledWith('/repo/src/src');
    });

    it('ответ «директории нет» кэшируется: повторный вызов не дёргает exists снова', () => {
        const exists = vi.fn(() => false);
        const fsHost = createFsHost('/repo', { exists, now: () => 0 });

        fsHost.hasEntryPoint('/src/feature');
        fsHost.hasEntryPoint('/src/feature');

        expect(exists).toHaveBeenCalledTimes(1);
    });

    it('dir не начинающийся с / → false без вызова нативного exists', () => {
        const exists = vi.fn(() => true);
        const fsHost = createFsHost('/repo', { exists });

        expect(fsHost.hasEntryPoint('src/feature')).toBe(false);
        expect(exists).not.toHaveBeenCalled();
    });

    it('положительный ответ кэшируется: повторный вызов не дёргает exists снова', () => {
        const exists = vi.fn(() => true);
        const fsHost = createFsHost('/repo', { exists, now: () => 0 });

        fsHost.hasEntryPoint('/src/feature');
        const afterFirst = exists.mock.calls.length;
        fsHost.hasEntryPoint('/src/feature');

        expect(exists.mock.calls.length).toBe(afterFirst);
    });

    it('отрицательный ответ кэшируется одной записью на директорию', () => {
        const exists = vi.fn(createFakeExists(['/repo/src/feature']));
        const fsHost = createFsHost('/repo', { exists, now: () => 0 });

        expect(fsHost.hasEntryPoint('/src/feature')).toBe(false);
        // Отрицательный ответ стоит проверки директории плюс перебора всех расширений — но ровно
        // одного, на первый вызов.
        expect(exists).toHaveBeenCalledTimes(1 + ENTRY_EXTENSIONS.length);

        expect(fsHost.hasEntryPoint('/src/feature')).toBe(false);
        expect(exists).toHaveBeenCalledTimes(1 + ENTRY_EXTENSIONS.length);
    });
});

describe('createFsHost: TTL-кэш', () => {
    it('положительный ответ в пределах 10 минут — кэш ещё живой', () => {
        let time = 0;
        const exists = vi.fn(() => true);
        const fsHost = createFsHost('/repo', { exists, now: () => time });

        fsHost.hasEntryPoint('/src/feature');
        time = 599_999;
        fsHost.hasEntryPoint('/src/feature');

        // Директория и первое расширение — на первый вызов; второй обходится кэшем.
        expect(exists).toHaveBeenCalledTimes(2);
    });

    it('положительный ответ после 10 минут — перепроверяет диск', () => {
        let time = 0;
        const exists = vi.fn(() => true);
        const fsHost = createFsHost('/repo', { exists, now: () => time });

        fsHost.hasEntryPoint('/src/feature');
        time = 600_001;
        fsHost.hasEntryPoint('/src/feature');

        expect(exists).toHaveBeenCalledTimes(4);
    });

    it('отрицательный ответ живёт своим, коротким сроком: 5 секунд — уже перепроверка', () => {
        let time = 0;
        const exists = vi.fn(createFakeExists(['/repo/src/feature']));
        const fsHost = createFsHost('/repo', { exists, now: () => time });

        expect(fsHost.hasEntryPoint('/src/feature')).toBe(false);
        time = 5_001;
        expect(fsHost.hasEntryPoint('/src/feature')).toBe(false);

        // Дописанный за это время index.<ext> правило увидит, не дожидаясь десяти минут. Директорию
        // при этом не перепроверяет: её наличие — положительный ответ, у него срок прежний.
        expect(exists).toHaveBeenCalledTimes(1 + ENTRY_EXTENSIONS.length * 2);
    });

    it('отрицательный ответ в пределах 5 секунд — кэш ещё живой', () => {
        let time = 0;
        const exists = vi.fn(createFakeExists(['/repo/src/feature']));
        const fsHost = createFsHost('/repo', { exists, now: () => time });

        fsHost.hasEntryPoint('/src/feature');
        time = 4_999;
        fsHost.hasEntryPoint('/src/feature');

        expect(exists).toHaveBeenCalledTimes(1 + ENTRY_EXTENSIONS.length);
    });

    it('два инстанса createFsHost не делят кэш', () => {
        const exists = vi.fn(() => true);
        const now = () => 0;

        const a = createFsHost('/repo', { exists, now });
        const b = createFsHost('/repo', { exists, now });

        a.hasEntryPoint('/src/feature');
        b.hasEntryPoint('/src/feature');

        expect(exists).toHaveBeenCalledTimes(4);
    });
});

describe('getFsHost', () => {
    afterEach(() => {
        resetFsHostCaches();
        cleanupTmpProjects();
    });

    it('settings.weld.repoRoot выигрывает у авто-поиска', () => {
        const settings = { weld: { repoRoot: '/explicit-root' } };
        const fsHost = getFsHost(settings, '/some/cwd');

        expect(fsHost.toVirtual('/explicit-root/x.ts')).toBe('/x.ts');
    });

    it('относительный root резолвится от cwd', () => {
        const settings = { weld: { repoRoot: './packages/app' } };
        const fsHost = getFsHost(settings, '/home/user/repo');

        expect(fsHost.toVirtual('/home/user/repo/packages/app/x.ts')).toBe('/x.ts');
    });

    it('относительный root с подъёмом ..', () => {
        const settings = { weld: { repoRoot: '../shared' } };
        const fsHost = getFsHost(settings, '/home/user/repo/packages/app');

        expect(fsHost.toVirtual('/home/user/repo/packages/shared/x.ts')).toBe('/x.ts');
    });

    it('settings.weld.repoRoot не строка → исключение', () => {
        const settings = { weld: { repoRoot: 123 } };

        expect(() => getFsHost(settings, '/some/cwd')).toThrow(/settings\.weld\.repoRoot/);
    });

    it('без настройки — findRepoRoot находит директорию с package.json', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });

        const fsHost = getFsHost(undefined, `${dir}/src`);

        expect(fsHost.toVirtual(`${dir}/package.json`)).toBe('/package.json');
    });

    it('без настройки, ничего не найдено — фолбэк на cwd', () => {
        const dir = makeTmpProject();

        const fsHost = getFsHost(undefined, dir);

        expect(fsHost.toVirtual(`${dir}/x.ts`)).toBe('/x.ts');
    });

    it('повторный вызов с тем же root возвращает тот же инстанс', () => {
        const settings = { weld: { repoRoot: '/same-root' } };

        const a = getFsHost(settings, '/cwd');
        const b = getFsHost(settings, '/cwd');

        expect(a).toBe(b);
    });

    it('resetFsHostCaches сбрасывает кэш инстансов', () => {
        const settings = { weld: { repoRoot: '/same-root' } };

        const a = getFsHost(settings, '/cwd');
        resetFsHostCaches();
        const b = getFsHost(settings, '/cwd');

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

describe('getFsHost: coverDirs', () => {
    afterEach(() => {
        resetFsHostCaches();
        cleanupTmpProjects();
    });

    it('авто-root поднимается до общей директории с coverDirs', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });
        const sibling = `${tmpdir()}/weld-fs-sibling`;

        const fsHost = getFsHost(undefined, dir, undefined, [sibling]);

        // Общая директория dir и sibling — tmpdir, значит dir виден как /<basename(dir)>.
        expect(fsHost.toVirtual(`${dir}/x.ts`)).toBe(`/${basename(dir)}/x.ts`);
    });

    it('coverDirs ниже найденного root ничего не меняют', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });

        const fsHost = getFsHost(undefined, dir, undefined, [`${dir}/src`]);

        expect(fsHost.toVirtual(`${dir}/x.ts`)).toBe('/x.ts');
    });

    it('coverDir без общего префикса (другой диск) игнорируется', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });

        const fsHost = getFsHost(undefined, dir, undefined, ['D:/elsewhere']);

        expect(fsHost.toVirtual(`${dir}/x.ts`)).toBe('/x.ts');
    });

    it('несколько coverDirs сразу: чужой диск игнорируется, поднимающая директория работает', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });
        const sibling = `${tmpdir()}/weld-fs-sibling`;

        const fsHost = getFsHost(undefined, dir, undefined, ['D:/elsewhere', sibling]);

        // Как и в тесте с одним coverDir: общая директория dir и sibling — tmpdir.
        expect(fsHost.toVirtual(`${dir}/x.ts`)).toBe(`/${basename(dir)}/x.ts`);
    });

    it('явный root игнорирует coverDirs целиком', () => {
        const settings = { weld: { repoRoot: '/explicit-root' } };

        const fsHost = getFsHost(settings, '/some/cwd', undefined, ['/some']);

        expect(fsHost.toVirtual('/explicit-root/x.ts')).toBe('/x.ts');
        expect(fsHost.toVirtual('/some/other.ts')).toBeNull();
    });

    it('кэш инстансов ключуется итоговым root: разные coverDirs → разные инстансы', () => {
        const dir = makeTmpProject({ 'package.json': '{}' });
        const sibling = `${tmpdir()}/weld-fs-sibling`;

        const raised = getFsHost(undefined, dir, undefined, [sibling]);
        const plain = getFsHost(undefined, dir);
        const raisedAgain = getFsHost(undefined, dir, undefined, [sibling]);

        expect(raised).not.toBe(plain);
        expect(raisedAgain).toBe(raised);
    });
});

describe('createFakeFsHost', () => {
    it('hasEntryPoint — по наличию index.<ext> в списке', () => {
        const fsHost = createFakeFsHost(['/src/feature/index.ts']);

        expect(fsHost.hasEntryPoint('/src/feature')).toBe(true);
        expect(fsHost.hasEntryPoint('/src/other')).toBe(false);
    });

    it('toVirtual — identity для путей, начинающихся с /', () => {
        const fsHost = createFakeFsHost([]);

        expect(fsHost.toVirtual('/src/feature/x.ts')).toBe('/src/feature/x.ts');
    });

    it('toVirtual — null для путей без ведущего /', () => {
        const fsHost = createFakeFsHost([]);

        expect(fsHost.toVirtual('src/feature/x.ts')).toBeNull();
    });
});
