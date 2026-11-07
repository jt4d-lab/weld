import { describe, expect, it } from 'vitest';

import type { Scheme } from '@/settings/index.js';

import type { FileMeta } from './locate.js';
import { locateFile, renderModuleName } from './locate.js';

/** Схема таблицы примеров из `docs/cli/inspect.md`: слой проекта `app`, слой модулей `features`. */
const scheme: Scheme = {
    srcDir: '/src',
    modulesDir: 'modules',
    layers: ['app', '@modules'],
    moduleLayers: ['features'],
    flatModules: false,
};

function locate(path: string, overrides: Partial<Scheme> = {}): FileMeta {
    return locateFile(path, { ...scheme, ...overrides });
}

/** Ожидаемые метаданные: те же поля, что у `FileMeta`, плюс путь файла как имя теста. */
type MetaRow = FileMeta & { path: string };

describe('locateFile — таблица примеров', () => {
    it.each<MetaRow>([
        {
            path: '/src/app/nested/pages/x.ts',
            module: [],
            layer: 'app',
            innerPath: 'nested/pages/x.ts',
        },
        {
            path: '/src/utils/format.ts',
            module: [],
            layer: '@unknown',
            innerPath: 'utils/format.ts',
        },
        {
            path: '/src/modules/billing/features/panel.ts',
            module: ['billing'],
            layer: 'features',
            innerPath: 'panel.ts',
        },
        {
            path: '/src/modules/billing/modules/subscription/features/panel.ts',
            module: ['billing', 'subscription'],
            layer: 'features',
            innerPath: 'panel.ts',
        },
        {
            path: '/src/modules/billing/api/x.ts',
            module: ['billing'],
            layer: '@unknown',
            innerPath: 'api/x.ts',
        },
        {
            path: '/src/modules/billing/modules/foo.ts',
            module: ['billing'],
            layer: '@unknown',
            innerPath: 'modules/foo.ts',
        },
        { path: '/src/modules/x.ts', module: [], layer: '@unknown', innerPath: 'modules/x.ts' },
    ])('$path → слой $layer', ({ path, module, layer, innerPath }) => {
        expect(locate(path)).toEqual({ module, layer, innerPath });
    });

    it('маркер @unknown в схеме не меняет результат', () => {
        expect(locate('/src/utils/format.ts', { layers: ['app', '@unknown', '@modules'] })).toEqual(
            {
                module: [],
                layer: '@unknown',
                innerPath: 'utils/format.ts',
            },
        );
    });
});

describe('locateFile — точки входа и границы директорий', () => {
    it.each<MetaRow>([
        { path: '/src/index.ts', module: [], layer: '@unknown', innerPath: 'index.ts' },
        { path: '/src/app/index.ts', module: [], layer: 'app', innerPath: 'index.ts' },
        {
            path: '/src/modules/billing/index.ts',
            module: ['billing'],
            layer: '@unknown',
            innerPath: 'index.ts',
        },
        {
            path: '/src/modules/billing/features/index.ts',
            module: ['billing'],
            layer: 'features',
            innerPath: 'index.ts',
        },
        {
            path: '/src/modules/a/modules/b/index.ts',
            module: ['a', 'b'],
            layer: '@unknown',
            innerPath: 'index.ts',
        },
        {
            path: '/src/modules/a/modules/b/modules/c/features/x.ts',
            module: ['a', 'b', 'c'],
            layer: 'features',
            innerPath: 'x.ts',
        },
        {
            path: '/src/modules/a/modules/b/api/x.ts',
            module: ['a', 'b'],
            layer: '@unknown',
            innerPath: 'api/x.ts',
        },
        {
            path: '/src/modules/a/modules/b.ts',
            module: ['a'],
            layer: '@unknown',
            innerPath: 'modules/b.ts',
        },
        {
            path: '/src/modules/billing/features/ui/deep/x.ts',
            module: ['billing'],
            layer: 'features',
            innerPath: 'ui/deep/x.ts',
        },
    ])('$path → модуль $module', ({ path, module, layer, innerPath }) => {
        expect(locate(path)).toEqual({ module, layer, innerPath });
    });

    it.each<MetaRow>([
        { path: '/src/utils/app/x.ts', module: [], layer: '@unknown', innerPath: 'utils/app/x.ts' },
        {
            path: '/src/modules/billing/api/features/x.ts',
            module: ['billing'],
            layer: '@unknown',
            innerPath: 'api/features/x.ts',
        },
        {
            path: '/src/modules/billing/app/x.ts',
            module: ['billing'],
            layer: '@unknown',
            innerPath: 'app/x.ts',
        },
    ])('слой ищется только в первом сегменте: $path', ({ path, module, layer, innerPath }) => {
        expect(locate(path)).toEqual({ module, layer, innerPath });
    });

    it.each<MetaRow>([
        { path: '/src/features/x.ts', module: [], layer: '@unknown', innerPath: 'features/x.ts' },
        {
            path: '/src/modules/features/x.ts',
            module: ['features'],
            layer: '@unknown',
            innerPath: 'x.ts',
        },
        {
            path: '/src/modules/billing/modules/x.ts',
            module: ['billing'],
            layer: '@unknown',
            innerPath: 'modules/x.ts',
        },
    ])(
        'файл не бывает директорией модуля или слоя: $path',
        ({ path, module, layer, innerPath }) => {
            expect(locate(path)).toEqual({ module, layer, innerPath });
        },
    );
});

describe('locateFile — своя схема', () => {
    it('свой srcDir и modulesDir', () => {
        const overrides: Partial<Scheme> = {
            srcDir: '/source/code',
            modulesDir: 'mods',
            layers: ['app', '@modules'],
            moduleLayers: ['features'],
        };

        expect(locate('/source/code/app/ui/x.ts', overrides)).toEqual({
            module: [],
            layer: 'app',
            innerPath: 'ui/x.ts',
        });
        expect(locate('/source/code/mods/billing/features/x.ts', overrides)).toEqual({
            module: ['billing'],
            layer: 'features',
            innerPath: 'x.ts',
        });
    });

    it("srcDir: '.' — корень репозитория", () => {
        const overrides: Partial<Scheme> = { srcDir: '/' };

        expect(locate('/app/ui/x.ts', overrides)).toEqual({
            module: [],
            layer: 'app',
            innerPath: 'ui/x.ts',
        });
        expect(locate('/modules/billing/features/x.ts', overrides)).toEqual({
            module: ['billing'],
            layer: 'features',
            innerPath: 'x.ts',
        });
    });

    it('совпадение с srcDir только по полному сегменту', () => {
        expect(() => locate('/src2/app/x.ts')).toThrow('/src2/app/x.ts is outside srcDir /src');
    });

    it('путь, равный srcDir, — @root без слоя и с пустым innerPath', () => {
        expect(locate('/src')).toEqual({ module: [], layer: '@unknown', innerPath: '' });
    });

    it("путь, равный srcDir: '.', — тот же результат", () => {
        expect(locate('/', { srcDir: '/' })).toEqual({
            module: [],
            layer: '@unknown',
            innerPath: '',
        });
    });
});

describe('locateFile — путь вне srcDir', () => {
    it('вне srcDir → исключение', () => {
        expect(() => locate('/other/app/x.ts')).toThrow('/other/app/x.ts is outside srcDir /src');
    });

    it('выше srcDir → исключение', () => {
        expect(() => locate('/other/x.ts', { srcDir: '/other/app' })).toThrow(
            '/other/x.ts is outside srcDir /other/app',
        );
    });
});

describe('locateFile — имена путей', () => {
    it('точки в именах файлов и директорий допустимы', () => {
        const overrides: Partial<Scheme> = { layers: ['app.v2', '@modules'] };

        expect(locate('/src/app.v2/ui/x.ts', overrides)).toEqual({
            module: [],
            layer: 'app.v2',
            innerPath: 'ui/x.ts',
        });
        expect(locate('/src/modules/billing.v2/features/panel.v2.ts', overrides)).toEqual({
            module: ['billing.v2'],
            layer: 'features',
            innerPath: 'panel.v2.ts',
        });
    });

    it.each([
        { path: '/src/modules/billing@2/features/x.ts', segment: 'billing@2' },
        { path: '/src/app/x:y.ts', segment: 'x:y.ts' },
        { path: '/src/@scope/x.ts', segment: '@scope' },
    ])('запрещенный символ в $path → исключение', ({ path, segment }) => {
        expect(() => locate(path)).toThrow(`"${segment}" must not contain "@" or ":"`);
    });

    it('сообщения об ошибках называют путь в том виде, как его ввели', () => {
        expect(() => locateFile('/other/app/x.ts', scheme, 'app/x.ts')).toThrow(
            'app/x.ts is outside srcDir /src',
        );
        expect(() => locateFile('/src/scope@2/x.ts', scheme, 'src/scope@2/x.ts')).toThrow(
            'src/scope@2/x.ts: "scope@2" must not contain "@" or ":"',
        );
    });

    it('сегменты самого srcDir проверке не подлежат', () => {
        expect(locate('/src/@scope/app/x.ts', { srcDir: '/src/@scope' })).toEqual({
            module: [],
            layer: 'app',
            innerPath: 'x.ts',
        });
    });
});

describe('locateFile — flatModules', () => {
    /** Таблица примеров из плана: корневые модули прямо в `srcDir`, вложенные — через контейнер. */
    const flat: Partial<Scheme> = {
        layers: ['app', '@modules', 'common'],
        moduleLayers: ['entities'],
        flatModules: true,
    };

    it.each<MetaRow>([
        // Имя из `layers` в корне побеждает модуль: слой, а не модуль.
        { path: '/src/app/file.ts', module: [], layer: 'app', innerPath: 'file.ts' },
        { path: '/src/common/file.ts', module: [], layer: 'common', innerPath: 'file.ts' },
        // Контейнер в корне не признается: поддерево целиком `@unknown`.
        {
            path: '/src/modules/x/file.ts',
            module: [],
            layer: '@unknown',
            innerPath: 'modules/x/file.ts',
        },
        // Корневой модуль прямо в `srcDir`.
        {
            path: '/src/auth/entities/file.ts',
            module: ['auth'],
            layer: 'entities',
            innerPath: 'file.ts',
        },
        // Вложенные модули в flat-режиме — через контейнер на любой глубине.
        {
            path: '/src/auth/modules/bar/entities/file.ts',
            module: ['auth', 'bar'],
            layer: 'entities',
            innerPath: 'file.ts',
        },
        { path: '/src/file.ts', module: [], layer: '@unknown', innerPath: 'file.ts' },
        { path: '/src/auth/file.ts', module: ['auth'], layer: '@unknown', innerPath: 'file.ts' },
    ])('flat, $path → модуль $module, слой $layer', ({ path, module, layer, innerPath }) => {
        expect(locate(path, flat)).toEqual({ module, layer, innerPath });
    });

    it.each<MetaRow>([
        { path: '/src/app/file.ts', module: [], layer: 'app', innerPath: 'file.ts' },
        { path: '/src/common/file.ts', module: [], layer: 'common', innerPath: 'file.ts' },
        // В дефолтном режиме контейнер в корне — модули идут через него.
        { path: '/src/modules/x/file.ts', module: ['x'], layer: '@unknown', innerPath: 'file.ts' },
        {
            path: '/src/auth/entities/file.ts',
            module: [],
            layer: '@unknown',
            innerPath: 'auth/entities/file.ts',
        },
        {
            path: '/src/auth/modules/bar/entities/file.ts',
            module: [],
            layer: '@unknown',
            innerPath: 'auth/modules/bar/entities/file.ts',
        },
        { path: '/src/file.ts', module: [], layer: '@unknown', innerPath: 'file.ts' },
        {
            path: '/src/auth/file.ts',
            module: [],
            layer: '@unknown',
            innerPath: 'auth/file.ts',
        },
    ])(
        'та же схема при flat=false: $path → модуль $module, слой $layer',
        ({ path, module, layer, innerPath }) => {
            expect(locate(path, { ...flat, flatModules: false })).toEqual({
                module,
                layer,
                innerPath,
            });
        },
    );

    it.each<MetaRow>([
        // Файл прямо в `srcDir` и файл в корне корневого модуля.
        { path: '/src/file.ts', module: [], layer: '@unknown', innerPath: 'file.ts' },
        { path: '/src/auth/index.ts', module: ['auth'], layer: '@unknown', innerPath: 'index.ts' },
        // Модуль может называться как слой модулей: имя в корне — модуль, а не слой.
        {
            path: '/src/entities/file.ts',
            module: ['entities'],
            layer: '@unknown',
            innerPath: 'file.ts',
        },
        // Поддерево корневого контейнера не скрывается даже на глубине.
        {
            path: '/src/modules/x/entities/file.ts',
            module: [],
            layer: '@unknown',
            innerPath: 'modules/x/entities/file.ts',
        },
        // Файл прямо в корневом контейнере.
        {
            path: '/src/modules/file.ts',
            module: [],
            layer: '@unknown',
            innerPath: 'modules/file.ts',
        },
    ])('flat, граничный случай: $path', ({ path, module, layer, innerPath }) => {
        expect(locate(path, flat)).toEqual({ module, layer, innerPath });
    });

    it('свой modulesDir в flat-режиме: в корне не признается, внутри модуля — да', () => {
        const overrides: Partial<Scheme> = { ...flat, modulesDir: 'mods' };

        expect(locate('/src/x/file.ts', overrides)).toEqual({
            module: ['x'],
            layer: '@unknown',
            innerPath: 'file.ts',
        });
        expect(locate('/src/mods/x/file.ts', overrides)).toEqual({
            module: [],
            layer: '@unknown',
            innerPath: 'mods/x/file.ts',
        });
        expect(locate('/src/x/mods/y/entities/file.ts', overrides)).toEqual({
            module: ['x', 'y'],
            layer: 'entities',
            innerPath: 'file.ts',
        });
    });
});

describe('locateFile — схема без модулей', () => {
    const noModules: Partial<Scheme> = { layers: ['app', 'common'], moduleLayers: [] };

    it.each<MetaRow>([
        { path: '/src/app/x.ts', module: [], layer: 'app', innerPath: 'x.ts' },
        { path: '/src/common/y.ts', module: [], layer: 'common', innerPath: 'y.ts' },
        {
            path: '/src/modules/billing/features/panel.ts',
            module: [],
            layer: '@unknown',
            innerPath: 'modules/billing/features/panel.ts',
        },
    ])('$path → $layer без модуля', ({ path, module, layer, innerPath }) => {
        expect(locate(path, noModules)).toEqual({ module, layer, innerPath });
    });

    it('flatModules без слоев модулей ничего не распознает в корне', () => {
        expect(locate('/src/order/entities/a.ts', { ...noModules, flatModules: true })).toEqual({
            module: [],
            layer: '@unknown',
            innerPath: 'order/entities/a.ts',
        });
    });
});

describe('renderModuleName', () => {
    it('пустая цепочка → @root', () => {
        expect(renderModuleName([])).toBe('@root');
    });

    it('один модуль печатается как есть', () => {
        expect(renderModuleName(['billing'])).toBe('billing');
    });

    it('цепочка модулей соединяется через ::', () => {
        expect(renderModuleName(['billing', 'subscription', 'panel'])).toBe(
            'billing::subscription::panel',
        );
    });
});
