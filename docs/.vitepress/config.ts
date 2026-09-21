import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

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
        },

        vite: {
            optimizeDeps: {
                include: ['mermaid', 'elkjs'],
            },
            ssr: {
                noExternal: ['mermaid', 'elkjs'],
            },
        },
    }),
);
