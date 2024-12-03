/**
 * This entry file is for webpack plugin.
 *
 * @module
 */

/**
 * Webpack plugin
 *
 * @example
 * ```ts
 * // webpack.config.js
 * module.exports = {
 *  plugins: [require('unplugin-starter/webpack')()],
 * }
 * ```
 */
import { reactComponentNamePlugin } from '.';
export default reactComponentNamePlugin.webpack;
