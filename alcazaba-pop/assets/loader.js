/**
 * Alcazaba POP — analog-TV loader (Layer: window loading-overlay).
 *
 * Replaces the default `<wpd-spinner>` overlay with PIXI-rendered
 * TV static + CRT scanlines + vignette + a "TUNING…" caption.
 * Per-window PIXI apps are tracked and torn down when the window's
 * content finishes loading.
 *
 * Hook used: `wp-desktop.window.loading-overlay` (Stable since 0.6.0).
 */
( function ( wp ) {
	var STYLE_ID = 'alcazaba-pop-loader-style';

	function injectStylesOnce() {
		if ( document.getElementById( STYLE_ID ) ) {
			return;
		}
		var style = document.createElement( 'style' );
		style.id = STYLE_ID;
		style.textContent = [
			'.wpd-pop-tv {',
			'  position: absolute;',
			'  inset: 0;',
			'  display: grid;',
			'  place-items: center;',
			'  background: #050505;',
			'  overflow: hidden;',
			'}',
			'.wpd-pop-tv__canvas {',
			'  position: absolute;',
			'  inset: 0;',
			'  width: 100%;',
			'  height: 100%;',
			'  display: block;',
			'}',
			/* CRT scanlines */
			'.wpd-pop-tv::before {',
			'  content: "";',
			'  position: absolute;',
			'  inset: 0;',
			'  background: repeating-linear-gradient(',
			'    0deg,',
			'    rgba( 0, 0, 0, 0.0 ) 0 2px,',
			'    rgba( 0, 0, 0, 0.35 ) 2px 3px',
			'  );',
			'  pointer-events: none;',
			'  mix-blend-mode: multiply;',
			'  z-index: 2;',
			'}',
			/* Vignette + soft RGB chromatic edges */
			'.wpd-pop-tv::after {',
			'  content: "";',
			'  position: absolute;',
			'  inset: 0;',
			'  background:',
			'    radial-gradient( ellipse at 50% 50%, transparent 50%, rgba( 0, 0, 0, 0.85 ) 100% ),',
			'    linear-gradient( 90deg, rgba( 255, 0, 0, 0.06 ), transparent 8%, transparent 92%, rgba( 0, 80, 255, 0.06 ) );',
			'  pointer-events: none;',
			'  z-index: 3;',
			'}',
			'.wpd-pop-tv__caption {',
			'  position: relative;',
			'  z-index: 4;',
			'  font-family: "Courier New", "Menlo", monospace;',
			'  font-weight: 700;',
			'  letter-spacing: 0.16em;',
			'  text-transform: uppercase;',
			'  font-size: 14px;',
			'  color: #ffd93d;',
			'  text-shadow: 0 0 8px rgba( 255, 217, 61, 0.6 ), 1px 0 0 #ff2e93, -1px 0 0 #00d4ff;',
			'  padding: 6px 12px;',
			'  background: rgba( 0, 0, 0, 0.55 );',
			'  border: 1px solid rgba( 255, 217, 61, 0.4 );',
			'  animation: wpd-pop-tv-flicker 1.6s steps( 12 ) infinite;',
			'}',
			'@keyframes wpd-pop-tv-flicker {',
			'  0%, 92%, 100% { opacity: 1; }',
			'  93% { opacity: 0.4; }',
			'  95% { opacity: 0.85; }',
			'  97% { opacity: 0.5; }',
			'}',
			'@media ( prefers-reduced-motion: reduce ) {',
			'  .wpd-pop-tv__caption { animation: none; }',
			'}',
			'',
		].join( '\n' );
		document.head.appendChild( style );
	}

	// windowId → { teardown }
	var live = new Map();

	function teardownFor( windowId ) {
		var entry = live.get( windowId );
		if ( ! entry ) {
			return;
		}
		live.delete( windowId );
		try {
			entry.teardown();
		} catch ( err ) {
			/* swallow; a botched teardown can't be allowed to leak. */
		}
	}

	/**
	 * Build the static-TV overlay. Starts a PIXI app if PIXI is
	 * already loaded; otherwise paints a vanilla 2D-canvas noise
	 * fallback while PIXI loads, then upgrades.
	 */
	function buildOverlay( windowId ) {
		var wrap = document.createElement( 'div' );
		wrap.className = 'wpd-pop-tv';

		var canvas = document.createElement( 'canvas' );
		canvas.className = 'wpd-pop-tv__canvas';
		wrap.appendChild( canvas );

		var caption = document.createElement( 'div' );
		caption.className = 'wpd-pop-tv__caption';
		caption.textContent = 'NO SIGNAL — TUNING…';
		wrap.appendChild( caption );

		// Sizing — defer to after the overlay is in the DOM. The
		// shell appends the returned element; we size on the next
		// frame when getBoundingClientRect() is meaningful.
		var pixiApp = null;
		var rafId   = null;
		var alive   = true;

		function startVanilla() {
			var ctx = canvas.getContext( '2d' );
			function paint() {
				if ( ! alive ) { return; }
				var w = canvas.width  = wrap.clientWidth  || 1;
				var h = canvas.height = wrap.clientHeight || 1;
				// Coarse noise blocks (8px) — cheaper than per-pixel
				// and looks more "analog".
				var bw = Math.ceil( w / 4 );
				var bh = Math.ceil( h / 4 );
				var img = ctx.createImageData( bw, bh );
				for ( var i = 0; i < img.data.length; i += 4 ) {
					var v = ( Math.random() * 255 ) | 0;
					img.data[ i ]     = v;
					img.data[ i + 1 ] = v;
					img.data[ i + 2 ] = v;
					img.data[ i + 3 ] = 255;
				}
				// Paint the small image stretched 4x.
				var off = document.createElement( 'canvas' );
				off.width  = bw;
				off.height = bh;
				off.getContext( '2d' ).putImageData( img, 0, 0 );
				ctx.imageSmoothingEnabled = false;
				ctx.drawImage( off, 0, 0, w, h );
				rafId = window.requestAnimationFrame( paint );
			}
			paint();
		}

		async function startPixi( PIXI ) {
			try {
				var app = new PIXI.Application();
				await app.init( {
					canvas:     canvas,
					resizeTo:   wrap,
					background: 0x050505,
					antialias:  false,
				} );
				if ( ! alive ) {
					app.destroy( true );
					return;
				}
				// Stop the vanilla rAF — PIXI now drives.
				if ( rafId ) {
					window.cancelAnimationFrame( rafId );
					rafId = null;
				}
				pixiApp = app;

				// Full-bleed white quad with NoiseFilter applied.
				var quad = new PIXI.Graphics()
					.rect( 0, 0, app.renderer.width, app.renderer.height )
					.fill( 0xb0b0b0 );

				var noise = new PIXI.NoiseFilter( { noise: 1.0, seed: Math.random() } );
				quad.filters = [ noise ];
				app.stage.addChild( quad );

				// Re-fit the quad on resize.
				app.renderer.on( 'resize', function ( w, h ) {
					quad.clear().rect( 0, 0, w, h ).fill( 0xb0b0b0 );
				} );

				app.ticker.add( function () {
					noise.seed = Math.random();
				} );
			} catch ( err ) {
				/* PIXI failed — the vanilla fallback is already running. */
			}
		}

		// Kick off the right backend.
		var PIXI_GLOBAL = window.PIXI;
		if ( PIXI_GLOBAL && PIXI_GLOBAL.Application ) {
			// Defer one frame so layout has happened.
			window.requestAnimationFrame( function () {
				if ( alive ) { startPixi( PIXI_GLOBAL ); }
			} );
		} else {
			startVanilla();
			if ( wp.desktop.loadModules ) {
				wp.desktop.loadModules( [ 'pixijs' ] ).then( function () {
					if ( alive && window.PIXI ) {
						startPixi( window.PIXI );
					}
				} ).catch( function () { /* stay vanilla */ } );
			}
		}

		var teardown = function () {
			alive = false;
			if ( rafId ) {
				window.cancelAnimationFrame( rafId );
				rafId = null;
			}
			if ( pixiApp ) {
				try { pixiApp.destroy( true ); } catch ( err ) { /* */ }
				pixiApp = null;
			}
		};

		// Register for cleanup when the window finishes loading.
		// Replace any previous entry for this windowId — only the
		// latest overlay should be torn down by the action.
		teardownFor( windowId );
		live.set( windowId, { teardown: teardown } );

		return wrap;
	}

	wp.desktop.whenReady( function () {
		injectStylesOnce();

		// Preload PIXI so the first window-open uses it directly.
		if ( wp.desktop.loadModules ) {
			wp.desktop.loadModules( [ 'pixijs' ] ).catch( function () { /* */ } );
		}

		wp.desktop.hooks.addFilter(
			'wp-desktop.window.loading-overlay',
			'alcazaba-pop/analog-tv',
			function ( host, ctx ) {
				var windowId = ( ctx && ctx.windowId ) || 'unknown';
				return buildOverlay( windowId );
			},
		);

		// Tear down PIXI apps when their window finishes loading.
		wp.desktop.hooks.addAction(
			'wp-desktop.window.content-loaded',
			'alcazaba-pop/analog-tv-cleanup',
			function ( payload ) {
				if ( payload && payload.windowId ) {
					teardownFor( payload.windowId );
				}
			},
		);
	} );
}( window.wp ) );
