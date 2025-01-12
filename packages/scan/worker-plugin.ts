import * as esbuild from 'esbuild';

export const workerPlugin = {
  name: 'worker-plugin',
  setup(build) {
    // Build the worker code first
    const workerResult = esbuild.buildSync({
      entryPoints: ['src/new-outlines/offscreen-canvas.worker.ts'],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      minify: true,
    });
    const workerCode = workerResult.outputFiles[0].text;

    // Replace the exact string we see in the output
    build.onEnd((result) => {
      if (!result.outputFiles) return;

      for (const file of result.outputFiles) {
        const newText = file.text.replace(
          'var workerCode = "__WORKER_CODE__"',
          `var workerCode = ${JSON.stringify(workerCode)}`,
        );
        file.contents = Buffer.from(newText);
      }
    });
  },
};
