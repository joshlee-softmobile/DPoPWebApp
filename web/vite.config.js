import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:54321', // Local .NET backend (DevSPA profile)
        changeOrigin: true,
        secure: false,
      }
    }
  }
});
