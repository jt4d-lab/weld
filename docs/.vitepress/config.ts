import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
    title: 'WELD — Well-Encapsulated Layered Design',
    description: 'Подход к организации кода во frontend-приложениях',
    base: process.env.BASE_URL ?? '/',
    themeConfig: {
        // https://vitepress.dev/reference/default-theme-config
        nav: [
            { text: 'Документация', link: '/get-started/overview' },
            { text: 'Концепции', link: '/core-concepts' },
        ],

        sidebar: [
            {
                text: 'Быстрый старт',
                items: [
                    { text: 'Обзор', link: '/get-started/overview' },
                ],
            },
            {
                text: 'Концепции',
                items: [
                    { text: 'Публичный API директории', link: '/core-concepts/public-api' },
                ],
            },
            {
                text: 'ES Lint',
                items: [
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
});
