/**
 * Alcazaba POP — wallpaper presets.
 *
 * Registers a handful of bright pop-art CSS wallpapers in the OS Settings
 * wallpaper picker. Users can switch between them at will; the selection
 * persists per-user via the shell's standard wallpaper persistence.
 */
( function ( wp ) {
	wp.desktop.whenReady( function () {
		var wallpapers = [
			{
				id:    'alcazaba-pop/sunburst',
				label: 'POP — Sunburst',
				value:
					'repeating-conic-gradient(from 0deg at 50% 50%, ' +
					'#ffd93d 0deg 18deg, #ff2e93 18deg 36deg)',
				preview:
					'repeating-conic-gradient(from 0deg at 50% 50%, ' +
					'#ffd93d 0deg 18deg, #ff2e93 18deg 36deg)',
			},
			{
				id:    'alcazaba-pop/halftone',
				label: 'POP — Halftone',
				value:
					'radial-gradient(circle at 50% 50%, #0a0a0a 18%, transparent 19%) ' +
					'0 0 / 22px 22px, #ff2e93',
				preview:
					'radial-gradient(circle at 50% 50%, #0a0a0a 18%, transparent 19%) ' +
					'0 0 / 22px 22px, #ff2e93',
			},
			{
				id:    'alcazaba-pop/bauhaus',
				label: 'POP — Bauhaus',
				value:
					'linear-gradient(135deg, #ffd93d 0%, #ffd93d 33%, ' +
					'#ff2e93 33%, #ff2e93 66%, #00d4ff 66%, #00d4ff 100%)',
				preview:
					'linear-gradient(135deg, #ffd93d 0%, #ffd93d 33%, ' +
					'#ff2e93 33%, #ff2e93 66%, #00d4ff 66%, #00d4ff 100%)',
			},
			{
				id:    'alcazaba-pop/comic',
				label: 'POP — Comic',
				value:
					'repeating-linear-gradient(45deg, #ffd9e8 0 18px, #ffffff 18px 36px)',
				preview:
					'repeating-linear-gradient(45deg, #ffd9e8 0 18px, #ffffff 18px 36px)',
			},
			{
				id:    'alcazaba-pop/electric',
				label: 'POP — Electric',
				value:  'linear-gradient(180deg, #ff2e93 0%, #7a00ff 100%)',
				preview: 'linear-gradient(180deg, #ff2e93 0%, #7a00ff 100%)',
			},
		];

		wallpapers.forEach( function ( w ) {
			wp.desktop.registerWallpaper( {
				id:      w.id,
				label:   w.label,
				type:    'css',
				value:   w.value,
				preview: w.preview,
			} );
		} );
	} );
}( window.wp ) );
