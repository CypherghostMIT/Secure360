import { defineConfig } from 'tsup';

// Dual build: the API (Node ESM), Expo (Metro) and Vite resolve different conditions of "exports".
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
});
