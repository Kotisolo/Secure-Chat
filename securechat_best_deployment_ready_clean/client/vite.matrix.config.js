import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  define: {
    'import.meta.env.VITE_MATRIX_E2EE_POC_ENABLED': '"true"',
    'import.meta.env.VITE_MATRIX_HOMESERVER_URL': '"https://matrix.invalid"'
  },
  build: {
    outDir: 'dist-matrix-poc',
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/matrixE2EE.js'),
      formats: ['es'],
      fileName: 'matrix-e2ee-poc'
    }
  }
});
