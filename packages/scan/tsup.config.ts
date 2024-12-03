import fs from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'tsup';

const DIST_PATH = './dist';

const addDirectivesToChunkFiles = async (
  distPath = DIST_PATH,
): Promise<void> => {
  try {
    const files = await fs.readdir(distPath);

    for (const file of files) {
      if (file.endsWith('.mjs') || file.endsWith('.js')) {
        const filePath = path.join(distPath, file);

        const data = await fs.readFile(filePath, 'utf8');

        const updatedContent = `'use client';\n${data}`;

        await fs.writeFile(filePath, updatedContent, 'utf8');

        // eslint-disable-next-line no-console
        console.log(`Directive has been added to ${file}`);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console -- We need to log the error
    console.error('Error:', err);
  }
};

export default defineConfig([
  {
    entry: ['./src/index.ts', './src/auto.ts', './src/rsc-shim.ts'],
    outDir: DIST_PATH,
    splitting: false,
    sourcemap: false,
    format: ['cjs', 'esm', 'iife'],
    target: 'esnext',
    platform: 'browser',
    treeshake: true,
    dts: true,
    async onSuccess() {
      await addDirectivesToChunkFiles();
    },
    minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
    env: {
      NODE_ENV: process.env.NODE_ENV ?? 'development',
    },
    external: ['react', 'react-dom', 'react-reconciler', 'next'],
  },
  {
    entry: ['./src/cli.mts'],
    outDir: './dist',
    splitting: false,
    sourcemap: false,
    format: ['cjs'],
    target: 'esnext',
    platform: 'node',
    minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
    env: {
      NODE_ENV: process.env.NODE_ENV ?? 'development',
    },
  },
  {
    entry: [
      './src/react-component-name/index.ts',
      './src/react-component-name/vite.ts',
      './src/react-component-name/webpack.ts',
      './src/react-component-name/esbuild.ts',
      './src/react-component-name/rspack.ts',
      './src/react-component-name/rolldown.ts',
      './src/react-component-name/rollup.ts',
    ],
    outDir: './dist',
    splitting: false,
    sourcemap: false,
    clean: true,
    format: ['cjs', 'esm'],
    target: 'esnext',
    external: [
      'unplugin',
      'estree-walker',
      '@rollup/pluginutils',
      '@babel/types',
      '@babel/parser',
      '@babel/traverse',
      '@babel/generator',
      '@babel/core',
      'rollup',
      'webpack',
      'esbuild',
      'rspack',
      'vite',
    ],
    dts: true,
    minify: false,
    treeshake: true,
    env: {
      NODE_ENV: process.env.NODE_ENV || 'development',
    },
    outExtension: ({ format }) => ({
      js: format === 'esm' ? '.mjs' : '.js',
    }),
    esbuildOptions: (options, context) => {
      options.mainFields = ['module', 'main'];
      options.conditions = ['import', 'require', 'node', 'default'];
      options.format = context.format === 'esm' ? 'esm' : 'cjs';
      options.preserveSymlinks = true;
    },
  },
]);
