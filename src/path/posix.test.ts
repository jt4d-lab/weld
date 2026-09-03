import { describe, expect, it } from 'vitest';

import {
    basename,
    commonDirectory,
    dirname,
    isAbsolutePath,
    relativePath,
    resolvePath,
    splitExtension,
    toPosix,
} from './posix.js';

describe('toPosix', () => {
    it('разворачивает обратные слэши в прямые', () => {
        expect(toPosix('C:\\p\\src\\feature')).toBe('C:/p/src/feature');
    });

    it('не трогает уже posix-путь', () => {
        expect(toPosix('/a/b/c')).toBe('/a/b/c');
    });
});

describe('isAbsolutePath', () => {
    it('posix-корень — абсолютный', () => {
        expect(isAbsolutePath('/a/b')).toBe(true);
    });

    it('Windows-диск как первый сегмент — абсолютный', () => {
        expect(isAbsolutePath('C:/a/b')).toBe(true);
    });

    it('относительный путь — не абсолютный', () => {
        expect(isAbsolutePath('a/b')).toBe(false);
        expect(isAbsolutePath('./a/b')).toBe(false);
        expect(isAbsolutePath('../a')).toBe(false);
    });
});

describe('dirname', () => {
    it('posix: обычный путь', () => {
        expect(dirname('/a/b/c')).toBe('/a/b');
    });

    it('posix: файл прямо в корне', () => {
        expect(dirname('/a')).toBe('/');
    });

    it('posix: у корня родителя нет', () => {
        expect(dirname('/')).toBe('/');
    });

    it('Windows: обычный путь', () => {
        expect(dirname('C:/a/b')).toBe('C:/a');
    });

    it('Windows: файл прямо в корне диска', () => {
        expect(dirname('C:/a')).toBe('C:/');
    });

    it('бросает на неабсолютном пути', () => {
        expect(() => dirname('a/b')).toThrow();
    });
});

describe('resolvePath', () => {
    it('схлопывает "." и "" сегменты', () => {
        expect(resolvePath('/a/b', './c')).toBe('/a/b/c');
        expect(resolvePath('/a/b', 'c')).toBe('/a/b/c');
    });

    it('схлопывает ".." вверх по дереву', () => {
        expect(resolvePath('/a/b/c', '../d')).toBe('/a/b/d');
        expect(resolvePath('/a/b/c', '../../d')).toBe('/a/d');
    });

    it('клэмпит выход выше стартовой директории', () => {
        expect(resolvePath('/a', '../../x')).toBe('/x');
        expect(resolvePath('/a', '../..')).toBe('/');
    });

    it('абсолютный path полностью заменяет base', () => {
        expect(resolvePath('/a/b', '/c/d')).toBe('/c/d');
    });
});

describe('basename', () => {
    it('последний сегмент абсолютного пути', () => {
        expect(basename('/a/b/c.ts')).toBe('c.ts');
    });

    it('относительный путь без слэша — весь путь', () => {
        expect(basename('index.ts')).toBe('index.ts');
    });
});

describe('splitExtension', () => {
    it('разделяет имя и расширение', () => {
        expect(splitExtension('index.ts')).toEqual({ name: 'index', ext: 'ts' });
    });

    it('без расширения — пустой ext, имя целиком', () => {
        expect(splitExtension('index')).toEqual({ name: 'index', ext: '' });
    });
});

describe('commonDirectory', () => {
    it('общий префикс есть', () => {
        expect(commonDirectory('/a/b/c', '/a/b/d')).toBe('/a/b');
    });

    it('пути совпадают', () => {
        expect(commonDirectory('/a/b', '/a/b')).toBe('/a/b');
    });

    it('общего корня нет — разные диски', () => {
        expect(commonDirectory('C:/a/b', 'D:/a/b')).toBeNull();
    });

    it('общего корня нет — диск и posix-корень', () => {
        expect(commonDirectory('C:/a/b', '/a/b')).toBeNull();
    });
});

describe('relativePath', () => {
    it('вниз', () => {
        expect(relativePath('/a', '/a/b/c')).toBe('b/c');
    });

    it('вверх', () => {
        expect(relativePath('/a/b/c', '/a/x')).toBe('../../x');
    });

    it('в сторону', () => {
        expect(relativePath('/a/b', '/a/c/d')).toBe('../c/d');
    });

    it('совпадающие пути дают пустую строку', () => {
        expect(relativePath('/a/b', '/a/b')).toBe('');
    });
});
