import { describe, expect, it } from 'vitest';

import {
    commonDirectory,
    dirname,
    isAbsolutePath,
    relativePath,
    resolvePath,
    toPosix,
} from '../../src/path/posix.js';

describe('toPosix', () => {
    it('заменяет обратные слэши на прямые', () => {
        expect(toPosix('C:\\p\\src\\index.ts')).toBe('C:/p/src/index.ts');
    });

    it('не трогает уже posix-путь', () => {
        expect(toPosix('/p/src/index.ts')).toBe('/p/src/index.ts');
    });
});

describe('dirname', () => {
    it('возвращает директорию posix-пути', () => {
        expect(dirname('/a/b/c.ts')).toBe('/a/b');
    });

    it('для пути в корне возвращает корень', () => {
        expect(dirname('/c.ts')).toBe('/');
    });

    it('для Windows-пути возвращает директорию с диском', () => {
        expect(dirname('C:/p/src/index.ts')).toBe('C:/p/src');
    });
});

describe('isAbsolutePath', () => {
    it('posix-корень абсолютен', () => {
        expect(isAbsolutePath('/a/b')).toBe(true);
    });

    it('Windows-диск как первый сегмент абсолютен', () => {
        expect(isAbsolutePath('C:/p/src')).toBe(true);
    });

    it('относительный путь не абсолютен', () => {
        expect(isAbsolutePath('a/b')).toBe(false);
    });

    it('специфаер с точкой не абсолютен', () => {
        expect(isAbsolutePath('./a/b')).toBe(false);
    });
});

describe('resolvePath', () => {
    it('схлопывает "." относительно базы', () => {
        expect(resolvePath('/a/b', './c')).toBe('/a/b/c');
    });

    it('схлопывает ".." относительно базы', () => {
        expect(resolvePath('/a/b', '../c')).toBe('/a/c');
    });

    it('схлопывает несколько "." и ".." подряд', () => {
        expect(resolvePath('/a/b/c', '../../d/./e')).toBe('/a/d/e');
    });

    it('выход выше стартовой директории даёт путь с ведущими ".."', () => {
        expect(resolvePath('/a', '../../b')).toBe('/../b');
    });

    it('пустой относительный путь возвращает базу', () => {
        expect(resolvePath('/a/b', '.')).toBe('/a/b');
    });
});

describe('commonDirectory', () => {
    it('находит общий префикс сегментов', () => {
        expect(commonDirectory('/a/b/c', '/a/b/d')).toBe('/a/b');
    });

    it('совпадающие пути дают путь целиком', () => {
        expect(commonDirectory('/a/b', '/a/b')).toBe('/a/b');
    });

    it('разные корни (Windows-диски) дают null', () => {
        expect(commonDirectory('C:/a/b', 'D:/a/b')).toBeNull();
    });

    it('один путь — предок другого', () => {
        expect(commonDirectory('/a', '/a/b/c')).toBe('/a');
    });
});

describe('relativePath', () => {
    it('путь вниз по дереву', () => {
        expect(relativePath('/a/b', '/a/b/c')).toBe('c');
    });

    it('путь вверх по дереву', () => {
        expect(relativePath('/a/b/c', '/a/b')).toBe('..');
    });

    it('путь в сторону (общий предок выше обоих)', () => {
        expect(relativePath('/a/b', '/a/c')).toBe('../c');
    });

    it('совпадающие пути дают пустую строку без префикса "./"', () => {
        expect(relativePath('/a/b', '/a/b')).toBe('');
    });
});
