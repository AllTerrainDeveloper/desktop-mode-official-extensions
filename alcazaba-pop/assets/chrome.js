/**
 * Alcazaba POP — Layer 4 custom window chrome (RADICAL edition).
 *
 * Replaces the title-bar tree on every window AND adds sibling
 * decorations to the window host (rotated "★ POP ★" sticker,
 * speech-bubble tail). The framework still owns body, iframe, and
 * resize handles — we only mutate around them.
 */
( function ( wp ) {
	var STYLE_ID = 'alcazaba-pop-chrome-style';

	function injectStylesOnce() {
		if ( document.getElementById( STYLE_ID ) ) {
			return;
		}
		var style = document.createElement( 'style' );
		style.id = STYLE_ID;
		style.textContent = [
			'.wpd-pop {',
			'  --pop-magenta: #ff2e93;',
			'  --pop-yellow:  #ffd93d;',
			'  --pop-cyan:    #00d4ff;',
			'  --pop-violet:  #7a00ff;',
			'  --pop-ink:     #0a0a0a;',
			'  --pop-paper:   #fffdf2;',
			'}',
			'.wpd-pop__bar {',
			'  position: relative;',
			'  display: flex;',
			'  align-items: center;',
			'  gap: 12px;',
			'  padding: 0 14px;',
			'  height: 48px;',
			'  border-bottom: 4px solid var( --pop-ink );',
			'  background:',
			'    radial-gradient( circle at 50% 50%, rgba(0,0,0,0.18) 30%, transparent 31% ) 0 0 / 10px 10px,',
			'    repeating-linear-gradient( -45deg, transparent 0 14px, rgba(255,255,255,0.18) 14px 16px ),',
			'    var( --pop-magenta );',
			'  color: #fff;',
			'  font-family: "Helvetica Neue", Arial, sans-serif;',
			'  overflow: hidden;',
			'}',
			'.wpd-pop:not( .wp-desktop-window--focused ) .wpd-pop__bar {',
			'  background:',
			'    radial-gradient( circle at 50% 50%, rgba(0,0,0,0.10) 30%, transparent 31% ) 0 0 / 10px 10px,',
			'    var( --pop-paper );',
			'  color: var( --pop-ink );',
			'}',
			'.wpd-pop__lights {',
			'  display: flex;',
			'  gap: 8px;',
			'  flex-shrink: 0;',
			'  z-index: 1;',
			'}',
			'.wpd-pop__btn {',
			'  width: 24px;',
			'  height: 24px;',
			'  border-radius: 50%;',
			'  border: 3px solid var( --pop-ink );',
			'  padding: 0;',
			'  cursor: pointer;',
			'  box-shadow: 2px 2px 0 0 var( --pop-ink );',
			'  transition: transform 90ms ease, box-shadow 90ms ease, background 90ms ease;',
			'  display: grid;',
			'  place-items: center;',
			'  font-weight: 900;',
			'  font-size: 12px;',
			'  line-height: 1;',
			'  color: transparent;',
			'  font-family: inherit;',
			'}',
			'.wpd-pop__btn:hover {',
			'  transform: translate( -1px, -1px ) scale( 1.12 );',
			'  box-shadow: 4px 4px 0 0 var( --pop-ink );',
			'  color: var( --pop-ink );',
			'}',
			'.wpd-pop__btn:active {',
			'  transform: translate( 2px, 2px ) scale( 0.96 );',
			'  box-shadow: 0 0 0 0 var( --pop-ink );',
			'}',
			'.wpd-pop__btn--close    { background: var( --pop-magenta ); }',
			'.wpd-pop__btn--minimize { background: var( --pop-yellow ); }',
			'.wpd-pop__btn--maximize { background: var( --pop-cyan ); }',
			'.wpd-pop__title {',
			'  flex: 1;',
			'  min-width: 0;',
			'  overflow: hidden;',
			'  text-overflow: ellipsis;',
			'  white-space: nowrap;',
			'  text-align: center;',
			'  font-weight: 900;',
			'  font-size: 18px;',
			'  letter-spacing: 0.08em;',
			'  text-transform: uppercase;',
			'  text-shadow:',
			'    -2px 0 0 var( --pop-ink ),',
			'     2px 0 0 var( --pop-ink ),',
			'     0 -2px 0 var( --pop-ink ),',
			'     0  2px 0 var( --pop-ink ),',
			'     3px 3px 0 var( --pop-yellow );',
			'  z-index: 1;',
			'}',
			'.wpd-pop__star {',
			'  flex-shrink: 0;',
			'  font-size: 22px;',
			'  font-weight: 900;',
			'  line-height: 1;',
			'  color: var( --pop-yellow );',
			'  text-shadow:',
			'    -2px 0 0 var( --pop-ink ),',
			'     2px 0 0 var( --pop-ink ),',
			'     0 -2px 0 var( --pop-ink ),',
			'     0  2px 0 var( --pop-ink );',
			'  z-index: 1;',
			'}',
			'.wpd-pop:not( .wp-desktop-window--focused ) .wpd-pop__star { color: var( --pop-magenta ); }',
			'.wpd-pop__zap {',
			'  position: absolute;',
			'  z-index: 2;',
			'  font-family: "Helvetica Neue", Arial, sans-serif;',
			'  font-weight: 900;',
			'  letter-spacing: 0.06em;',
			'  color: var( --pop-ink );',
			'  padding: 4px 10px;',
			'  border: 3px solid var( --pop-ink );',
			'  border-radius: 4px;',
			'  box-shadow: 3px 3px 0 0 var( --pop-ink );',
			'  pointer-events: none;',
			'  user-select: none;',
			'  text-transform: uppercase;',
			'}',
			'.wpd-pop__zap--tl {',
			'  top: -10px;',
			'  left: 24px;',
			'  font-size: 13px;',
			'  background: var( --pop-magenta );',
			'  color: #fff;',
			'  transform: rotate( -6deg );',
			'}',
			'.wpd-pop__zap--bl {',
			'  bottom: -8px;',
			'  left: 28px;',
			'  font-size: 14px;',
			'  background: var( --pop-cyan );',
			'  transform: rotate( -4deg );',
			'}',
			'.wpd-pop__zap--br {',
			'  bottom: -6px;',
			'  right: 30px;',
			'  font-size: 11px;',
			'  background: var( --pop-yellow );',
			'  transform: rotate( 5deg );',
			'}',
			'.wpd-pop:not( .wp-desktop-window--focused ) .wpd-pop__zap { opacity: 0.55; }',
			'',
		].join( '\n' );
		document.head.appendChild( style );
	}

	var POP_COLORS = [ '#ff2e93', '#ffd93d', '#00d4ff', '#7a00ff', '#ffffff' ];

	/**
	 * One-shot confetti burst overlaid on a window. Spawns ~36
	 * particles from the title-bar area, flings them up and out,
	 * applies gravity + friction + spin, fades them out, and
	 * removes the canvas when done. Honours prefers-reduced-motion
	 * (renders nothing). Pointer-events disabled so it never
	 * blocks the iframe.
	 */
	function burstConfetti( host ) {
		if ( window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) {
			return;
		}
		var rect = host.getBoundingClientRect();
		var w = rect.width;
		var h = rect.height;
		if ( w === 0 || h === 0 ) {
			return;
		}

		var canvas = document.createElement( 'canvas' );
		canvas.style.position      = 'absolute';
		canvas.style.inset         = '0';
		canvas.style.width         = '100%';
		canvas.style.height        = '100%';
		canvas.style.pointerEvents = 'none';
		canvas.style.zIndex        = '999999';
		canvas.setAttribute( 'aria-hidden', 'true' );

		var dpr = window.devicePixelRatio || 1;
		canvas.width  = Math.floor( w * dpr );
		canvas.height = Math.floor( h * dpr );

		host.appendChild( canvas );
		var ctx = canvas.getContext( '2d' );
		ctx.scale( dpr, dpr );

		var particles = [];
		var COUNT = 36;
		var originX = w / 2;
		var originY = 24; // mid-titlebar
		for ( var i = 0; i < COUNT; i++ ) {
			var angle = ( -Math.PI / 2 ) + ( Math.random() - 0.5 ) * Math.PI; // upward fan
			var speed = 4 + Math.random() * 6;
			particles.push( {
				x:    originX + ( Math.random() - 0.5 ) * w * 0.6,
				y:    originY,
				vx:   Math.cos( angle ) * speed,
				vy:   Math.sin( angle ) * speed,
				size: 6 + Math.random() * 6,
				color: POP_COLORS[ Math.floor( Math.random() * POP_COLORS.length ) ],
				shape: Math.floor( Math.random() * 3 ), // 0=square 1=circle 2=triangle
				rot:  Math.random() * Math.PI * 2,
				vrot: ( Math.random() - 0.5 ) * 0.4,
				life: 1,
			} );
		}

		var GRAVITY  = 0.22;
		var FRICTION = 0.985;
		var FADE     = 0.012;
		var raf;
		var alive = true;

		function step() {
			if ( ! alive ) {
				return;
			}
			ctx.clearRect( 0, 0, w, h );
			var anyAlive = false;
			for ( var j = 0; j < particles.length; j++ ) {
				var p = particles[ j ];
				if ( p.life <= 0 ) {
					continue;
				}
				p.vx *= FRICTION;
				p.vy = p.vy * FRICTION + GRAVITY;
				p.x  += p.vx;
				p.y  += p.vy;
				p.rot += p.vrot;
				p.life -= FADE;
				if ( p.life <= 0 || p.y > h + 20 ) {
					p.life = 0;
					continue;
				}
				anyAlive = true;
				ctx.save();
				ctx.globalAlpha = Math.max( 0, p.life );
				ctx.translate( p.x, p.y );
				ctx.rotate( p.rot );
				ctx.fillStyle   = p.color;
				ctx.strokeStyle = '#0a0a0a';
				ctx.lineWidth   = 1.5;
				if ( p.shape === 0 ) {
					ctx.fillRect( -p.size / 2, -p.size / 2, p.size, p.size );
					ctx.strokeRect( -p.size / 2, -p.size / 2, p.size, p.size );
				} else if ( p.shape === 1 ) {
					ctx.beginPath();
					ctx.arc( 0, 0, p.size / 2, 0, Math.PI * 2 );
					ctx.fill();
					ctx.stroke();
				} else {
					ctx.beginPath();
					ctx.moveTo( 0, -p.size / 2 );
					ctx.lineTo( p.size / 2, p.size / 2 );
					ctx.lineTo( -p.size / 2, p.size / 2 );
					ctx.closePath();
					ctx.fill();
					ctx.stroke();
				}
				ctx.restore();
			}
			if ( ! anyAlive ) {
				cleanup();
				return;
			}
			raf = window.requestAnimationFrame( step );
		}

		function cleanup() {
			alive = false;
			if ( raf ) {
				window.cancelAnimationFrame( raf );
			}
			canvas.remove();
		}

		raf = window.requestAnimationFrame( step );
		// Hard cap — defensive cleanup if rAF stalls.
		window.setTimeout( cleanup, 4000 );

		return cleanup;
	}

	var ZAPS = [ 'POW!', 'BAM!', 'ZAP!', 'BOOM!', 'WHAM!', 'KAPOW!', 'ZONK!', 'WHOOSH!', 'SLAM!', 'CRASH!', 'THWACK!', 'ZOWIE!' ];
	function hash( seed ) {
		var n = 0;
		for ( var i = 0; i < seed.length; i++ ) {
			n = ( n * 31 + seed.charCodeAt( i ) ) >>> 0;
		}
		return n;
	}
	// Three different words per window, no duplicates.
	function pickThreeZaps( seed ) {
		var h = hash( seed );
		var pool = ZAPS.slice();
		var out = [];
		for ( var k = 0; k < 3; k++ ) {
			var idx = h % pool.length;
			out.push( pool.splice( idx, 1 )[ 0 ] );
			h = ( h * 1103515245 + 12345 ) >>> 0;
		}
		return out;
	}

	function makeBtn( variant, label, onClick, glyph ) {
		var btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.className = 'wpd-pop__btn wpd-pop__btn--' + variant;
		btn.setAttribute( 'aria-label', label );
		btn.textContent = glyph;
		btn.addEventListener( 'mousedown',  function ( e ) { e.stopPropagation(); } );
		btn.addEventListener( 'pointerdown', function ( e ) { e.stopPropagation(); } );
		btn.addEventListener( 'click', function ( e ) {
			e.stopPropagation();
			onClick();
		} );
		return btn;
	}

	wp.desktop.whenReady( function () {
		injectStylesOnce();

		wp.hooks.addFilter(
			'wp-desktop.window.chrome.render',
			'alcazaba-pop/force-comic',
			function ( chromeId ) {
				if ( ! chromeId || chromeId === 'core/standard' ) {
					return 'alcazaba-pop/comic';
				}
				return chromeId;
			}
		);

		wp.desktop.registerWindowChrome( {
			id:    'alcazaba-pop/comic',
			label: 'POP — Comic',
			match: function () { return true; },
			owner: 'alcazaba-pop-chrome',
			render: function ( host, ctx ) {
				host.classList.add( 'wpd-pop' );

				var titleBar = host.querySelector( '.wp-desktop-window__titlebar' );
				if ( ! titleBar ) {
					return { destroy: function () {} };
				}

				while ( titleBar.firstChild ) {
					titleBar.removeChild( titleBar.firstChild );
				}
				titleBar.classList.add( 'wpd-pop__bar' );

				var lights = document.createElement( 'div' );
				lights.className = 'wpd-pop__lights';
				lights.appendChild( makeBtn( 'close',    'Close',    function () { ctx.window.close(); },    '×' ) );
				lights.appendChild( makeBtn( 'minimize', 'Minimize', function () { ctx.window.minimize(); }, '–' ) );
				lights.appendChild( makeBtn( 'maximize', 'Maximize', function () { ctx.window.maximize(); }, '+' ) );

				var title = document.createElement( 'span' );
				title.id          = 'wp-window-title-' + ctx.window.id;
				title.className   = 'wpd-pop__title';
				title.textContent = ctx.state.title || '';

				var star = document.createElement( 'span' );
				star.className = 'wpd-pop__star';
				star.textContent = '★';
				star.setAttribute( 'aria-hidden', 'true' );

				titleBar.appendChild( lights );
				titleBar.appendChild( title );
				titleBar.appendChild( star );

				// Sibling decorations on the window host — they sit
				// OUTSIDE the title bar's overflow:hidden box so they
				// can hang past the window's edges.
				var words = pickThreeZaps( ctx.window.id );
				var zaps  = [];
				[ 'tl', 'bl', 'br' ].forEach( function ( pos, i ) {
					var z = document.createElement( 'div' );
					z.className = 'wpd-pop__zap wpd-pop__zap--' + pos;
					z.setAttribute( 'aria-hidden', 'true' );
					z.textContent = words[ i ];
					host.appendChild( z );
					zaps.push( z );
				} );

				// One-shot welcome burst. Track on the host so chrome
				// remounts (registry mutations, focus repaints) don't
				// re-trigger it.
				var cancelBurst = null;
				if ( ! host.dataset.popBursted ) {
					host.dataset.popBursted = '1';
					// Defer one frame so the host has been laid out
					// and getBoundingClientRect() returns real numbers.
					window.requestAnimationFrame( function () {
						cancelBurst = burstConfetti( host );
					} );
				}

				return {
					update: function ( state ) {
						if ( typeof state.title === 'string' ) {
							title.textContent = state.title;
						}
					},
					destroy: function () {
						host.classList.remove( 'wpd-pop' );
						titleBar.classList.remove( 'wpd-pop__bar' );
						zaps.forEach( function ( z ) { z.remove(); } );
						if ( cancelBurst ) { cancelBurst(); }
					},
				};
			},
		} );
	} );
}( window.wp ) );
