/**
 * Alcazaba POP — title-bar slot decorators (Layer 3).
 *
 * Three cross-window decorators applied to every window:
 *   - before-titlebar: yellow halftone-dot strip (full width, above the bar).
 *   - after-titlebar:  chunky black comic-panel separator (below the bar).
 *   - after-title:     pink star appended to the title text.
 */
( function ( wp ) {
	wp.desktop.whenReady( function () {
		// Halftone strip ABOVE the title bar.
		wp.desktop.registerWindowSlot( {
			id:    'alcazaba-pop/halftone-strip',
			slot:  'before-titlebar',
			match: function () { return true; },
			owner: 'alcazaba-pop-slots',
			render: function ( host ) {
				host.style.height       = '8px';
				host.style.background   =
					'radial-gradient(circle at 50% 50%, #0a0a0a 38%, transparent 39%) 0 0 / 8px 8px, ' +
					'#ffd93d';
				host.style.borderBottom = '2px solid #0a0a0a';
				host.setAttribute( 'aria-hidden', 'true' );
			},
		} );

		// Chunky black bar BELOW the title bar.
		wp.desktop.registerWindowSlot( {
			id:    'alcazaba-pop/comic-underline',
			slot:  'after-titlebar',
			match: function () { return true; },
			owner: 'alcazaba-pop-slots',
			render: function ( host ) {
				host.style.height     = '4px';
				host.style.background =
					'linear-gradient(90deg, #0a0a0a 0 33%, #ff2e93 33% 66%, #0a0a0a 66% 100%)';
				host.setAttribute( 'aria-hidden', 'true' );
			},
		} );

		// Star appended after the title — append, don't replace.
		wp.desktop.registerWindowSlot( {
			id:      'alcazaba-pop/title-star',
			slot:    'after-title',
			replace: false,
			match:   function () { return true; },
			owner:   'alcazaba-pop-slots',
			render: function ( host ) {
				var star = document.createElement( 'span' );
				star.textContent      = '★';
				star.style.color      = '#ff2e93';
				star.style.fontWeight = '900';
				star.style.fontSize   = '14px';
				star.style.marginInlineStart = '6px';
				star.setAttribute( 'aria-hidden', 'true' );
				host.appendChild( star );
				return function () { star.remove(); };
			},
		} );
	} );
}( window.wp ) );
