import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_MATRIX_E2EE_POC_ENABLED': '"true"',
    'import.meta.env.VITE_MATRIX_HOMESERVER_URL': '"https://matrix-client.matrix.org"'
  },
  build: {
    outDir: 'dist-matrix-test',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'matrix-poc.html')
    }
  }
});
