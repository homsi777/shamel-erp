// vite.config.ts
import { defineConfig, loadEnv } from "file:///C:/Users/Homsi/Desktop/obadah/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/Homsi/Desktop/obadah/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    // استخدام ./ ضروري جداً لـ Electron لتحميل الملفات من المسارات المحلية النسبية
    base: "./",
    resolve: {
      alias: {
        "@": path.resolve(process.cwd(), "./src")
      }
    },
    define: {
      "process.env": env
    },
    server: {
      port: 5173,
      host: "127.0.0.1",
      strictPort: true,
      hmr: {
        protocol: "ws",
        host: "127.0.0.1",
        port: 5173
      }
    },
    optimizeDeps: {
      exclude: ["lucide-react"]
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      assetsDir: "assets",
      chunkSizeWarningLimit: 1e3,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom", "recharts", "lucide-react"]
          }
        }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxIb21zaVxcXFxEZXNrdG9wXFxcXG9iYWRhaFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcVXNlcnNcXFxcSG9tc2lcXFxcRGVza3RvcFxcXFxvYmFkYWhcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L1VzZXJzL0hvbXNpL0Rlc2t0b3Avb2JhZGFoL3ZpdGUuY29uZmlnLnRzXCI7XG5pbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4ge1xuICBjb25zdCBlbnYgPSBsb2FkRW52KG1vZGUsIChwcm9jZXNzIGFzIGFueSkuY3dkKCksICcnKTtcbiAgcmV0dXJuIHtcbiAgICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gICAgLy8gXHUwNjI3XHUwNjMzXHUwNjJBXHUwNjJFXHUwNjJGXHUwNjI3XHUwNjQ1IC4vIFx1MDYzNlx1MDYzMVx1MDY0OFx1MDYzMVx1MDY0QSBcdTA2MkNcdTA2MkZcdTA2MjdcdTA2NEIgXHUwNjQ0XHUwNjQwIEVsZWN0cm9uIFx1MDY0NFx1MDYyQVx1MDYyRFx1MDY0NVx1MDY0QVx1MDY0NCBcdTA2MjdcdTA2NDRcdTA2NDVcdTA2NDRcdTA2NDFcdTA2MjdcdTA2MkEgXHUwNjQ1XHUwNjQ2IFx1MDYyN1x1MDY0NFx1MDY0NVx1MDYzM1x1MDYyN1x1MDYzMVx1MDYyN1x1MDYyQSBcdTA2MjdcdTA2NDRcdTA2NDVcdTA2MkRcdTA2NDRcdTA2NEFcdTA2MjkgXHUwNjI3XHUwNjQ0XHUwNjQ2XHUwNjMzXHUwNjI4XHUwNjRBXHUwNjI5XG4gICAgYmFzZTogJy4vJyxcbiAgICByZXNvbHZlOiB7XG4gICAgICBhbGlhczoge1xuICAgICAgICAnQCc6IHBhdGgucmVzb2x2ZSgocHJvY2VzcyBhcyBhbnkpLmN3ZCgpLCAnLi9zcmMnKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBkZWZpbmU6IHtcbiAgICAgICdwcm9jZXNzLmVudic6IGVudlxuICAgIH0sXG4gICAgc2VydmVyOiB7XG4gICAgICBwb3J0OiA1MTczLFxuICAgICAgaG9zdDogJzEyNy4wLjAuMScsXG4gICAgICBzdHJpY3RQb3J0OiB0cnVlLFxuICAgICAgaG1yOiB7XG4gICAgICAgIHByb3RvY29sOiAnd3MnLFxuICAgICAgICBob3N0OiAnMTI3LjAuMC4xJyxcbiAgICAgICAgcG9ydDogNTE3MyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBvcHRpbWl6ZURlcHM6IHtcbiAgICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gICAgfSxcbiAgICBidWlsZDoge1xuICAgICAgb3V0RGlyOiAnZGlzdCcsXG4gICAgICBlbXB0eU91dERpcjogdHJ1ZSxcbiAgICAgIGFzc2V0c0RpcjogJ2Fzc2V0cycsXG4gICAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDEwMDAsXG4gICAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICAgIG91dHB1dDoge1xuICAgICAgICAgIG1hbnVhbENodW5rczoge1xuICAgICAgICAgICAgdmVuZG9yOiBbJ3JlYWN0JywgJ3JlYWN0LWRvbScsICdyZWNoYXJ0cycsICdsdWNpZGUtcmVhY3QnXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9XG4gIH07XG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFDQSxTQUFTLGNBQWMsZUFBZTtBQUN0QyxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRWpCLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxNQUFNO0FBQ3hDLFFBQU0sTUFBTSxRQUFRLE1BQU8sUUFBZ0IsSUFBSSxHQUFHLEVBQUU7QUFDcEQsU0FBTztBQUFBLElBQ0wsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBO0FBQUEsSUFFakIsTUFBTTtBQUFBLElBQ04sU0FBUztBQUFBLE1BQ1AsT0FBTztBQUFBLFFBQ0wsS0FBSyxLQUFLLFFBQVMsUUFBZ0IsSUFBSSxHQUFHLE9BQU87QUFBQSxNQUNuRDtBQUFBLElBQ0Y7QUFBQSxJQUNBLFFBQVE7QUFBQSxNQUNOLGVBQWU7QUFBQSxJQUNqQjtBQUFBLElBQ0EsUUFBUTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sWUFBWTtBQUFBLE1BQ1osS0FBSztBQUFBLFFBQ0gsVUFBVTtBQUFBLFFBQ1YsTUFBTTtBQUFBLFFBQ04sTUFBTTtBQUFBLE1BQ1I7QUFBQSxJQUNGO0FBQUEsSUFDQSxjQUFjO0FBQUEsTUFDWixTQUFTLENBQUMsY0FBYztBQUFBLElBQzFCO0FBQUEsSUFDQSxPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsTUFDUixhQUFhO0FBQUEsTUFDYixXQUFXO0FBQUEsTUFDWCx1QkFBdUI7QUFBQSxNQUN2QixlQUFlO0FBQUEsUUFDYixRQUFRO0FBQUEsVUFDTixjQUFjO0FBQUEsWUFDWixRQUFRLENBQUMsU0FBUyxhQUFhLFlBQVksY0FBYztBQUFBLFVBQzNEO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
