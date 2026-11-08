import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveForFile } from '@/config/index.js';
import type * as ConfigLayer from '@/config/index.js';
import { createFakeFsHost } from '@/repo-fs/index.js';
import { cleanupTmpProjects, linkRepoNodeModules, makeTmpProject } from '@/testing/index.js';

import { inspectFile } from './inspect.js';
import {
    ALIAS_CONFIG,
    OUTSIDE_ROOT_CONFIG,
    SCHEME_SETTINGS_TEXT,
    capture,
    makeCliProject,
    printed,
} from './program.testing.js';

vi.mock('../config/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof ConfigLayer>();

    return { ...actual, resolveForFile: vi.fn(actual.resolveForFile) };
});

/** Тот же проект, но без алиасов: автопоиск tsconfig в tmp-директории ничего не найдет. */
const NO_ALIASES_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliasesBaseUrl: '.', ${SCHEME_SETTINGS_TEXT} } },
    },
];
`;

/** Схема без маркера `@unknown`: код без слоя все равно печатается как `@unknown`. */
const NO_UNKNOWN_MARKER_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: {
            weld: {
                aliasesBaseUrl: '.',
                aliases: { '@/*': ['src/*'] },
                layers: ['app', '@modules'],
                moduleLayers: ['features'],
            },
        },
    },
];
`;

/** Схема без модулей: контейнер `modules` — обычная директория. */
const NO_MODULES_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: {
            weld: {
                aliasesBaseUrl: '.',
                aliases: { '@/*': ['src/*'] },
                layers: ['app', 'common'],
            },
        },
    },
];
`;

/** Схема без алиасов: и алиасы, и якоря для подъема корня приходят из tsconfig. */
const TSCONFIG_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { ${SCHEME_SETTINGS_TEXT} } },
    },
];
`;

/**
 * Схема без `layers`: `weld inspect` без нее работать не может, а `weld config` ее не запрашивает.
 */
const NO_SCHEME_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliasesBaseUrl: '.', aliases: { '@/*': ['src/*'] } } },
    },
];
`;

/** `srcDir: '.'`: файл в корне репозитория тоже попадает в схему. */
const ROOT_SRC_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliasesBaseUrl: '.', srcDir: '.', ${SCHEME_SETTINGS_TEXT} } },
    },
];
`;

/** Алиас с собственным хвостом в ключе: голый префикс такой записью не резолвится. */
const FEATURE_ALIAS_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@/feature/*': ['src/feature/*'] }, ${SCHEME_SETTINGS_TEXT} } },
    },
];
`;

/** Точный ключ без звездочки: специфаером становится сам префикс. */
const EXACT_ALIAS_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: { weld: { aliases: { '@/config': ['src/config'] }, ${SCHEME_SETTINGS_TEXT} } },
    },
];
`;

/** Точный ключ плюс широкий звездный: путь ниже точного якоря выражает только звездный. */
const EXACT_AND_STAR_ALIAS_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: {
            weld: {
                aliases: { '@/config': ['src/config'], '@/*': ['src/*'] },
                ${SCHEME_SETTINGS_TEXT},
            },
        },
    },
];
`;

/**
 * Два правила `weld/*` с разными схемами: CLI берет опции первого.
 *
 * Заглушки вместо настоящих правил — сценарию важен только выбор опций из эффективного конфига.
 */
const TWO_RULES_CONFIG = `const weld = {
    rules: {
        first: { meta: { schema: [{ type: 'object' }] }, create: () => ({}) },
        second: { meta: { schema: [{ type: 'object' }] }, create: () => ({}) },
    },
};

export default [
    {
        files: ['**/*.ts'],
        plugins: { weld },
        rules: {
            'weld/first': [
                'error',
                {
                    aliases: { '@/*': ['src/*'] },
                    srcDir: '.',
                    layers: ['src', '@modules'],
                    moduleLayers: ['inner'],
                },
            ],
            'weld/second': [
                'error',
                {
                    aliases: { '@/*': ['src/*'] },
                    layers: ['feature', '@modules'],
                    moduleLayers: ['inner'],
                },
            ],
        },
    },
];
`;

/** `layers` задает только второе правило: первое перекрывает настройки, но схемы не несет. */
const SECOND_RULE_SCHEME_CONFIG = `const weld = {
    rules: {
        first: { meta: { schema: [{ type: 'object' }] }, create: () => ({}) },
        second: { meta: { schema: [{ type: 'object' }] }, create: () => ({}) },
    },
};

export default [
    {
        files: ['**/*.ts'],
        plugins: { weld },
        rules: {
            'weld/first': ['error', { aliases: { '@/*': ['src/*'] } }],
            'weld/second': [
                'error',
                { layers: ['app', '@modules'], moduleLayers: ['features'] },
            ],
        },
    },
];
`;

/**
 * `flatModules: true`: корневой модуль лежит прямо в `srcDir`, а контейнер в корне
 * (`src/modules/`) не распознается.
 */
const FLAT_MODULES_CONFIG = `export default [
    {
        files: ['**/*.ts'],
        settings: {
            weld: {
                aliasesBaseUrl: '.',
                aliases: { '@/*': ['src/*'] },
                ${SCHEME_SETTINGS_TEXT},
                flatModules: true,
            },
        },
    },
];
`;

/** Одна строка таблицы примеров `weld inspect`: путь файла и его место в схеме. */
type MetaRow = { path: string; module: string; layer: string; innerPath: string };

/**
 * Примеры из `docs/cli/inspect.md` при `srcDir: 'src'`, `modulesDir: 'modules'`, слое проекта `app`
 * и слое модулей `features` — та же схема в `ALIAS_CONFIG`.
 */
const META_ROWS: MetaRow[] = [
    {
        path: 'src/app/nested/pages/x.ts',
        module: '@root',
        layer: 'app',
        innerPath: 'nested/pages/x.ts',
    },
    {
        path: 'src/utils/format.ts',
        module: '@root',
        layer: '@unknown',
        innerPath: 'utils/format.ts',
    },
    {
        path: 'src/modules/billing/features/panel.ts',
        module: 'billing',
        layer: 'features',
        innerPath: 'panel.ts',
    },
    {
        path: 'src/modules/billing/modules/subscription/features/panel.ts',
        module: 'billing::subscription',
        layer: 'features',
        innerPath: 'panel.ts',
    },
    {
        path: 'src/modules/billing/api/x.ts',
        module: 'billing',
        layer: '@unknown',
        innerPath: 'api/x.ts',
    },
    {
        path: 'src/modules/billing/modules/foo.ts',
        module: 'billing',
        layer: '@unknown',
        innerPath: 'modules/foo.ts',
    },
    {
        path: 'src/modules/x.ts',
        module: '@root',
        layer: '@unknown',
        innerPath: 'modules/x.ts',
    },
];

/** Проект с файлами таблицы: конфиг `ALIAS_CONFIG` и по пустому файлу на каждую строку. */
function makeMetadataProject(): string {
    return makeCliProject({
        'eslint.config.mjs': ALIAS_CONFIG,
        ...Object.fromEntries(META_ROWS.map(({ path }) => [path, ''])),
    });
}

/** Текстовый вывод `inspect`: подписи выровнены по самой длинной строке — `innerPath:`. */
function inspectOutput(fields: {
    file: string;
    alias: string;
    module: string;
    layer: string;
    innerPath: string;
}): string {
    return (
        [
            `file:      ${fields.file}`,
            `alias:     ${fields.alias}`,
            `module:    ${fields.module}`,
            `layer:     ${fields.layer}`,
            `innerPath: ${fields.innerPath}`,
        ].join('\n') + '\n'
    );
}

afterEach(async () => {
    cleanupTmpProjects();

    const actual = await vi.importActual<typeof ConfigLayer>('../config/index.js');
    vi.mocked(resolveForFile).mockReset();
    vi.mocked(resolveForFile).mockImplementation(actual.resolveForFile);
});

describe('weld inspect', () => {
    it('печатает путь файла от корня репозитория и путь импорта по алиасу', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/feature/internal.ts',
                alias: '@/feature/internal.ts',
                module: '@root',
                layer: '@unknown',
                innerPath: 'feature/internal.ts',
            }),
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('index.<ext> схлопывается в директорию модуля', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/index.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/index.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/feature/index.ts',
                alias: '@/feature',
                module: '@root',
                layer: '@unknown',
                innerPath: 'feature/index.ts',
            }),
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('алиас с хвостом в ключе: index.<ext> не дает неразрешимый голый префикс', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': FEATURE_ALIAS_CONFIG,
            'src/feature/index.ts': '',
            'src/feature/internal.ts': '',
        });

        const index = capture(root);
        await index.program.parseAsync(['inspect', 'src/feature/index.ts'], { from: 'user' });
        expect(printed(index.out)).toBe(
            inspectOutput({
                file: 'src/feature/index.ts',
                alias: '@/feature/index.ts',
                module: '@root',
                layer: '@unknown',
                innerPath: 'feature/index.ts',
            }),
        );

        const internal = capture(root);
        await internal.program.parseAsync(['inspect', 'src/feature/internal.ts'], {
            from: 'user',
        });
        expect(printed(internal.out)).toBe(
            inspectOutput({
                file: 'src/feature/internal.ts',
                alias: '@/feature/internal.ts',
                module: '@root',
                layer: '@unknown',
                innerPath: 'feature/internal.ts',
            }),
        );
    });

    it('точный ключ: index.<ext> печатается как сам префикс, без имени файла', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': EXACT_ALIAS_CONFIG,
            'src/config/index.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/config/index.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/config/index.ts',
                alias: '@/config',
                module: '@root',
                layer: '@unknown',
                innerPath: 'config/index.ts',
            }),
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('точный ключ: файл ниже якоря печатается виртуальным путем', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': EXACT_ALIAS_CONFIG,
            'src/config/other.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/config/other.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/config/other.ts',
                alias: '/src/config/other.ts',
                module: '@root',
                layer: '@unknown',
                innerPath: 'config/other.ts',
            }),
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('точный ключ ниже якоря уступает широкому звездному', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': EXACT_AND_STAR_ALIAS_CONFIG,
            'src/config/other.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/config/other.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/config/other.ts',
                alias: '@/config/other.ts',
                module: '@root',
                layer: '@unknown',
                innerPath: 'config/other.ts',
            }),
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('index.<ext> прямо в якоре алиаса печатается с именем файла', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/index.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['inspect', 'src/index.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/index.ts',
                alias: '@/index.ts',
                module: '@root',
                layer: '@unknown',
                innerPath: 'index.ts',
            }),
        );
    });

    it('index.<ext> в корне репозитория не схлопывается в `/`', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ROOT_SRC_CONFIG,
            'index.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['inspect', 'index.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'index.ts',
                alias: '/index.ts',
                module: '@root',
                layer: '@unknown',
                innerPath: 'index.ts',
            }),
        );
    });

    it('без алиасов печатает виртуальный путь', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': NO_ALIASES_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/feature/internal.ts',
                alias: '/src/feature/internal.ts',
                module: '@root',
                layer: '@unknown',
                innerPath: 'feature/internal.ts',
            }),
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('--json печатает только JSON, без текстовых подписей', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['--json', 'inspect', 'src/feature/internal.ts'], {
            from: 'user',
        });

        expect(JSON.parse(printed(out))).toEqual({
            file: 'src/feature/internal.ts',
            alias: '@/feature/internal.ts',
            module: '@root',
            layer: '@unknown',
            innerPath: 'feature/internal.ts',
        });
    });

    it('--json без алиаса печатает alias: null', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': NO_ALIASES_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['inspect', '--json', 'src/feature/internal.ts'], {
            from: 'user',
        });

        expect(JSON.parse(printed(out))).toEqual({
            file: 'src/feature/internal.ts',
            alias: null,
            module: '@root',
            layer: '@unknown',
            innerPath: 'feature/internal.ts',
        });
    });

    it('--no-color печатает тот же текст без escape-последовательностей', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/index.ts': '',
        });
        const { program, out } = capture(root);

        await program.parseAsync(['--no-color', 'inspect', 'src/feature/index.ts'], {
            from: 'user',
        });

        expect(out.join('')).not.toContain(String.fromCharCode(27));
        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/feature/index.ts',
                alias: '@/feature',
                module: '@root',
                layer: '@unknown',
                innerPath: 'feature/index.ts',
            }),
        );
    });

    it('директория вместо файла → ошибка expected a file', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe('error: expected a file, got a directory: src/feature\n');
        expect(codes).toEqual([1]);
    });

    it('директория без линтуемых файлов → ошибка про отсутствие файлов', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/keep.css': '',
            'src/data.json': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe('error: no lintable files in src\n');
        expect(codes).toEqual([1]);
    });

    it('несуществующий путь → ошибка, при --json она уходит в stdout', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/feature/internal.ts': '',
        });

        const text = capture(root);
        await text.program.parseAsync(['inspect', 'src/missing.ts'], { from: 'user' });
        expect(printed(text.err)).toBe('error: path does not exist: src/missing.ts\n');
        expect(text.out).toEqual([]);
        expect(text.codes).toEqual([1]);

        const json = capture(root);
        await json.program.parseAsync(['--json', 'inspect', 'src/missing.ts'], { from: 'user' });
        expect(JSON.parse(printed(json.out))).toEqual({
            error: 'path does not exist: src/missing.ts',
        });
        expect(json.err).toEqual([]);
        expect(json.codes).toEqual([1]);
    });

    it('файл вне корня репозитория → ошибка', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': OUTSIDE_ROOT_CONFIG,
            'packages/app/placeholder.ts': '',
            'src/feature/internal.ts': '',
        });
        const { program, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(err)).toBe(
            'error: src/feature/internal.ts is outside the repository root\n',
        );
        expect(codes).toEqual([1]);
    });
});

describe('weld inspect: метаданные файла', () => {
    it.each(META_ROWS)(
        '$path: модуль, слой и путь внутри слоя',
        async ({ path, module, layer, innerPath }) => {
            const root = makeMetadataProject();
            const { program, out, err, codes } = capture(root);

            await program.parseAsync(['inspect', path], { from: 'user' });

            expect(printed(out)).toBe(
                inspectOutput({
                    file: path,
                    alias: `@/${path.slice('src/'.length)}`,
                    module,
                    layer,
                    innerPath,
                }),
            );
            expect(err).toEqual([]);
            expect(codes).toEqual([]);
        },
    );

    it('маркера @unknown в схеме нет — слой все равно печатается как @unknown', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': NO_UNKNOWN_MARKER_CONFIG,
            'src/utils/format.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/utils/format.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/utils/format.ts',
                alias: '@/utils/format.ts',
                module: '@root',
                layer: '@unknown',
                innerPath: 'utils/format.ts',
            }),
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('схемы модулей нет — контейнер modules не распознается', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': NO_MODULES_CONFIG,
            'src/modules/billing/a.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/modules/billing/a.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/modules/billing/a.ts',
                alias: '@/modules/billing/a.ts',
                module: '@root',
                layer: '@unknown',
                innerPath: 'modules/billing/a.ts',
            }),
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('--json отдает модуль, слой и путь внутри слоя полями', async () => {
        const root = makeMetadataProject();
        const { program, out } = capture(root);
        const path = 'src/modules/billing/modules/subscription/features/panel.ts';

        await program.parseAsync(['--json', 'inspect', path], { from: 'user' });

        expect(JSON.parse(printed(out))).toEqual({
            file: path,
            alias: '@/modules/billing/modules/subscription/features/panel.ts',
            module: 'billing::subscription',
            layer: 'features',
            innerPath: 'panel.ts',
        });
    });

    describe('flatModules: true', () => {
        it('корневой модуль прямо в srcDir, слой модуля — по имени из moduleLayers', async () => {
            const root = makeCliProject({
                'eslint.config.mjs': FLAT_MODULES_CONFIG,
                'src/order/features/w.ts': '',
            });
            const { program, out, err, codes } = capture(root);

            await program.parseAsync(['inspect', 'src/order/features/w.ts'], { from: 'user' });

            expect(printed(out)).toBe(
                inspectOutput({
                    file: 'src/order/features/w.ts',
                    alias: '@/order/features/w.ts',
                    module: 'order',
                    layer: 'features',
                    innerPath: 'w.ts',
                }),
            );
            expect(err).toEqual([]);
            expect(codes).toEqual([]);
        });

        it('вложенный модуль — в контейнере: src/order/modules/sub — order::sub', async () => {
            const root = makeCliProject({
                'eslint.config.mjs': FLAT_MODULES_CONFIG,
                'src/order/modules/sub/features/w.ts': '',
            });
            const { program, out, err, codes } = capture(root);

            await program.parseAsync(['inspect', 'src/order/modules/sub/features/w.ts'], {
                from: 'user',
            });

            expect(printed(out)).toBe(
                inspectOutput({
                    file: 'src/order/modules/sub/features/w.ts',
                    alias: '@/order/modules/sub/features/w.ts',
                    module: 'order::sub',
                    layer: 'features',
                    innerPath: 'w.ts',
                }),
            );
            expect(err).toEqual([]);
            expect(codes).toEqual([]);
        });

        it('контейнер в корне не распознается: файл под src/modules — @root и @unknown', async () => {
            const root = makeCliProject({
                'eslint.config.mjs': FLAT_MODULES_CONFIG,
                'src/modules/order/w.ts': '',
            });
            const { program, out, err, codes } = capture(root);

            await program.parseAsync(['inspect', 'src/modules/order/w.ts'], { from: 'user' });

            expect(printed(out)).toBe(
                inspectOutput({
                    file: 'src/modules/order/w.ts',
                    alias: '@/modules/order/w.ts',
                    module: '@root',
                    layer: '@unknown',
                    innerPath: 'modules/order/w.ts',
                }),
            );
            expect(err).toEqual([]);
            expect(codes).toEqual([]);
        });

        it('имя слоя в корне побеждает модуль: src/app — слой, даже при flatModules', async () => {
            const root = makeCliProject({
                'eslint.config.mjs': FLAT_MODULES_CONFIG,
                'src/app/x.ts': '',
            });
            const { program, out, err, codes } = capture(root);

            await program.parseAsync(['inspect', 'src/app/x.ts'], { from: 'user' });

            expect(printed(out)).toBe(
                inspectOutput({
                    file: 'src/app/x.ts',
                    alias: '@/app/x.ts',
                    module: '@root',
                    layer: 'app',
                    innerPath: 'x.ts',
                }),
            );
            expect(err).toEqual([]);
            expect(codes).toEqual([]);
        });
    });
});

describe('weld inspect: схема слоев', () => {
    it('конфиг без схемы → ошибка и код 1', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': NO_SCHEME_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/internal.ts'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe(
            'error: settings.weld.layers is required\nhint: Check configuration: weld config src/feature/internal.ts\n',
        );
        expect(codes).toEqual([1]);
    });

    it('конфиг без схемы при --json → ошибка в stdout и код 1', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': NO_SCHEME_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['--json', 'inspect', 'src/feature/internal.ts'], {
            from: 'user',
        });

        expect(JSON.parse(printed(out))).toEqual({
            error: 'settings.weld.layers is required',
            hint: 'Check configuration: weld config src/feature/internal.ts',
        });
        expect(err).toEqual([]);
        expect(codes).toEqual([1]);
    });

    it('ошибка схемы сохраняет --config и экранирует аргументы в подсказке', async () => {
        const root = makeCliProject({
            'configs/my config.mjs': `export default [{ files: ['**/*.ts'], settings: { weld: { layers: 42 } } }];`,
            "src/it's here.ts": '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(
            ['inspect', '--config', 'configs/my config.mjs', "src/it's here.ts"],
            {
                from: 'user',
            },
        );

        expect(out).toEqual([]);
        expect(printed(err)).toBe(
            'error: settings.weld.layers must be an array of strings, got number\n' +
                "hint: Check configuration: weld config --config 'configs/my config.mjs' 'src/it'\\''s here.ts'\n",
        );
        expect(codes).toEqual([1]);
    });

    it.each([
        ['repoRoot', 'repoRoot: 42', 'settings.weld.repoRoot must be a string, got number'],
        [
            'aliases',
            "aliases: { '@a': 42 }",
            "settings.weld.aliases['@a'] must be a string or an array of strings",
        ],
    ])('ошибка %s предлагает проверить настройки', async (_name, setting, message) => {
        const root = makeCliProject({
            'eslint.config.mjs': `export default [{ files: ['**/*.ts'], settings: { weld: { ${SCHEME_SETTINGS_TEXT}, ${setting} } } }];`,
            'src/a.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/a.ts'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe(
            `error: ${message}\nhint: Check configuration: weld config src/a.ts\n`,
        );
        expect(codes).toEqual([1]);
    });

    it('файл вне srcDir → ошибка и код 1', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'lib/x.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'lib/x.ts'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe('error: lib/x.ts is outside srcDir /src\n');
        expect(codes).toEqual([1]);
    });

    it('файл вне srcDir при --json → ошибка в stdout и код 1', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'lib/x.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['--json', 'inspect', 'lib/x.ts'], { from: 'user' });

        expect(JSON.parse(printed(out))).toEqual({ error: 'lib/x.ts is outside srcDir /src' });
        expect(err).toEqual([]);
        expect(codes).toEqual([1]);
    });

    it('запрещенный символ в пути → ошибка и код 1', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': ALIAS_CONFIG,
            'src/scope@2/x.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/scope@2/x.ts'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe(
            'error: src/scope@2/x.ts: "scope@2" must not contain "@" or ":"\n',
        );
        expect(codes).toEqual([1]);
    });
});

describe('weld inspect: выбор опций правила', () => {
    it('схема берется из опций первого правила weld/*', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': TWO_RULES_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/internal.ts'], { from: 'user' });

        expect(printed(out)).toBe(
            inspectOutput({
                file: 'src/feature/internal.ts',
                alias: '@/feature/internal.ts',
                module: '@root',
                layer: 'src',
                innerPath: 'feature/internal.ts',
            }),
        );
        expect(err).toEqual([]);
        expect(codes).toEqual([]);
    });

    it('layers только во втором правиле → ошибка отсутствующей схемы', async () => {
        const root = makeCliProject({
            'eslint.config.mjs': SECOND_RULE_SCHEME_CONFIG,
            'src/feature/internal.ts': '',
        });
        const { program, out, err, codes } = capture(root);

        await program.parseAsync(['inspect', 'src/feature/internal.ts'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe(
            'error: settings.weld.layers is required\nhint: Check configuration: weld config src/feature/internal.ts\n',
        );
        expect(codes).toEqual([1]);
    });
});

describe('weld inspect: автоподъем repoRoot до якорей tsconfig', () => {
    /**
     * Пакет со своим `package.json` и tsconfig: якорь алиаса лежит выше пакета, поэтому корень
     * поднимается до `packages/`, и `srcDir` отсчитывается уже от него.
     */
    function makeNestedPackage(): string {
        const root = makeTmpProject({
            'packages/app/package.json':
                '{ "name": "weld-cli-nested", "private": true, "type": "module" }\n',
            'packages/app/eslint.config.mjs': TSCONFIG_CONFIG,
            'packages/app/tsconfig.json': JSON.stringify({
                compilerOptions: { baseUrl: '.', paths: { '@/*': ['../shared/*'] } },
            }),
            'packages/app/src/a.ts': '',
            'packages/shared/x.ts': '',
        });
        linkRepoNodeModules(root);

        return `${root}/packages/app`;
    }

    it('srcDir отсчитывается от поднятого корня, а не от корня пакета', async () => {
        const pkg = makeNestedPackage();
        const { program, out, err, codes } = capture(pkg);

        await program.parseAsync(['inspect', 'src/a.ts'], { from: 'user' });

        expect(out).toEqual([]);
        expect(printed(err)).toBe('error: src/a.ts is outside srcDir /src\n');
        expect(codes).toEqual([1]);
    });
});

describe('inspectFile: имя файла в алиасе', () => {
    it('берется из виртуального пути, а не из реального (Windows)', () => {
        vi.mocked(resolveForFile).mockReturnValueOnce({
            getFromFile: () => '/src/index.ts',
            getRoot: () => 'C:\\repo',
            getFsHost: () => createFakeFsHost([]),
            getAliases: () => [{ prefix: '@', anchor: '/src', star: true }],
            getScheme: () => ({
                srcDir: '/src',
                modulesDir: 'modules',
                layers: ['app', '@modules'],
                moduleLayers: ['features'],
                flatModules: false,
            }),
        });

        const result = inspectFile(
            {
                filePath: 'C:\\repo\\src\\index.ts',
                configFile: 'C:\\repo\\eslint.config.mjs',
                settings: {},
            },
            'C:\\repo',
            'src/index.ts',
        );

        expect(result.alias).toBe('@/index.ts');
        expect(result.module).toBe('@root');
        expect(result.layer).toBe('@unknown');
        expect(result.innerPath).toBe('index.ts');
        expect(result.virtualPath).toBe('/src');
    });
});
