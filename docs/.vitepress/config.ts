import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
    title: 'WELD — Well-Encapsulated Layered Design',
    description: 'Подход к организации кода во frontend-приложениях',
    base: process.env.BASE_URL ?? '/',
    themeConfig: {
        // https://vitepress.dev/reference/default-theme-config
        nav: [{ text: 'WELD', link: '/' }],

        sidebar: [],

        socialLinks: [{ icon: 'github', link: 'https://github.com/jt4d-lab/weld' }],
    },
});
