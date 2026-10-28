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
                { text: 'Концепции', link: '/concepts' },
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
                        { text: 'Публичный API директории', link: '/concepts/public-api' },
                        {
                            text: 'Однонаправленность зависимостей',
                            link: '/concepts/direction',
                        },
                        { text: 'Слои задает проект', link: '/concepts/layers' },
                        { text: 'Модули', link: '/concepts/modules' },
                        { text: 'Вложенные модули', link: '/concepts/nested-modules' },
                    ],
                },
                {
                    text: 'Механики',
                    items: [
                        { text: 'Схема слоев', link: '/mechanics/layers' },
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
                {
                    text: 'CLI',
                    items: [
                        { text: 'Обзор', link: '/cli/index' },
                        { text: 'config', link: '/cli/config' },
                        { text: 'inspect', link: '/cli/inspect' },
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
            // Цвета treeView приходят из `themeVariables.treeView`, а не из `treeView`.
            themeVariables: {
                treeView: {
                    labelColor: 'currentColor',
                    lineColor: 'currentColor',
                },
            },
            treeView: {
                showIcons: true,
                defaultIconPack: 'vscode-icons',
                filenameIcons: {
                    'index.ts': DOC_ICONS.barrel,
                },
                extensionIcons: {
                    '.ts': DOC_ICONS.typescript,
                    '.vue': DOC_ICONS.vue,
                    '.tsx': DOC_ICONS.react,
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
