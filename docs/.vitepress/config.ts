import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import { DOC_ICONS, mermaidIconsPlugin } from './mermaid-icons.ts';

export default withMermaid(
    defineConfig({
        lang: 'ru-RU',
        title: 'WELD — Well-Encapsulated Layered Design',
        description: 'Подход к организации кода во frontend-приложениях',
        base: process.env.BASE_URL ?? '/',
        themeConfig: {
            // https://vitepress.dev/reference/default-theme-config
            nav: [
                { text: 'Документация', link: '/get-started/overview' },
                { text: 'Концепции', link: '/core-concepts' },
                { text: 'ESLint', link: '/rules/install' },
            ],

            sidebar: [
                {
                    text: 'Быстрый старт',
                    items: [{ text: 'Обзор', link: '/get-started/overview' }],
                },
                {
                    text: 'Концепции',
                    items: [
                        { text: 'Публичный API директории', link: '/core-concepts/public-api' },
                        {
                            text: 'Однонаправленность зависимостей',
                            link: '/core-concepts/direction',
                        },
                        { text: 'Слои задаёт проект', link: '/core-concepts/layers' },
                    ],
                },
                {
                    text: 'Механики',
                    items: [
                        { text: 'Схема слоёв', link: '/mechanics/layers' },
                        { text: 'Приватность', link: '/mechanics/privacy' },
                    ],
                },
                {
                    text: 'ESLint',
                    items: [
                        { text: 'Установка', link: '/rules/install' },
                        { text: 'settings', link: '/rules/settings' },
                        { text: 'no-barrel-bypass', link: '/rules/no-barrel-bypass' },
                    ],
                },
            ],

            socialLinks: [{ icon: 'github', link: 'https://github.com/jt4d-lab/weld' }],

            outline: {
                label: 'На этой странице',
                level: [2, 3],
            },

            docFooter: { prev: 'Предыдущая', next: 'Следующая' },
        },

        mermaid: {
            theme: 'redux',
            look: 'classic',
            // Стили treeView mermaid берёт не из `treeView`, а из
            // `themeVariables.treeView`: по умолчанию там чёрные текст и линии,
            // и тёмная тема на них не влияет. `currentColor` наследуется от
            // страницы, поэтому переключается вместе с ней.
            // Правка через CSS не годится: mermaid скоупит стили по id
            // диаграммы (`#mermaid-6 .treeView-node-label`), и id перебивает
            // любой селектор без `!important`.
            themeVariables: {
                treeView: {
                    labelColor: 'currentColor',
                    lineColor: 'currentColor',
                },
            },
            // Общие настройки treeView для всех диаграмм: встроенные иконки
            // file/folder и пак `vscode-icons` для имён без префикса.
            treeView: {
                showIcons: true,
                defaultIconPack: 'vscode-icons',
                filenameIcons: {
                    'index.ts': 'barrel',
                    src: 'file-type-source',
                },
                extensionIcons: {
                    '.ts': 'file-type-typescript',
                    '.vue': 'file-type-vue',
                    '.tsx': 'file-type-reactjs',
                },
            },
        },

        vite: {
            plugins: [mermaidIconsPlugin(DOC_ICONS)],
            optimizeDeps: {
                include: ['mermaid', 'elkjs'],
            },
            ssr: {
                noExternal: ['mermaid', 'elkjs'],
            },
        },
    }),
);
