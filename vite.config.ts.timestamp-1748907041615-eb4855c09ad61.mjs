// vite.config.ts
import { defineConfig } from "file:///home/project/node_modules/vite/dist/node/index.js";
import react from "file:///home/project/node_modules/@vitejs/plugin-react/dist/index.mjs";
var vite_config_default = defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["lucide-react"]
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react") && !id.includes("react-router")) {
              return "vendor";
            }
            if (id.includes("react-router")) {
              return "router";
            }
            if (id.includes("@tanstack/react-query")) {
              return "query";
            }
            if (id.includes("@headlessui") || id.includes("lucide-react")) {
              return "ui";
            }
            if (id.includes("react-hook-form")) {
              return "forms";
            }
            if (id.includes("date-fns")) {
              return "dates";
            }
            if (id.includes("geolib")) {
              return "maps";
            }
            if (id.includes("@supabase")) {
              return "supabase";
            }
            if (id.includes("@stripe")) {
              return "stripe";
            }
          }
          if (id.includes("src/lib/autoSchedule") || id.includes("src/lib/scheduling")) {
            return "scheduling";
          }
          if (id.includes("src/pages/Reports") || id.includes("src/components/reports")) {
            return "reports";
          }
          if (id.includes("src/pages/Billing") || id.includes("src/components/billing")) {
            return "billing";
          }
        }
      }
    },
    chunkSizeWarningLimit: 1e3,
    target: "esnext",
    minify: "esbuild",
    sourcemap: false
  },
  server: {
    fs: {
      strict: false
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgb3B0aW1pemVEZXBzOiB7XG4gICAgZXhjbHVkZTogWydsdWNpZGUtcmVhY3QnXSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgbWFudWFsQ2h1bmtzKGlkKSB7XG4gICAgICAgICAgLy8gVmVuZG9yIGNodW5rc1xuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzJykpIHtcbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygncmVhY3QnKSAmJiAhaWQuaW5jbHVkZXMoJ3JlYWN0LXJvdXRlcicpKSB7XG4gICAgICAgICAgICAgIHJldHVybiAndmVuZG9yJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygncmVhY3Qtcm91dGVyJykpIHtcbiAgICAgICAgICAgICAgcmV0dXJuICdyb3V0ZXInO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdAdGFuc3RhY2svcmVhY3QtcXVlcnknKSkge1xuICAgICAgICAgICAgICByZXR1cm4gJ3F1ZXJ5JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnQGhlYWRsZXNzdWknKSB8fCBpZC5pbmNsdWRlcygnbHVjaWRlLXJlYWN0JykpIHtcbiAgICAgICAgICAgICAgcmV0dXJuICd1aSc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ3JlYWN0LWhvb2stZm9ybScpKSB7XG4gICAgICAgICAgICAgIHJldHVybiAnZm9ybXMnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdkYXRlLWZucycpKSB7XG4gICAgICAgICAgICAgIHJldHVybiAnZGF0ZXMnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdnZW9saWInKSkge1xuICAgICAgICAgICAgICByZXR1cm4gJ21hcHMnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdAc3VwYWJhc2UnKSkge1xuICAgICAgICAgICAgICByZXR1cm4gJ3N1cGFiYXNlJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnQHN0cmlwZScpKSB7XG4gICAgICAgICAgICAgIHJldHVybiAnc3RyaXBlJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gRmVhdHVyZSBjaHVua3NcbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ3NyYy9saWIvYXV0b1NjaGVkdWxlJykgfHwgaWQuaW5jbHVkZXMoJ3NyYy9saWIvc2NoZWR1bGluZycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3NjaGVkdWxpbmcnO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ3NyYy9wYWdlcy9SZXBvcnRzJykgfHwgaWQuaW5jbHVkZXMoJ3NyYy9jb21wb25lbnRzL3JlcG9ydHMnKSkge1xuICAgICAgICAgICAgcmV0dXJuICdyZXBvcnRzJztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdzcmMvcGFnZXMvQmlsbGluZycpIHx8IGlkLmluY2x1ZGVzKCdzcmMvY29tcG9uZW50cy9iaWxsaW5nJykpIHtcbiAgICAgICAgICAgIHJldHVybiAnYmlsbGluZyc7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcbiAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDEwMDAsXG4gICAgdGFyZ2V0OiAnZXNuZXh0JyxcbiAgICBtaW5pZnk6ICdlc2J1aWxkJyxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBmczoge1xuICAgICAgc3RyaWN0OiBmYWxzZVxuICAgIH1cbiAgfVxufSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUF5TixTQUFTLG9CQUFvQjtBQUN0UCxPQUFPLFdBQVc7QUFFbEIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLGNBQWM7QUFBQSxJQUNaLFNBQVMsQ0FBQyxjQUFjO0FBQUEsRUFDMUI7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQSxRQUNOLGFBQWEsSUFBSTtBQUVmLGNBQUksR0FBRyxTQUFTLGNBQWMsR0FBRztBQUMvQixnQkFBSSxHQUFHLFNBQVMsT0FBTyxLQUFLLENBQUMsR0FBRyxTQUFTLGNBQWMsR0FBRztBQUN4RCxxQkFBTztBQUFBLFlBQ1Q7QUFDQSxnQkFBSSxHQUFHLFNBQVMsY0FBYyxHQUFHO0FBQy9CLHFCQUFPO0FBQUEsWUFDVDtBQUNBLGdCQUFJLEdBQUcsU0FBUyx1QkFBdUIsR0FBRztBQUN4QyxxQkFBTztBQUFBLFlBQ1Q7QUFDQSxnQkFBSSxHQUFHLFNBQVMsYUFBYSxLQUFLLEdBQUcsU0FBUyxjQUFjLEdBQUc7QUFDN0QscUJBQU87QUFBQSxZQUNUO0FBQ0EsZ0JBQUksR0FBRyxTQUFTLGlCQUFpQixHQUFHO0FBQ2xDLHFCQUFPO0FBQUEsWUFDVDtBQUNBLGdCQUFJLEdBQUcsU0FBUyxVQUFVLEdBQUc7QUFDM0IscUJBQU87QUFBQSxZQUNUO0FBQ0EsZ0JBQUksR0FBRyxTQUFTLFFBQVEsR0FBRztBQUN6QixxQkFBTztBQUFBLFlBQ1Q7QUFDQSxnQkFBSSxHQUFHLFNBQVMsV0FBVyxHQUFHO0FBQzVCLHFCQUFPO0FBQUEsWUFDVDtBQUNBLGdCQUFJLEdBQUcsU0FBUyxTQUFTLEdBQUc7QUFDMUIscUJBQU87QUFBQSxZQUNUO0FBQUEsVUFDRjtBQUdBLGNBQUksR0FBRyxTQUFTLHNCQUFzQixLQUFLLEdBQUcsU0FBUyxvQkFBb0IsR0FBRztBQUM1RSxtQkFBTztBQUFBLFVBQ1Q7QUFDQSxjQUFJLEdBQUcsU0FBUyxtQkFBbUIsS0FBSyxHQUFHLFNBQVMsd0JBQXdCLEdBQUc7QUFDN0UsbUJBQU87QUFBQSxVQUNUO0FBQ0EsY0FBSSxHQUFHLFNBQVMsbUJBQW1CLEtBQUssR0FBRyxTQUFTLHdCQUF3QixHQUFHO0FBQzdFLG1CQUFPO0FBQUEsVUFDVDtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLElBQ0EsdUJBQXVCO0FBQUEsSUFDdkIsUUFBUTtBQUFBLElBQ1IsUUFBUTtBQUFBLElBQ1IsV0FBVztBQUFBLEVBQ2I7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLElBQUk7QUFBQSxNQUNGLFFBQVE7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
