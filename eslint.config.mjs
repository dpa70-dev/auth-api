import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src/contract.ts'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Permite `declare global { namespace Express }` (augmenteo de tipos de Express, patrón canónico).
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      // El estándar de logging es pino (doc 00 → ítem 10); se conserva `console.error`
      // solo para fallos fatales de arranque anteriores a la creación del logger (doc 00 → ítem 14).
      'no-console': ['error', { allow: ['error'] }],
    },
  },
);