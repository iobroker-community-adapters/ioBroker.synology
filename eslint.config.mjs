import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        ignores: [
            '.vscode/',
            'build/',
            '**/*.test.js',
            'test/**/*.js',
            '*.config.mjs',
            'admin/words.js',
            'admin/admin.d.ts',
            '**/adapter-config.d.ts',
        ],
    },
];