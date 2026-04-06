
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const apiPort = () => {
  const p = Number(process.env.SERVER_PORT || process.env.SHAMEL_API_PORT || '3111');
  return Number.isFinite(p) && p > 0 && p < 65536 ? p : 3111;
};
const devPort = () => {
  const p = Number(process.env.VITE_DEV_PORT || '5173');
  return Number.isFinite(p) && p > 0 && p < 65536 ? p : 5173;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  const targetPort = apiPort();
  const devServerPort = devPort();
  return {
    plugins: [react()],
    // استخدام ./ ضروري جداً لـ Electron لتحميل الملفات من المسارات المحلية النسبية
    base: './',
    resolve: {
      alias: {
        '@': path.resolve((process as any).cwd(), './src'),
      },
    },
    define: {
      'process.env': env
    },
    server: {
      port: devServerPort,
      host: '0.0.0.0',
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${targetPort}`,
          changeOrigin: true,
          secure: false,
        },
      },
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: devServerPort,
      },
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      assetsDir: 'assets',
      chunkSizeWarningLimit: 2000,
      minify: 'esbuild',
      esbuild: {
        drop: ['console'],
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react')) {
                return 'react-vendor';
              }
              if (id.includes('recharts')) {
                return 'recharts-vendor';
              }
              if (id.includes('leaflet')) {
                return 'leaflet-vendor';
              }
              return 'vendor';
            }
          },
        },
      },
    }
  };
});
