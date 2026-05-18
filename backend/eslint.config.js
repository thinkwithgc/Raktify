const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-process-exit': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      // Spec §10 SQL-injection guard: forbid template literals with `${…}`
      // interpolations passed directly to `.query()`. Static template strings
      // with parameter placeholders ($1, $2, …) are still allowed because
      // they have no `expressions`. Use parameterised queries instead.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name="query"] > TemplateLiteral[expressions.length>0]',
          message:
            'SQL injection risk: do not interpolate values into a template-literal SQL string. Use parameter placeholders ($1, $2, …) and pass values as the second argument to query().',
        },
      ],
    },
  },
  {
    files: ['**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
];
