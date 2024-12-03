/**
 * This entry file is for Rspack plugin.
 *
 * @module
 */

import reactComponentNamePlugin from '.';

/**
 * Rspack plugin
 *
 * @example
 * ```ts
 * // rspack.config.js
 * module.exports = {
 *  plugins: [require('unplugin-starter/rspack')()],
 * }
 * ```
 */
export default reactComponentNamePlugin.rspack as typeof reactComponentNamePlugin.rspack;
