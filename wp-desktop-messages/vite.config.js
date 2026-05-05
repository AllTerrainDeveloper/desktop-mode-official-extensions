/**
 * Vite configuration for the WP Desktop Messages plugin.
 *
 * Builds two TypeScript entries into IIFE bundles:
 *
 *   `src/index.ts`       → assets/js/messages[.min].js
 *   `src/shell-entry.ts` → assets/js/messages-shell[.min].js
 *
 * Selected via the `WPDM_TARGET` env var (`messages` — default — or
 * `messages-shell`). `npm run build` runs Vite four times
 * (two targets × two modes).
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const TARGETS = {
	messages: {
		entry:    'src/index.ts',
		fileBase: 'messages',
		iifeName: 'wpDesktopMessages',
	},
	'messages-shell': {
		entry:    'src/shell-entry.ts',
		fileBase: 'messages-shell',
		iifeName: 'wpDesktopMessagesShell',
	},
};

export default defineConfig( ( { mode } ) => {
	const isProd = mode === 'production';
	const targetKey = process.env.WPDM_TARGET || 'messages';
	const target = TARGETS[ targetKey ];
	if ( ! target ) {
		throw new Error(
			`vite.config.js: unknown WPDM_TARGET="${ targetKey }". ` +
				`Expected one of: ${ Object.keys( TARGETS ).join( ', ' ) }.`,
		);
	}

	return {
		build: {
			outDir: 'assets/js',
			emptyOutDir: false,
			target: 'es2020',
			minify: isProd ? 'esbuild' : false,
			sourcemap: false,
			lib: {
				entry: resolve( __dirname, target.entry ),
				formats: [ 'iife' ],
				name: target.iifeName,
				fileName: () =>
					isProd
						? `${ target.fileBase }.min.js`
						: `${ target.fileBase }.js`,
			},
		},
	};
} );
