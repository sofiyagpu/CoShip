import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'apps/web', plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4300', '/.well-known': 'http://127.0.0.1:4300' } },
});
