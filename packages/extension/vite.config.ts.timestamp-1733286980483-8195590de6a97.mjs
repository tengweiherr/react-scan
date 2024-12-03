// vite.config.ts
import { defineConfig } from "file:///Users/robby/react-scan/node_modules/.pnpm/vite@5.4.3_@types+node@22.10.1_terser@5.36.0/node_modules/vite/dist/node/index.js";
import react from "file:///Users/robby/react-scan/node_modules/.pnpm/@vitejs+plugin-react@4.3.1_vite@5.4.3_@types+node@22.10.1_terser@5.36.0_/node_modules/@vitejs/plugin-react/dist/index.mjs";
import webExtension, { readJsonFile } from "file:///Users/robby/react-scan/node_modules/.pnpm/vite-plugin-web-extension@4.0.0_@types+node@22.10.1_terser@5.36.0/node_modules/vite-plugin-web-extension/dist/index.js";
function generateManifest() {
  const manifest = readJsonFile("src/manifest.json");
  const pkg = readJsonFile("package.json");
  return {
    name: pkg.name,
    description: pkg.description,
    version: pkg.version,
    ...manifest
  };
}
var vite_config_default = defineConfig({
  build: {
    minify: "terser",
    terserOptions: {
      keep_fnames: true
    }
  },
  plugins: [
    react(),
    webExtension({
      manifest: generateManifest,
      webExtConfig: {
        startUrl: "https://github.com/aidenybai/react-scan",
        chromiumBinary: process.env.CHROMIUM_BINARY
      }
    })
  ],
  esbuild: {
    minifyIdentifiers: false,
    keepNames: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvcm9iYnkvcmVhY3Qtc2Nhbi9wYWNrYWdlcy9leHRlbnNpb25cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9yb2JieS9yZWFjdC1zY2FuL3BhY2thZ2VzL2V4dGVuc2lvbi92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvcm9iYnkvcmVhY3Qtc2Nhbi9wYWNrYWdlcy9leHRlbnNpb24vdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgd2ViRXh0ZW5zaW9uLCB7IHJlYWRKc29uRmlsZSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXdlYi1leHRlbnNpb24nO1xuXG5mdW5jdGlvbiBnZW5lcmF0ZU1hbmlmZXN0KCkge1xuICBjb25zdCBtYW5pZmVzdCA9IHJlYWRKc29uRmlsZSgnc3JjL21hbmlmZXN0Lmpzb24nKTtcbiAgY29uc3QgcGtnID0gcmVhZEpzb25GaWxlKCdwYWNrYWdlLmpzb24nKTtcbiAgcmV0dXJuIHtcbiAgICBuYW1lOiBwa2cubmFtZSxcbiAgICBkZXNjcmlwdGlvbjogcGtnLmRlc2NyaXB0aW9uLFxuICAgIHZlcnNpb246IHBrZy52ZXJzaW9uLFxuICAgIC4uLm1hbmlmZXN0LFxuICB9O1xufVxuXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgYnVpbGQ6IHtcbiAgICBtaW5pZnk6ICd0ZXJzZXInLFxuICAgIHRlcnNlck9wdGlvbnM6IHtcbiAgICAgIGtlZXBfZm5hbWVzOiB0cnVlLFxuICAgIH0sXG4gIH0sXG4gIHBsdWdpbnM6IFtcbiAgICByZWFjdCgpLFxuICAgIHdlYkV4dGVuc2lvbih7XG4gICAgICBtYW5pZmVzdDogZ2VuZXJhdGVNYW5pZmVzdCxcbiAgICAgIHdlYkV4dENvbmZpZzoge1xuICAgICAgICBzdGFydFVybDogJ2h0dHBzOi8vZ2l0aHViLmNvbS9haWRlbnliYWkvcmVhY3Qtc2NhbicsXG4gICAgICAgIGNocm9taXVtQmluYXJ5OiBwcm9jZXNzLmVudi5DSFJPTUlVTV9CSU5BUlksXG4gICAgICB9LFxuICAgIH0pLFxuICBdLFxuICBlc2J1aWxkOiB7XG4gICAgbWluaWZ5SWRlbnRpZmllcnM6IGZhbHNlLFxuICAgIGtlZXBOYW1lczogdHJ1ZSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFnVCxTQUFTLG9CQUFvQjtBQUM3VSxPQUFPLFdBQVc7QUFDbEIsT0FBTyxnQkFBZ0Isb0JBQW9CO0FBRTNDLFNBQVMsbUJBQW1CO0FBQzFCLFFBQU0sV0FBVyxhQUFhLG1CQUFtQjtBQUNqRCxRQUFNLE1BQU0sYUFBYSxjQUFjO0FBQ3ZDLFNBQU87QUFBQSxJQUNMLE1BQU0sSUFBSTtBQUFBLElBQ1YsYUFBYSxJQUFJO0FBQUEsSUFDakIsU0FBUyxJQUFJO0FBQUEsSUFDYixHQUFHO0FBQUEsRUFDTDtBQUNGO0FBR0EsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsT0FBTztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsZUFBZTtBQUFBLE1BQ2IsYUFBYTtBQUFBLElBQ2Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixhQUFhO0FBQUEsTUFDWCxVQUFVO0FBQUEsTUFDVixjQUFjO0FBQUEsUUFDWixVQUFVO0FBQUEsUUFDVixnQkFBZ0IsUUFBUSxJQUFJO0FBQUEsTUFDOUI7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxtQkFBbUI7QUFBQSxJQUNuQixXQUFXO0FBQUEsRUFDYjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
