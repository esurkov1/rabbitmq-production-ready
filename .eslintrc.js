module.exports = {
  env: {
    node: true,
    es2022: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
  },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
    'no-var': 'error',
    'prefer-const': 'error',
    'no-undef': 'error',
    'no-redeclare': 'error',
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',
  },
  globals: {
    Buffer: 'readonly',
    process: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
  },
};

