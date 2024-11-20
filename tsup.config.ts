import { defineConfig } from 'tsup';

const commonConfig = {
  outDir: './dist',
  splitting: false,
  sourcemap: false,
  target: 'esnext' as const,
  treeshake: true,
  dts: true,
  minify: process.env.NODE_ENV === 'production' ? ('terser' as const) : false,
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  },
};

export default defineConfig([
  // Web build
  {
    ...commonConfig,
    entry: ['./src/index.ts', './src/auto.ts', './src/rsc-shim.ts'],
    format: ['cjs', 'esm', 'iife'],
    platform: 'browser',
    external: ['react', 'react-dom', 'react-reconciler'],
    outExtension({ format }) {
      return {
        js: `.${format === 'esm' ? 'mjs' : 'js'}`,
      };
    },
  },

  // CLI build
  {
    ...commonConfig,
    entry: ['./src/cli.mts'],
    format: ['cjs'],
    platform: 'node',
  },

  // Native build
  {
    ...commonConfig,
    entry: [
      './src/native.ts',
      './src/core/native/index.ts',
      './src/core/native/plugins/metro.ts',
    ],
    format: ['cjs'],
    platform: 'node',
    external: [
      'react',
      'react-native',
      '@shopify/react-native-skia',
      'react-native-reanimated',
    ],
    outExtension() {
      return {
        js: '.js',
      };
    },
  },
]);
