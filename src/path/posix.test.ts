import { describe, expect, it } from 'vitest';
import {
    basename,
    commonDepth,
    dirname,
    relativePath,
    resolvePath,
    splitExtension,
    toPosix,
} from '@/path/posix.js';

describe('toPosix', () => {
    it('заменяет обратные слэши на прямые', () => {
        expect(toPosix('C:\\proj\\src\\x.ts')).toBe('C:/proj/src/x.ts');
    });

    it('буква диска остаётся первым сегментом', () => {
        expect(toPosix('C:\\proj')).toBe('C:/proj');
    });

    it('не трогает уже posix-путь', () => {
        expect(toPosix('/src/feature/x.ts')).toBe('/src/feature/x.ts');
    });
});

describe('dirname', () => {
    it('директория выше файла', () => {
        expect(dirname('/src/feature/x.ts')).toBe('/src/feature');
    });

    it('директория выше вложенной директории', () => {
        expect(dirname('/src/feature')).toBe('/src');
    });

    it('у корня родителя нет — возвращает сам корень', () => {
        expect(dirname('/')).toBe('/');
    });

    it('однослойный путь от корня', () => {
        expect(dirname('/src')).toBe('/');
    });
});

describe('basename', () => {
    it('имя файла после последнего слэша', () => {
        expect(basename('/src/feature/x.ts')).toBe('x.ts');
    });

    it('имя директории без хвостового слэша', () => {
        expect(basename('/src/feature')).toBe('feature');
    });

    it('корень: пустая строка', () => {
        expect(basename('/')).toBe('');
    });
});

describe('splitExtension', () => {
    it('нет расширения', () => {
        expect(splitExtension('index')).toEqual({ name: 'index', ext: '' });
    });

    it('с расширением', () => {
        expect(splitExtension('index.ts')).toEqual({ name: 'index', ext: 'ts' });
    });

    it('точка в середине имени берёт последний сегмент как расширение', () => {
        expect(splitExtension('index.test.ts')).toEqual({ name: 'index.test', ext: 'ts' });
    });

    it('ведущая точка без другого расширения — вся строка остаётся именем', () => {
        expect(splitExtension('.storybook')).toEqual({ name: '.storybook', ext: '' });
    });
});

describe('resolvePath', () => {
    it('схлопывает "." ', () => {
        expect(resolvePath('/src/feature', './x.ts')).toBe('/src/feature/x.ts');
    });

    it('схлопывает ".."', () => {
        expect(resolvePath('/src/feature', '../shared/x.ts')).toBe('/src/shared/x.ts');
    });

    it('схлопывает несколько ".." подряд', () => {
        expect(resolvePath('/src/feature/deep', '../../shared')).toBe('/src/shared');
    });

    it('абсолютный путь возвращается как есть (нормализованным)', () => {
        expect(resolvePath('/src/feature', '/other/x.ts')).toBe('/other/x.ts');
    });

    it('выход ".." выше "/" — null', () => {
        expect(resolvePath('/src', '../../shared/x')).toBeNull();
    });

    it('выход ".." ровно до корня — не null', () => {
        expect(resolvePath('/src', '..')).toBe('/');
    });
});

describe('commonDepth', () => {
    it('общий префикс существует', () => {
        expect(commonDepth('/src/feature/a.ts', '/src/feature/b.ts')).toBe(2);
    });

    it('пути совпадают', () => {
        expect(commonDepth('/src/feature', '/src/feature')).toBe(2);
    });

    it('общего нет — глубина 0 (корень)', () => {
        expect(commonDepth('/src/feature/a.ts', '/pkg/other/b.ts')).toBe(0);
    });
});

describe('relativePath', () => {
    it('вниз', () => {
        expect(relativePath('/src', '/src/feature/x.ts')).toBe('feature/x.ts');
    });

    it('вверх', () => {
        expect(relativePath('/src/feature/deep', '/src')).toBe('../..');
    });

    it('в сторону', () => {
        expect(relativePath('/src/feature', '/src/other/x.ts')).toBe('../other/x.ts');
    });

    it('совпадающие пути — пустая строка, без "./"', () => {
        expect(relativePath('/src/feature', '/src/feature')).toBe('');
    });
});
