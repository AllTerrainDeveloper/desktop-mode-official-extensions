/**
 * Alcazaba Snow — a PixiJS-powered realistic snow wallpaper for
 * WP Desktop Mode.
 *
 * Registered end-to-end in PHP via `desktop_mode_register_wallpaper()`
 * — the shell owns the OS Settings swatch, the script enqueue, and
 * the mount lifecycle across plugin activation / deactivation. This
 * file only contributes the wallpaper def, published on
 * `window.wpDesktopWallpapers[ 'alcazaba-snow' ]` for the shell to
 * pick up. `needs: ['pixijs']` tells the shell to lazy-load the
 * bundled Pixi vendor script before `mount` fires; by then
 * `window.PIXI` is the full v8 namespace.
 *
 * Simulation contract:
 *   1. A fixed-size sprite pool (CONFIG.maxParticles) is built up
 *      front. No per-frame allocations.
 *   2. Each tick, free sprites are spawned off the top of the
 *      canvas with randomized velocity, size, alpha, sway.
 *   3. Wind is a slow global sin sweep; per-particle sway layers
 *      a small per-particle sin on top so the field never feels
 *      uniform.
 *   4. Every frame, each falling flake checks the last-frame Y
 *      against the top edge of every visible `.wp-desktop-window`
 *      (and the bottom of the canvas). A crossing → sticks the
 *      flake to the window with an anchor offset so it drags
 *      along when the user moves the window.
 *   5. A stuck flake lives for `stuckLifeSec ± jitter` then
 *      starts the melt phase — shrink + fade over
 *      `meltDurationSec`, then returned to the free list.
 *
 * Deallocation:
 *   - Melted sprites reset alpha/scale and are pushed back on
 *     the free list; sprite objects themselves are reused for
 *     the life of the wallpaper.
 *   - Teardown destroys the Pixi Application (WebGL context,
 *     texture atlas, every sprite), removes hook listeners, and
 *     restores the container's prior `background` style.
 *
 * @since 0.1.0
 */

( function () {
	'use strict';

	var WALLPAPER_ID = 'alcazaba-snow';
	var NAMESPACE    = 'alcazaba-snow';

	/**
	 * CSS gradient used both for the OS Settings preview swatch
	 * (shown before PixiJS is loaded) and as the backdrop the
	 * transparent Pixi canvas renders over.
	 */
	var BACKDROP_CSS =
		'linear-gradient(180deg, #0c1a36 0%, #1d355e 55%, #425d8a 100%)';

	/**
	 * Physics / simulation tuning. All values are CSS pixels or
	 * seconds unless noted. Adjust together — changing one
	 * usually means revisiting the others.
	 */
	var CONFIG = {
		/** Pool size. Larger = denser field, heavier frame cost. */
		maxParticles:     700,
		/** Spawn rate while the field is unsaturated. */
		spawnPerSecond:   110,
		/** Min / max vertical gravity-ish drift (px/s). Bumped up
		 *  from 28/82 to counter the perceptual slowdown smaller
		 *  flakes introduce: visually, a 0.4px flake travelling at
		 *  28px/s reads as "drifting" rather than "falling". These
		 *  numbers restore the sense of motion the larger flakes
		 *  used to convey for free. */
		gravityMin:       38,
		gravityMax:       110,
		/** Peak horizontal wind (px/s). */
		windAmplitude:    22,
		/** Period of the global wind sweep (seconds). */
		windPeriodSec:    11,
		/** Per-particle sway amplitude (px/s target). */
		driftAmplitude:   32,
		driftPeriodMin:   2.5,
		driftPeriodMax:   5.5,
		/** Max rotation speed (rad/s). */
		rotationMax:      1.0,
		/** Sprite world size in CSS px. The texture is 32px and scale
		 *  is `size / 16`, so a "size 0.15" flake renders at ~0.3px
		 *  and "size 0.55" at ~1.1px — fine snow dust. The
		 *  radial-gradient texture has a bright ~10px core that
		 *  shrinks down with it, so the visual "dot" ends up a bit
		 *  under half the bounding box. */
		sizeMin:          0.15,
		sizeMax:          0.55,
		alphaMin:         0.55,
		alphaMax:         1.0,
		/** Melt duration once a stuck flake starts melting. */
		meltDurationSec:  1.8,
		/** How long a flake stays stuck before it starts melting. A
		 *  small jitter is still applied per flake so an entire
		 *  windowful doesn't melt in lockstep — real snow crystals
		 *  melt at slightly different rates depending on mass + local
		 *  temperature. */
		stuckLifeSec:     5.0,
		stuckLifeJitter:  1.0,
		/** A small inset on the window top so flakes don't visibly
		 *  overlap the title-bar drop shadow. */
		collisionMarginY: 2,
	};

	/**
	 * Rasterize a soft-glow snowflake sprite on a 32×32 canvas
	 * and hand it to Pixi as a Texture. One texture, shared by
	 * every sprite — the hot loop only varies scale, alpha,
	 * rotation, position.
	 *
	 * @param {Object} pixi window.PIXI namespace.
	 * @return {PIXI.Texture} Shared sprite texture.
	 */
	function buildSnowflakeTexture( pixi ) {
		var size = 32;
		var canvas = document.createElement( 'canvas' );
		canvas.width  = size;
		canvas.height = size;
		var ctx = canvas.getContext( '2d' );
		var cx = size / 2;
		var cy = size / 2;

		// Soft radial glow — accounts for ~80% of the visual
		// weight; the crystal arms below are an accent.
		var grad = ctx.createRadialGradient( cx, cy, 0, cx, cy, size / 2 );
		grad.addColorStop( 0,    'rgba(255,255,255,1)' );
		grad.addColorStop( 0.3,  'rgba(240,248,255,0.75)' );
		grad.addColorStop( 1,    'rgba(200,220,255,0)' );
		ctx.fillStyle = grad;
		ctx.fillRect( 0, 0, size, size );

		ctx.globalCompositeOperation = 'lighter';
		ctx.strokeStyle = 'rgba(255,255,255,0.7)';
		ctx.lineWidth   = 1;
		for ( var a = 0; a < 6; a++ ) {
			var ang = ( Math.PI / 3 ) * a;
			ctx.beginPath();
			ctx.moveTo( cx, cy );
			ctx.lineTo(
				cx + Math.cos( ang ) * ( size / 2 - 2 ),
				cy + Math.sin( ang ) * ( size / 2 - 2 )
			);
			ctx.stroke();
		}

		return pixi.Texture.from( canvas );
	}

	function rand( a, b ) {
		return a + Math.random() * ( b - a );
	}

	/**
	 * Called by the shell when the user picks this wallpaper.
	 *
	 * @param {HTMLElement} container Fresh empty div sized to fill the shell.
	 * @param {Object}      ctx       WallpaperContext from the shell.
	 * @return {Promise<Function>} Resolves to a teardown that fully releases resources.
	 */
	function mountSnow( container, ctx ) {
		var api  = window.wp && window.wp.desktop;
		var pixi = window.PIXI;
		if ( ! pixi || ! api ) {
			return Promise.resolve( function () {} );
		}

		// Backdrop: pure CSS; the transparent Pixi canvas overlays
		// and gives the field its sense of depth.
		var priorBackground = container.style.background;
		container.style.background = BACKDROP_CSS;

		var app = new pixi.Application();

		return app.init( {
			resizeTo:        container,
			backgroundAlpha: 0,
			antialias:       true,
			autoDensity:     true,
			resolution:      Math.min( window.devicePixelRatio || 1, 2 ),
		} ).then( function () {
			return buildScene( app, pixi, api, container, ctx, priorBackground );
		} ).catch( function ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error( '[alcazaba-snow] Pixi init failed:', err );
			}
			container.style.background = priorBackground;
			return function () {};
		} );
	}

	/**
	 * Wire up the sprite pool, ticker, and hook listeners on a
	 * Pixi application that has already finished `init()`.
	 *
	 * @return {Function} Teardown.
	 */
	function buildScene( app, pixi, api, container, ctx, priorBackground ) {
		container.appendChild( app.canvas );
		app.canvas.style.position      = 'absolute';
		app.canvas.style.inset         = '0';
		app.canvas.style.width         = '100%';
		app.canvas.style.height        = '100%';
		app.canvas.style.pointerEvents = 'none';

		var texture = buildSnowflakeTexture( pixi );

		// Pixi v8's ParticleContainer is the fast path for many
		// sprites sharing a single texture: it bypasses the full
		// display-list tree and batches per-particle attributes
		// into tight vertex buffers. `dynamicProperties` declares
		// which fields we mutate each frame so Pixi lays the GPU
		// buffer out for per-frame updates (position, scale,
		// rotation) vs. upload-once (color — we tint uniformly
		// but still mutate alpha, so color stays dynamic).
		//
		// Children of a ParticleContainer are `Particle` objects,
		// not `Sprite`s — the property surface is flatter (`x`,
		// `y`, `scaleX`, `scaleY`, `alpha` as plain fields rather
		// than `.position.set()` / `.scale.set()` calls).
		var stage = new pixi.ParticleContainer( {
			dynamicProperties: {
				position: true,
				scale:    true,
				rotation: true,
				color:    true,
			},
		} );
		app.stage.addChild( stage );

		var MAX = CONFIG.maxParticles;

		// Flat typed arrays — the tick loop does zero heap
		// allocations per particle per frame.
		var pX          = new Float32Array( MAX );
		var pY          = new Float32Array( MAX );
		var pVX         = new Float32Array( MAX );
		var pVY         = new Float32Array( MAX );
		var pSize       = new Float32Array( MAX );
		var pRot        = new Float32Array( MAX );
		var pRotVel     = new Float32Array( MAX );
		var pDriftPhase = new Float32Array( MAX );
		var pDriftFreq  = new Float32Array( MAX );
		var pDriftAmp   = new Float32Array( MAX );
		var pBaseAlpha  = new Float32Array( MAX );
		/** 0 free · 1 falling · 2 stuck · 3 melting */
		var pState     = new Uint8Array( MAX );
		/** Window element this flake is stuck to (null = floor). */
		var pAnchor    = new Array( MAX );
		var pAnchorDX  = new Float32Array( MAX );
		var pAnchorDY  = new Float32Array( MAX );
		var pStuckLife = new Float32Array( MAX );
		var pMelt      = new Float32Array( MAX );

		var particles = new Array( MAX );
		var freeList  = new Array( MAX );
		for ( var i = 0; i < MAX; i++ ) {
			var particle = new pixi.Particle( {
				texture: texture,
				anchorX: 0.5,
				anchorY: 0.5,
				// Free particles are hidden via alpha rather than
				// removed from the container — the mutation is
				// already on the GPU's dynamic-color path, so this
				// is cheaper than churning the particle list.
				alpha:   0,
				tint:    0xffffff,
			} );
			stage.addParticle( particle );
			particles[ i ] = particle;
			pState[ i ]    = 0;
			pAnchor[ i ]   = null;
			// Populate the free-list in reverse so we spawn from
			// index 0 onward — a minor quality-of-life for debugging.
			freeList[ i ]  = MAX - 1 - i;
		}
		var freeCount = MAX;

		// Cached list of solid surfaces with a `top` face — the shell
		// owns the authoritative list (windows, taskbar, widget cards,
		// shell floor, plus anything plugin filters push in via
		// `wp-desktop.wallpaper.surfaces`) and hands it back via
		// `wp.desktop.getWallpaperSurfaces()`. We refresh on a 20Hz
		// cadence, and eagerly whenever a drag/resize fires
		// WINDOW_BOUNDS_CHANGED so stuck-flake positions track
		// fast-moving windows without a one-tick lag.
		var surfaces       = [];
		var surfacesDirty  = true;
		var canvasRect     = app.canvas.getBoundingClientRect();

		function refreshCanvasRect() {
			canvasRect = app.canvas.getBoundingClientRect();
		}

		function refreshSurfacesIfDirty() {
			if ( ! surfacesDirty ) {
				return;
			}
			surfaces.length = 0;
			if ( typeof api.getWallpaperSurfaces !== 'function' ) {
				return;
			}
			var all = api.getWallpaperSurfaces();
			for ( var k = 0; k < all.length; k++ ) {
				var s = all[ k ];
				// Accumulation is only defined for horizontal tops.
				// Vertical surfaces (dock edge) are in the list but
				// snow doesn't pile on them — skip.
				if ( s.face !== 'top' ) {
					continue;
				}
				if ( s.rect.width <= 0 || s.rect.height <= 0 ) {
					continue;
				}
				surfaces.push( s );
			}
			surfacesDirty = false;
		}

		function spawn() {
			if ( freeCount === 0 ) {
				return;
			}
			var idx = freeList[ --freeCount ];
			var w   = app.canvas.clientWidth;
			pX[ idx ]          = Math.random() * w;
			pY[ idx ]          = -rand( 4, 40 );
			pVX[ idx ]         = rand( -8, 8 );
			pVY[ idx ]         = rand( CONFIG.gravityMin, CONFIG.gravityMax );
			pSize[ idx ]       = rand( CONFIG.sizeMin, CONFIG.sizeMax );
			pRot[ idx ]        = Math.random() * Math.PI * 2;
			pRotVel[ idx ]     = rand( -CONFIG.rotationMax, CONFIG.rotationMax );
			pDriftPhase[ idx ] = Math.random() * Math.PI * 2;
			pDriftFreq[ idx ]  =
				( 2 * Math.PI ) /
				rand( CONFIG.driftPeriodMin, CONFIG.driftPeriodMax );
			pDriftAmp[ idx ]   = rand( 6, CONFIG.driftAmplitude );
			pBaseAlpha[ idx ]  = rand( CONFIG.alphaMin, CONFIG.alphaMax );
			pMelt[ idx ]       = 0;
			pStuckLife[ idx ]  = 0;
			pAnchor[ idx ]     = null;
			pState[ idx ]      = 1;

			var particle = particles[ idx ];
			var scale    = pSize[ idx ] / 16;
			particle.scaleX   = scale;
			particle.scaleY   = scale;
			particle.alpha    = pBaseAlpha[ idx ];
			particle.rotation = pRot[ idx ];
			particle.x        = pX[ idx ];
			particle.y        = pY[ idx ];
		}

		function release( idx ) {
			pState[ idx ]  = 0;
			pAnchor[ idx ] = null;
			// Hide via alpha — the Particle stays in the container
			// and is reused when the free-list hands this index back
			// out from spawn().
			particles[ idx ].alpha = 0;
			freeList[ freeCount++ ] = idx;
		}

		function stick( idx, anchorEl, dx, dy ) {
			pState[ idx ]     = 2;
			pAnchor[ idx ]    = anchorEl;
			pAnchorDX[ idx ]  = dx;
			pAnchorDY[ idx ]  = dy;
			pVX[ idx ]        = 0;
			pVY[ idx ]        = 0;
			pRotVel[ idx ]    = 0;
			pStuckLife[ idx ] = rand(
				CONFIG.stuckLifeSec - CONFIG.stuckLifeJitter,
				CONFIG.stuckLifeSec + CONFIG.stuckLifeJitter
			);
		}

		function startMelt( idx ) {
			pState[ idx ] = 3;
			pMelt[ idx ]  = 0;
		}

		/**
		 * Drop a stuck flake back into the falling state — used when
		 * the surface under it disappears (window closes) rather than
		 * melts. Physically: the "ground" has been yanked away, so
		 * gravity takes over and the flake resumes its descent from
		 * wherever it was resting. Sway parameters set at spawn
		 * survive, so the detached flake immediately looks like a
		 * real falling flake rather than one that teleported.
		 */
		function detachToFalling( idx ) {
			pState[ idx ]  = 1;
			pAnchor[ idx ] = null;
			// Gentle restart: starts slower than a freshly-spawned
			// flake (which enters near terminal drift speed), with
			// minor horizontal jitter so a whole windowful of flakes
			// doesn't fall as a rigid sheet.
			pVX[ idx ]     = rand( -6, 6 );
			pVY[ idx ]     = rand(
				CONFIG.gravityMin * 0.35,
				CONFIG.gravityMin * 0.9
			);
			pRotVel[ idx ] = rand(
				-CONFIG.rotationMax,
				CONFIG.rotationMax
			) * 0.5;
		}

		/**
		 * Collision test — falling flake vs every `top` surface the
		 * shell publishes. Crossing is detected by comparing
		 * last-frame Y to this-frame Y against the edge line, so
		 * fast-moving flakes can't "tunnel" through in a single
		 * tick.
		 *
		 * Coordinates: pX / pY live in the Pixi canvas's local
		 * space (0,0 = top-left of the wallpaper layer). Surface
		 * rects come in viewport coordinates (see shell docs on
		 * `WallpaperSurface`), so we bridge through canvasRect.
		 *
		 * The shell's surface list already covers the floor (as
		 * `shell:floor`), taskbar top, widget-card tops, and every
		 * non-minimized window top — no separate floor path needed.
		 */
		function collideWithSurfaces( idx, prevY ) {
			var vpX     = pX[ idx ] + canvasRect.left;
			var vpY     = pY[ idx ] + canvasRect.top;
			var prevVpY = prevY + canvasRect.top;
			for ( var k = 0; k < surfaces.length; k++ ) {
				var s = surfaces[ k ];
				var r = s.rect;
				if ( vpX < r.x || vpX > r.x + r.width ) {
					continue;
				}
				var top = r.y + CONFIG.collisionMarginY;
				if ( prevVpY <= top && vpY >= top ) {
					// `element` is the live DOM node (or null for
					// synthetic filter surfaces) — we use it as the
					// anchor so stuck flakes follow the surface's
					// own geometry. Offset is relative to the
					// surface rect's top-left corner.
					stick( idx, s.element, vpX - r.x, 0 );
					return true;
				}
			}
			return false;
		}

		var elapsed         = 0;
		var lastRectRefresh = -1;
		var spawnAccum      = 0;
		var animating       = ! ctx.prefersReducedMotion;
		if ( ! animating ) {
			// A static frame: spawn a partial field once, pause.
			for ( var s = 0; s < MAX * 0.35; s++ ) {
				spawn();
			}
		}

		function tick( ticker ) {
			var dt = ticker.deltaMS / 1000;
			if ( dt > 0.1 ) {
				dt = 0.1; // clamp tab-restore hiccups
			}
			elapsed += dt;

			// Cheap refresh cadence — the surface cache is only
			// stale by one frame during a drag, imperceptible to
			// the eye. WINDOW_BOUNDS_CHANGED additionally flips
			// the dirty bit mid-interval during active drags, so
			// stuck flakes track fast-moving windows smoothly.
			if ( elapsed - lastRectRefresh > 0.05 ) {
				surfacesDirty  = true;
				lastRectRefresh = elapsed;
			}
			refreshCanvasRect();
			refreshSurfacesIfDirty();

			var wind = Math.sin(
				( elapsed / CONFIG.windPeriodSec ) * Math.PI * 2
			) * CONFIG.windAmplitude;

			if ( animating ) {
				spawnAccum += dt * CONFIG.spawnPerSecond;
				while ( spawnAccum >= 1 ) {
					spawn();
					spawnAccum -= 1;
				}
			}

			var w = app.canvas.clientWidth;
			var h = app.canvas.clientHeight;

			for ( var idx = 0; idx < MAX; idx++ ) {
				var st = pState[ idx ];
				if ( st === 0 ) {
					continue;
				}
				var particle = particles[ idx ];

				if ( st === 1 ) {
					var prevY = pY[ idx ];

					var sway = Math.sin(
						elapsed * pDriftFreq[ idx ] + pDriftPhase[ idx ]
					) * pDriftAmp[ idx ];
					// Ease vx toward (wind + sway) so gusts feel
					// inertial rather than snapping.
					pVX[ idx ] += ( ( wind + sway ) - pVX[ idx ] ) *
						Math.min( 1, dt * 1.5 );

					pX[ idx ]  += pVX[ idx ] * dt;
					pY[ idx ]  += pVY[ idx ] * dt;
					pRot[ idx ] += pRotVel[ idx ] * dt;

					// Horizontal wrap — keeps the field dense
					// without spawning sideways edge cases.
					if ( pX[ idx ] < -16 ) {
						pX[ idx ] += w + 32;
					} else if ( pX[ idx ] > w + 16 ) {
						pX[ idx ] -= w + 32;
					}

					if ( collideWithSurfaces( idx, prevY ) ) {
						// Position already handled by stick().
					} else if ( pY[ idx ] > h + 24 ) {
						// Fell past every surface — the shell floor
						// should have caught the flake, but if no
						// shell exists (unlikely) recycle anyway.
						release( idx );
						continue;
					}

					if ( pState[ idx ] === 1 ) {
						particle.x        = pX[ idx ];
						particle.y        = pY[ idx ];
						particle.rotation = pRot[ idx ];
					}
				}

				if ( pState[ idx ] === 2 ) {
					var anchorEl = pAnchor[ idx ];
					if ( anchorEl ) {
						// Two distinct "anchor is gone" modes:
						//
						//   `!isConnected` → the anchor element has
						//   been removed from the DOM entirely (the
						//   underlying window / widget / card has
						//   been destroyed). Physically this is
						//   "someone yanked the ground away" — the
						//   realistic response is gravity, so we
						//   detach the flake back into the falling
						//   state and let it continue its descent.
						//
						//   `offsetParent === null` → the element is
						//   still in the DOM but not rendering
						//   (minimized window, switched virtual
						//   desktop, collapsed widget). Physically
						//   the ground is still there, just hidden —
						//   the flake has nowhere to fall to, so it
						//   melts in place. This also prevents a
						//   minimize/restore cycle from visually
						//   "respawning" flakes mid-air.
						if ( ! anchorEl.isConnected ) {
							detachToFalling( idx );
						} else if ( anchorEl.offsetParent === null ) {
							startMelt( idx );
						} else {
							var arect = anchorEl.getBoundingClientRect();
							var ax = arect.left - canvasRect.left + pAnchorDX[ idx ];
							var ay = arect.top  - canvasRect.top  + pAnchorDY[ idx ];
							pX[ idx ] = ax;
							pY[ idx ] = ay;
							particle.x = ax;
							particle.y = ay;
						}
					} else {
						particle.x = pX[ idx ];
						particle.y = pY[ idx ];
					}

					if ( pState[ idx ] === 2 ) {
						pStuckLife[ idx ] -= dt;
						if ( pStuckLife[ idx ] <= 0 ) {
							startMelt( idx );
						}
					}
				}

				if ( pState[ idx ] === 3 ) {
					pMelt[ idx ] += dt / CONFIG.meltDurationSec;
					var t = pMelt[ idx ] > 1 ? 1 : pMelt[ idx ];
					particle.alpha = pBaseAlpha[ idx ] * ( 1 - t );
					var meltScale = ( pSize[ idx ] / 16 ) * ( 1 - t * 0.6 );
					particle.scaleX = meltScale;
					particle.scaleY = meltScale;
					if ( t >= 1 ) {
						release( idx );
					}
				}
			}
		}

		app.ticker.add( tick );
		if ( ! animating ) {
			// Render one frame so the static preview populates,
			// then hold.
			app.ticker.update();
			app.ticker.stop();
		}

		// Pause when the document is hidden or the user switched
		// wallpapers (the shell still has us mounted briefly).
		var visibilityHandler = function ( detail ) {
			if ( ! detail || detail.id !== WALLPAPER_ID ) {
				return;
			}
			animating = detail.state === 'visible' && ! ctx.prefersReducedMotion;
			if ( animating ) {
				app.ticker.start();
			} else {
				app.ticker.stop();
			}
		};
		api.hooks.addAction(
			api.HOOKS.WALLPAPER_VISIBILITY,
			NAMESPACE + '/visibility',
			visibilityHandler
		);

		// WINDOW_CLOSING fires *before* the shell detaches the
		// window element, and hands us the live DOM node — so we
		// can match stuck flakes by identity instead of reverse-
		// engineering the id → selector mapping. We detach every
		// matching flake back into the falling state: the surface
		// under it is physically disappearing, so the realistic
		// behavior is gravity — not melting in place. Flakes then
		// continue through the normal collision path and may land
		// on whatever window (or the shell floor) sits beneath.
		var windowClosingHandler = function ( detail ) {
			if ( ! detail || ! detail.element ) {
				return;
			}
			for ( var i = 0; i < MAX; i++ ) {
				if ( pState[ i ] === 2 && pAnchor[ i ] === detail.element ) {
					detachToFalling( i );
				}
			}
		};
		api.hooks.addAction(
			api.HOOKS.WINDOW_CLOSING,
			NAMESPACE + '/window-closing',
			windowClosingHandler
		);

		// WINDOW_BOUNDS_CHANGED is rAF-coalesced by the shell and
		// fires on drag, resize, snap, maximize — anything that
		// moves a window edge. Flipping the dirty bit here
		// short-circuits the 20Hz cadence so the next tick rebuilds
		// the surface cache against the current rects; stuck flakes
		// following the anchor still read DOM rects directly, but
		// *new* collisions get a fresh edge list within one frame.
		var boundsChangedHandler = function () {
			surfacesDirty = true;
		};
		api.hooks.addAction(
			api.HOOKS.WINDOW_BOUNDS_CHANGED,
			NAMESPACE + '/bounds-changed',
			boundsChangedHandler
		);

		// WIDGET_UNMOUNTING fires *before* the widget layer runs the
		// widget's teardown, so the card element is still in the DOM
		// at this moment — meaning we can reach it via
		// `[data-widget-id="…"]` and drop every stuck flake on it into
		// the falling state. Same reasoning as WINDOW_CLOSING: the
		// surface is about to vanish, gravity takes over, flakes keep
		// falling rather than melting in place.
		//
		// The payload is `{ id }` only (no element), so we query by
		// attribute. If the widget was never actually rendered (edge
		// case during a fast add/remove) the selector misses and the
		// loop does nothing — safe no-op.
		var widgetUnmountingHandler = function ( detail ) {
			if ( ! detail || ! detail.id ) {
				return;
			}
			var safeId = window.CSS && typeof CSS.escape === 'function'
				? CSS.escape( detail.id )
				: String( detail.id ).replace( /"/g, '\\"' );
			var card = document.querySelector(
				'[data-widget-id="' + safeId + '"]'
			);
			if ( ! card ) {
				return;
			}
			for ( var j = 0; j < MAX; j++ ) {
				if ( pState[ j ] === 2 && pAnchor[ j ] === card ) {
					detachToFalling( j );
				}
			}
		};
		api.hooks.addAction(
			api.HOOKS.WIDGET_UNMOUNTING,
			NAMESPACE + '/widget-unmounting',
			widgetUnmountingHandler
		);

		return function teardown() {
			api.hooks.removeAction(
				api.HOOKS.WALLPAPER_VISIBILITY,
				NAMESPACE + '/visibility'
			);
			api.hooks.removeAction(
				api.HOOKS.WINDOW_CLOSING,
				NAMESPACE + '/window-closing'
			);
			api.hooks.removeAction(
				api.HOOKS.WINDOW_BOUNDS_CHANGED,
				NAMESPACE + '/bounds-changed'
			);
			api.hooks.removeAction(
				api.HOOKS.WIDGET_UNMOUNTING,
				NAMESPACE + '/widget-unmounting'
			);
			app.ticker.stop();
			app.ticker.remove( tick );
			// Destroy the Pixi app — releases the WebGL context,
			// the canvas, every sprite, and the generated texture.
			app.destroy(
				{ removeView: true },
				{ children: true, texture: true, textureSource: true }
			);
			// Break references the GC might not reclaim otherwise.
			for ( var i = 0; i < MAX; i++ ) {
				particles[ i ] = null;
				pAnchor[ i ]   = null;
			}
			container.style.background = priorBackground;
		};
	}

	// Publish the full wallpaper def on the global registry the
	// shell reads when syncing wallpapers declared via
	// `desktop_mode_register_wallpaper()`. No `whenReady` dance, no
	// `wp.desktop.registerWallpaper` call — the shell owns swatch
	// lifecycle and calls `mount` when the user picks us.
	//
	// Keying on the same id the PHP side passed to
	// `desktop_mode_register_wallpaper()` is the contract between the
	// two halves. The preview + label on the PHP side drives the
	// swatch before this script even loads; the fields here drive
	// behaviour once the user selects the wallpaper (`needs` tells
	// the shell to lazy-load the Pixi vendor bundle first; `mount`
	// fires against a ready container).
	window.wpDesktopWallpapers = window.wpDesktopWallpapers || {};
	window.wpDesktopWallpapers[ WALLPAPER_ID ] = {
		id:      WALLPAPER_ID,
		label:   'Snow',
		type:    'canvas',
		preview: BACKDROP_CSS,
		needs:   [ 'pixijs' ],
		mount:   mountSnow,
	};
}() );
