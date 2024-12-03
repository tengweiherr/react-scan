/**
 * This entry file is for Vite plugin.
 *
 * @module
 */

import { reactComponentNamePlugin } from '.'

/**
 * Vite plugin
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import Starter from 'unplugin-starter/vite'
 *
 * export default defineConfig({
 *   plugins: [Starter()],
 * })
 * ```
 */
export default reactComponentNamePlugin.vite
