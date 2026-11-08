import js from '@eslint/js';
import weld from 'eslint-plugin-weld';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            '.yarn/**',
            'docs/.vitepress/dist/**',
            'docs/.vitepress/cache/**',
            'src/testing/fixtures/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        ...weld.configs.recommended,
        settings: {
            weld: {
                layers: [
                    'settings',
                    'host',
                    'tsconfig',
                    'config',
                    'layers',
                    'imports',
                    'path',
                    'cli',
                    'testing',
                    'rules',
                ],
            },
        },
    },
    {
        files: ['**/*.ts'],
        rules: {
            '@typescript-eslint/consistent-type-imports': 'error',
        },
    },
);
