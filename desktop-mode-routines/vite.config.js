/**
 * Vite configuration for the Desktop Mode — Routines plugin.
 *
 * Builds `src/index.ts` into IIFE bundles:
 *   - `assets/js/routines.js`     (development, unminified)
 *   - `assets/js/routines.min.js` (production, esbuild-minified)
 *
 * @since 0.22.0
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig( ( { mode } ) => {
	const isProd = mode === 'production';

	return {
		build: {
			outDir: 'assets/js',
			emptyOutDir: false,
			target: 'es2020',
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( __dirname, 'src/index.ts' ),
				formats: [ 'iife' ],
				name: 'wpDesktopRoutines',
				fileName: () => ( isProd ? 'routines.min.js' : 'routines.js' ),
			},
		},
	};
} );
