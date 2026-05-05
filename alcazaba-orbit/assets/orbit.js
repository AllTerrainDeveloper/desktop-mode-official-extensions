/**
 * Alcazaba Orbit Dock — circular ring rail renderer.
 *
 * Registers a single dock-customization surface against the registries
 * shipped in desktop-mode 0.18.0:
 *
 *   registerDockRailRenderer( 'alcazaba-orbit' ) — owns the rail entirely.
 *   Items orbit a glowing pulsar at the center of the desktop. A canvas
 *   starfield + per-tile particle trails render below the tiles. Submenu
 *   items appear as satellites orbiting the hovered tile (hover-to-orbit,
 *   our own UI — independent of any framework submenu surface).
 *
 * No decoration filter is registered: when the user selects a different
 * rail in OS Settings → Dock rail, this plugin should be entirely inert.
 * The framework currently has no public way to gate a decoration hook on
 * "am I the active renderer" (filed as a DX report) — until that lands,
 * cross-renderer decoration is opt-out by simply not registering the hook.
 *
 * No build step — vanilla JS, IIFE, no dependencies beyond `wp.desktop`,
 * `wp.hooks`. The renderer carries `owner: 'alcazaba-orbit'` so
 * deactivating this plugin sweeps the registration without a reload.
 */
( function () {
	'use strict';

	if ( ! window.wp || ! wp.desktop ) {
		return;
	}

	const OWNER = 'alcazaba-orbit';

	// Self-inject the orbit stylesheet so live-load works.
	//
	// Our PHP enqueues `assets/orbit.css` via `wp_enqueue_style` on
	// `admin_enqueue_scripts`, but that only fires on the page that
	// rendered the shell. When desktop-mode's server-sync injects
	// THIS script via `loadVendorScript` after a plugin activation,
	// the parent shell never receives the stylesheet — only the
	// JS. Without the stylesheet, `.alcazaba-orbit` renders with
	// default browser CSS (no fixed positioning, no z-index), the
	// overlay flows inline, and the dock rails sit hidden behind
	// nothing visible.
	//
	// Derive the CSS URL from our own script's `src` so it works
	// regardless of plugin install path. Idempotent — if a `<link>`
	// pointing at orbit.css already exists (full page load case
	// where PHP enqueue worked), skip.
	( function injectOrbitStylesheet() {
		const already = [ ...document.styleSheets, ...document.querySelectorAll( 'link[rel="stylesheet"]' ) ]
			.some( ( s ) => {
				const href = ( s instanceof Element ? s.getAttribute( 'href' ) : s.href ) || '';
				return /alcazaba-orbit\/assets\/orbit\.css/.test( href );
			} );
		if ( already ) {
			return;
		}
		const scriptEl = document.currentScript
			|| [ ...document.scripts ].reverse().find( ( s ) => /alcazaba-orbit\/assets\/orbit\.js/.test( s.src ) );
		if ( ! scriptEl || ! scriptEl.src ) {
			return;
		}
		const cssUrl = scriptEl.src.replace( /orbit\.js(\?.*)?$/, 'orbit.css$1' );
		const link = document.createElement( 'link' );
		link.rel = 'stylesheet';
		link.href = cssUrl;
		link.setAttribute( 'data-alcazaba-orbit-injected', '1' );
		document.head.appendChild( link );
	} )();

	// Module-level flag tracking whether a primary mount currently
	// owns the orbit overlay. In multi-rail layouts (Classic) the
	// dispatcher calls the mount function twice in the same dispatch
	// pass — once per rail. The first mount becomes primary (creates
	// the overlay, runs the rAF loop, listens for resize); the second
	// becomes secondary (hides its container only, returns a no-op
	// controller). Tracked here, not via DOM probe, because a zombie
	// `.alcazaba-orbit` left by a botched destroy would otherwise make
	// EVERY subsequent mount take the secondary path.
	//
	// MUST be declared BEFORE `bootstrap()` runs — `bootstrap` triggers
	// `registerDockRailRenderer`, whose synchronous notify cascade
	// invokes `mountOrbitRail` immediately when the user's pick already
	// resolves to us. If this `let` is below the bootstrap call, it's
	// in the Temporal Dead Zone at mount time and reads throw
	// `ReferenceError: Cannot access 'primaryMountActive' before initialization`.
	let primaryMountActive = false;

	// Bootstrap. This script may load at three different times:
	//
	//  1. As a normal page asset on full shell render — `wp-desktop-init`
	//     hasn't fired yet, queue via `wp.desktop.ready`.
	//  2. Synchronously injected by server-sync after a plugin
	//     activation while the shell is already booted —
	//     `wp-desktop-init` fired LONG ago, so a `document.addEventListener`
	//     listener attached now will never fire. We must use
	//     `wp.desktop.ready`, which the framework guarantees fires the
	//     callback synchronously (via microtask) when the shell is
	//     already ready.
	//  3. Older shells that only expose the CustomEvent — fall back to
	//     the listener.
	//
	// IMPORTANT: don't capture `wp.desktop.ready` into a local
	// (`const ready = wp.desktop.ready`) — that loses the receiver
	// context. Call through `wp.desktop` so `this` is correct.
	function bootstrap() {
		registerOrbitRail();
	}

	if ( wp.desktop.isReady && wp.desktop.isReady() ) {
		// Shell already booted (typical live-load case). Run now.
		bootstrap();
	} else if ( typeof wp.desktop.ready === 'function' ) {
		wp.desktop.ready( bootstrap );
	} else {
		document.addEventListener( 'wp-desktop-init', bootstrap, { once: true } );
	}

	// ── Dock rail renderer — the orbit ring + canvas particles ───────────────

	function registerOrbitRail() {
		if ( typeof wp.desktop.registerDockRailRenderer !== 'function' ) {
			return;
		}
		wp.desktop.registerDockRailRenderer( {
			id:          'alcazaba-orbit',
			label:       'Orbit Ring',
			description: 'Items orbit a glowing pulsar at the center of the desktop.',
			icon:        'dashicons-marker',
			owner:       OWNER,
			apiVersion:  1,
			mount:       mountOrbitRailSafe,
		} );
	}

	// Wrapper around `mountOrbitRail` that surfaces errors to the
	// console before the framework's mountRail try/catch swallows
	// them. Without this, a thrown mount triggers a silent fallback
	// to the default renderer mounting into our (already-hidden)
	// container — both rails go invisible with no clue why.
	function mountOrbitRailSafe( deps ) {
		try {
			return mountOrbitRail( deps );
		} catch ( err ) {
			console.error( '[alcazaba-orbit] mount failed:', err );
			// Reset the primary slot so the next dispatcher pass
			// gets a clean shot — without this, an early throw
			// during primary mount leaves `primaryMountActive=true`
			// forever and every subsequent mount bails to secondary.
			primaryMountActive = false;
			throw err;
		}
	}

	function mountOrbitRail( deps ) {
		const { container, items, fullMenu, fullSystemTiles, openItem, openSubmenuPick, openSystemItem } = deps;

		// The dock host owns its own stacking context that sits ABOVE
		// open windows — so painting the orbit into it would cover them.
		// Instead: hide the dock host entirely and mount the overlay
		// on document.body, which sits behind windows by z-index.
		container.innerHTML = '';
		const prevDisplay = container.style.display;
		container.style.display = 'none';

		// Multi-rail layouts (Classic) call our mount TWICE — once for
		// the side rail with `core` items, once for the bottom rail with
		// `plugin` items. We only want ONE orbit overlay; the first
		// mount becomes primary (creates the overlay, paints from
		// `deps.fullMenu` which already spans every rail), the second
		// is secondary (hides its container, returns a no-op
		// controller). Module-level `primaryMountActive` is the source
		// of truth — DOM probes are unreliable because a zombie
		// overlay from a botched destroy would make EVERY mount take
		// the secondary path.
		if ( primaryMountActive ) {
			return {
				replaceItems() {},
				appendSystemItem() {},
				removeSystemItem() {},
				setBadge() {},
				setAttention() {},
				destroy() {
					container.style.display = prevDisplay;
					container.innerHTML = '';
				},
			};
		}
		primaryMountActive = true;

		// Defensive zombie sweep on the primary path: if a previous
		// mount errored mid-build or its destroy() didn't run cleanly,
		// there could be a leftover `.alcazaba-orbit` overlay floating
		// in the DOM. We're about to create the canonical one — drop
		// any stale ones first so we never end up with two suns.
		document.querySelectorAll( '.alcazaba-orbit' ).forEach( ( el ) => el.remove() );

		// Mount directly on document.body so the overlay isn't trapped
		// inside a parent stacking context that flips it behind windows
		// or steals pointer events. We control z-index via CSS to sit
		// above the wallpaper and below windows.
		const overlay = document.createElement( 'div' );
		overlay.className = 'alcazaba-orbit';
		document.body.appendChild( overlay );

		// Layer 1 — particle canvas (behind tiles).
		const canvas = document.createElement( 'canvas' );
		canvas.className = 'alcazaba-orbit__canvas';
		overlay.appendChild( canvas );
		const ctx = canvas.getContext( '2d' );

		// Layer 2 — DOM stage with the pulsar core, ring, tiles.
		const stage = document.createElement( 'div' );
		stage.className = 'alcazaba-orbit__stage';
		overlay.appendChild( stage );

		const ringInner = document.createElement( 'div' );
		ringInner.className = 'alcazaba-orbit__ring alcazaba-orbit__ring--inner';
		stage.appendChild( ringInner );

		const ringOuter = document.createElement( 'div' );
		ringOuter.className = 'alcazaba-orbit__ring alcazaba-orbit__ring--outer';
		stage.appendChild( ringOuter );

		// The pulsar is two nested elements: outer for positioning
		// (translate corner ↔ center), inner for the breathing scale
		// animation. Splitting them avoids the classic CSS pitfall of
		// a keyframe `transform` clobbering the declared positional
		// `transform`, which made the sun snap or refuse to reach the
		// corner cleanly.
		const core = document.createElement( 'button' );
		core.type = 'button';
		core.className = 'alcazaba-orbit__core';
		core.title = 'Show desktop';
		core.setAttribute( 'aria-label', 'Pulsar — show desktop' );
		const coreGlow = document.createElement( 'span' );
		coreGlow.className = 'alcazaba-orbit__core-glow';
		coreGlow.setAttribute( 'aria-hidden', 'true' );
		core.appendChild( coreGlow );
		stage.appendChild( core );

		// Resolve the *complete* menu set, regardless of which rail
		// our renderer is mounted into. Classic layout splits the
		// menu across two rails (side = core, bottom = plugins) and a
		// rail renderer only owns one of them. The shell now exposes
		// `deps.fullMenu` — the full menu in every layout, with
		// populated submenu arrays — so we prefer it. Fall back to
		// merging `items` with `wp.desktop.getMenuItems()` for older
		// shells that pre-date the `fullMenu` field.
		function fullMenuSet( railItems ) {
			if ( Array.isArray( fullMenu ) && fullMenu.length ) {
				return fullMenu;
			}
			const seen = new Map();
			const apiItems = ( wp.desktop && typeof wp.desktop.getMenuItems === 'function' )
				? wp.desktop.getMenuItems()
				: [];
			for ( const it of apiItems ) {
				if ( it && it.id ) seen.set( it.id, it );
			}
			for ( const it of ( railItems || [] ) ) {
				if ( it && it.id && ! seen.has( it.id ) ) seen.set( it.id, it );
			}
			return [ ...seen.values() ];
		}

		let menuItems  = fullMenuSet( items );
		// Initial system-tile snapshot now arrives in mount-deps via
		// `fullSystemTiles` (added after our DX report, item #1).
		// Live additions/removals still come through the
		// `appendSystemItem` / `removeSystemItem` controller methods.
		const systemItems = Array.isArray( fullSystemTiles )
			? fullSystemTiles.slice()
			: [];
		// Two concentric orbits: inner for `isCore` admin items, outer
		// for plugin / third-party items + system tiles. The user reads
		// the layered geometry as "first-class admin near the center,
		// satellites further out" — same mental model as a solar system.
		let radiusInner = 180;
		let radiusOuter = 320;
		let angleBase  = -Math.PI / 2; // first tile due north of the core
		let lastTs     = 0;
		let dpr        = window.devicePixelRatio || 1;
		const stars    = [];
		const trails   = []; // particle trails behind tiles
		const tileEls  = new Map(); // id -> { el, kind }
		let rafId      = 0;
		let destroyed  = false;

		// Resize / DPR handling for the canvas + dynamic radius.
		// We size off the viewport directly — the overlay covers the
		// viewport exactly, but reading it via window.* skips a layout
		// roundtrip and keeps things robust during the initial mount
		// before the overlay's box has settled.
		function resize() {
			const w = window.innerWidth;
			const h = window.innerHeight;
			dpr = window.devicePixelRatio || 1;
			canvas.width  = Math.max( 1, Math.floor( w * dpr ) );
			canvas.height = Math.max( 1, Math.floor( h * dpr ) );
			canvas.style.width  = w + 'px';
			canvas.style.height = h + 'px';
			ctx.setTransform( dpr, 0, 0, dpr, 0, 0 );
			// Two orbits — inner for core admin items, outer for plugins.
			// Outer scales with viewport (capped); inner is a fixed step
			// inward so the visual hierarchy reads cleanly regardless of
			// screen size.
			radiusOuter = Math.max( 240, Math.min( 420, Math.min( w, h ) * 0.34 ) );
			radiusInner = Math.max( 140, radiusOuter - 110 );
			ringInner.style.width  = ( radiusInner * 2 ) + 'px';
			ringInner.style.height = ( radiusInner * 2 ) + 'px';
			ringOuter.style.width  = ( radiusOuter * 2 ) + 'px';
			ringOuter.style.height = ( radiusOuter * 2 ) + 'px';
			seedStars( w, h );
		}

		const ro = new ResizeObserver( resize );
		ro.observe( overlay );
		window.addEventListener( 'resize', resize );

		function seedStars( w, h ) {
			stars.length = 0;
			const count = Math.min( 220, Math.floor( ( w * h ) / 9000 ) );
			for ( let i = 0; i < count; i++ ) {
				stars.push( {
					x: Math.random() * w,
					y: Math.random() * h,
					r: Math.random() * 1.4 + 0.2,
					tw: Math.random() * Math.PI * 2,
					ts: 0.0008 + Math.random() * 0.002,
				} );
			}
		}

		// Two-state machine for the orbit. When `expanded` the sun
		// occupies center stage and tiles populate the rings. When
		// collapsed, only the sun is visible, anchored in the corner.
		// Clicking the sun toggles state — and on the way in we
		// minimize every open window so the orbit gets the screen, and
		// on the way out we restore them so the user picks up where
		// they left off. The shell now ships first-class show-desktop
		// primitives (`minimizeAll` / `restoreFrom`) so we can hand
		// the windowing concern entirely to the window manager.
		let expanded = false;
		let minimizedRefs = []; // returned by minimizeAll() — passed back to restoreFrom()

		function setExpanded( next, opts ) {
			if ( next === expanded ) {
				return;
			}
			expanded = next;
			overlay.classList.toggle( 'is-expanded', expanded );
			overlay.classList.toggle( 'is-collapsed', ! expanded );
			closeSatellites();
			const wm = wp.desktop.windowManager;
			if ( expanded ) {
				// `minimizeAll()` returns the windows it actually
				// minimized (excludes those already minimized) — we
				// hold the array so a later `restoreFrom()` only
				// touches windows we put under, leaving the user's
				// pre-existing minimized stack alone.
				minimizedRefs = ( wm && typeof wm.minimizeAll === 'function' )
					? wm.minimizeAll()
					: [];
				computeSlots();
				requestAnimationFrame( () => applyTileTransforms( 'expanded' ) );
				const c = corner();
				burst( c.x, c.y, 60, 'rgba( 255, 220, 140, 1 )' );
				setTimeout( () => burst( window.innerWidth / 2, window.innerHeight / 2, 100, 'rgba( 255, 220, 140, 1 )' ), 320 );
			} else {
				computeSlots();
				requestAnimationFrame( () => applyTileTransforms( 'collapsed' ) );
				if ( ( ! opts || opts.restore !== false ) && wm && typeof wm.restoreFrom === 'function' ) {
					wm.restoreFrom( minimizedRefs );
				}
				minimizedRefs = [];
			}
		}

		core.addEventListener( 'click', () => setExpanded( ! expanded ) );

		// Register our overlay as "inside the dock" so other plugins'
		// click-outside-to-dismiss handlers don't fire when the user
		// clicks our orbit, and our own handler below can use the
		// canonical `isDockElement` helper instead of grepping class
		// names.
		const unregisterDockSelector = ( typeof wp.desktop.registerDockSelector === 'function' )
			? wp.desktop.registerDockSelector( '.alcazaba-orbit' )
			: () => undefined;

		const onDocClick = ( e ) => {
			if ( ! expanded ) {
				return;
			}
			if ( typeof wp.desktop.isDockElement === 'function' && wp.desktop.isDockElement( e.target ) ) {
				return;
			}
			setExpanded( false, { restore: true } );
		};
		document.addEventListener( 'click', onDocClick, true );

		function corner() {
			// Pulsar's resting position when collapsed: bottom-left.
			// 64px from each edge keeps it clear of the taskbar but
			// inside the safe-area for typical shells.
			return { x: 72, y: window.innerHeight - 72 };
		}

		function center() {
			const rect = overlay.getBoundingClientRect();
			return { x: rect.width / 2, y: rect.height / 2 };
		}

		function totalCount() {
			return menuItems.length + systemItems.length;
		}

		// Items with real submenus go on the OUTER ring; leaf items
		// land on the INNER ring. Per the documented `DockItem`
		// invariant in `docs/javascript-reference.md`, the shell
		// strips WP's auto-prepended self-link entry server-side, so
		// `submenu.length > 0` reliably means real children.
		function hasSubmenu( item ) {
			return Array.isArray( item.submenu ) && item.submenu.length > 0;
		}

		function buildTiles() {
			// Remove old tiles, keep canvas + stage scaffolding.
			tileEls.forEach( ( rec ) => rec.el.remove() );
			tileEls.clear();
			closeSatellites();

			// Items with submenus land on the OUTER ring (room for the
			// satellite columns); leaf items go on the INNER ring next
			// to the pulsar. System tiles (OS Settings, Chat, Cron,
			// recycle bin, plugin-registered native windows) follow
			// the same predicate — almost all are leaf apps with no
			// submenu, so they belong on the inner ring alongside
			// Comments, not pinned to the outer.
			const innerMenu  = menuItems.filter( ( it ) => ! hasSubmenu( it ) );
			const outerMenu  = menuItems.filter( hasSubmenu );
			const innerSys   = systemItems.filter( ( it ) => ! hasSubmenu( it ) );
			const outerSys   = systemItems.filter( hasSubmenu );

			innerMenu.forEach( ( item, i ) => {
				const el = createTile( item, false, i );
				el.dataset.ring = 'inner';
				stage.appendChild( el );
				tileEls.set( 'menu:' + item.id, { el, kind: 'menu', item, ring: 'inner', index: i } );
			} );
			innerSys.forEach( ( item, i ) => {
				const el = createTile( item, true, i );
				el.dataset.ring = 'inner';
				stage.appendChild( el );
				tileEls.set( 'system:' + item.id, { el, kind: 'system', item, ring: 'inner', index: innerMenu.length + i } );
			} );
			outerMenu.forEach( ( item, i ) => {
				const el = createTile( item, false, i );
				el.dataset.ring = 'outer';
				stage.appendChild( el );
				tileEls.set( 'menu:' + item.id, { el, kind: 'menu', item, ring: 'outer', index: i } );
			} );
			outerSys.forEach( ( item, i ) => {
				const el = createTile( item, true, i );
				el.dataset.ring = 'outer';
				stage.appendChild( el );
				tileEls.set( 'system:' + item.id, { el, kind: 'system', item, ring: 'outer', index: outerMenu.length + i } );
			} );

			computeSlots();
			applyTileTransforms( expanded ? 'expanded' : 'collapsed' );
		}

		// Compute orbit slots + fresh random fly-in/out vectors for
		// every tile. Stores them on the rec — does NOT touch the DOM.
		// Apply happens separately via `applyTileTransforms`. Keeping
		// these two concerns apart means we can recompute slots
		// (e.g. after a viewport resize or a menu refresh) without
		// triggering a transition restart on tiles that were already
		// in flight.
		function computeSlots() {
			const w = window.innerWidth;
			const h = window.innerHeight;
			const diagonal = Math.hypot( w, h );

			let innerCount = 0;
			let outerCount = 0;
			tileEls.forEach( ( rec ) => {
				if ( rec.ring === 'inner' ) innerCount++; else outerCount++;
			} );
			let innerIdx = 0;
			let outerIdx = 0;

			tileEls.forEach( ( rec ) => {
				const onInner = rec.ring === 'inner';
				const ringRadius = onInner ? radiusInner : radiusOuter;
				const ringTotal  = Math.max( 1, onInner ? innerCount : outerCount );
				const ringIndex  = onInner ? innerIdx++ : outerIdx++;
				const angle = angleBase + ( ringIndex / ringTotal ) * Math.PI * 2;
				rec.x = Math.cos( angle ) * ringRadius;
				rec.y = Math.sin( angle ) * ringRadius;

				const ra = Math.random() * Math.PI * 2;
				const rd = diagonal * ( 0.7 + Math.random() * 0.6 );
				rec.rx = Math.cos( ra ) * rd;
				rec.ry = Math.sin( ra ) * rd;

				rec.el.style.transitionDelay = ( ( ringIndex % 12 ) * 28 ) + 'ms';
			} );
		}

		// Apply the transforms for the given state.
		//
		// MINIMAL VERSION: tiles always sit at their orbit position;
		// only opacity + scale change between expanded and collapsed.
		// This bypasses the complex fly-in-from-random-offstage
		// behavior so we can confirm the partition + ring placement
		// works at all. We can layer the fancy entrance back on top
		// once the basics are confirmed visible.
		function applyTileTransforms( state /* 'expanded' | 'collapsed' */ ) {
			const isExpanded = state === 'expanded';
			tileEls.forEach( ( rec ) => {
				const s = isExpanded ? 1 : 0.5;
				rec.el.style.transform = 'translate( ' + rec.x + 'px, ' + rec.y + 'px ) scale( ' + s + ' )';
				rec.baseTransform = 'translate( ' + rec.x + 'px, ' + rec.y + 'px )';
			} );
		}

		function createTile( item, isSystem, _index ) {
			const btn = document.createElement( 'button' );
			btn.type = 'button';
			// Run registered decoration filters (`wp-desktop.dock.tile-class`)
			// against our base classes so plugins that ship tile-class
			// hooks compose with the orbit, not just with the default
			// rail. Falls through if the helper isn't available.
			const baseClasses = [ 'alcazaba-orbit__tile' ];
			if ( isSystem ) {
				baseClasses.push( 'alcazaba-orbit__tile--system' );
			}
			btn.className = ( typeof wp.desktop.applyTileClasses === 'function' )
				? wp.desktop.applyTileClasses( baseClasses, item, {
					isSystem: !! isSystem,
					dockId: 'alcazaba-orbit',
					orientation: 'bottom',
					container: stage,
				} ).join( ' ' )
				: baseClasses.join( ' ' );
			btn.title = item.title || '';
			btn.setAttribute( 'aria-label', item.title || '' );
			if ( isSystem ) {
				btn.dataset.systemId = item.id;
			} else {
				btn.dataset.menuSlug = item.id;
			}

			// Single canonical icon dispatcher — handles dashicons, SVG
			// data URIs, image URLs, and the letter-badge fallback.
			const icon = item.icon || 'dashicons-admin-generic';
			if ( typeof wp.desktop.renderIcon === 'function' ) {
				btn.appendChild( wp.desktop.renderIcon( icon, {
					title: item.title || '',
				} ) );
			} else {
				btn.textContent = ( item.title || '?' ).slice( 0, 2 );
			}

			if ( item.badge && item.badge > 0 ) {
				const b = document.createElement( 'span' );
				b.className = 'alcazaba-orbit__badge';
				b.textContent = item.badge > 99 ? '99+' : String( item.badge );
				btn.appendChild( b );
			}

			btn.addEventListener( 'click', () => {
				const p = tilePos( btn );
				burst( p.x, p.y, 26, 'rgba( 255, 196, 96, 1 )' );
				// Collapse + restore FIRST so the previously-minimized
				// windows fan back up, THEN open/focus the user's
				// pick. If we opened first, the trailing restore loop
				// would focus the last-restored window and bury the
				// one the user just clicked.
				setExpanded( false, { restore: true } );
				if ( isSystem ) {
					if ( typeof openSystemItem === 'function' ) {
						openSystemItem( item );
					} else if ( typeof item.onOpen === 'function' ) {
						item.onOpen();
					}
				} else {
					openItem( item );
				}
			} );

			// Hover-to-orbit submenu — submenu items appear as
			// satellites orbiting the hovered tile. The satellites are
			// pointer-event hot and re-arm the close timer when they
			// themselves are hovered, so the path from tile → satellite
			// stays warm. Hover also scales the tile up by re-applying
			// the base transform with a 1.25 scale.
			btn.addEventListener( 'mouseenter', () => {
				openSatellites( btn, item, isSystem );
				const rec = tileEls.get( ( isSystem ? 'system:' : 'menu:' ) + item.id );
				if ( rec && expanded && rec.baseTransform ) {
					rec.el.style.transform = rec.baseTransform + ' scale( 1.25 )';
				}
			} );
			btn.addEventListener( 'mouseleave', () => {
				scheduleCloseSatellites();
				const rec = tileEls.get( ( isSystem ? 'system:' : 'menu:' ) + item.id );
				if ( rec && expanded && rec.baseTransform ) {
					rec.el.style.transform = rec.baseTransform + ' scale( 1 )';
				}
			} );

			return btn;
		}

		function tilePos( el ) {
			const cRect = overlay.getBoundingClientRect();
			const r = el.getBoundingClientRect();
			return { x: r.left - cRect.left + r.width / 2, y: r.top - cRect.top + r.height / 2 };
		}

		// ── Hover-to-orbit submenu (satellites) ───────────────────────────
		//
		// Submenu items render along the radial line from the sun
		// through the parent tile and continuing outward — like
		// planets on the same orbital arm, each one a stop further
		// out. Spacing is angle-aware so axis-aligned pills don't
		// overlap when the radial line is near-horizontal: we project
		// the pill's bounding box onto the radial axis and step the
		// next pill past that projection plus a gap.

		const SAT_PILL_HALF_W = 90;  // half max pill width  (180px max)
		const SAT_PILL_HALF_H = 15;  // half pill height     (30px)
		const SAT_TILE_RADIUS = 28;  // tile radius
		const SAT_FIRST_GAP   = 18;  // gap from tile edge to first pill
		const SAT_GAP         = 14;  // gap between pills
		let activeSatellites = [];
		let activeAnchorId = null;
		let closeTimer = 0;

		function openSatellites( anchorEl, item, isSystem ) {
			if ( ! expanded ) {
				return; // collapsed mode — tiles aren't really visible
			}
			window.clearTimeout( closeTimer );
			closeTimer = 0;
			const anchorId = ( isSystem ? 'system:' : 'menu:' ) + item.id;
			if ( activeAnchorId === anchorId ) {
				return; // already open for this tile
			}
			closeSatellites();
			const submenu = Array.isArray( item.submenu ) ? item.submenu : [];
			if ( ! submenu.length ) {
				return;
			}
			activeAnchorId = anchorId;

			// Tile center inside the overlay coordinate system. The
			// stage is inset:0 over the overlay (viewport-sized) and
			// each tile is translated from the stage center by
			// (rec.x, rec.y). We read those values from the tile's
			// record rather than parsing the inline transform — same
			// source of truth that draws the tile.
			const cx = window.innerWidth  / 2;
			const cy = window.innerHeight / 2;
			const recAnchor = tileEls.get( anchorId );
			const ax = cx + ( recAnchor ? recAnchor.x : 0 );
			const ay = cy + ( recAnchor ? recAnchor.y : 0 );

			// Radial direction from the sun through this tile. The
			// pill column extends along this axis, starting just past
			// the tile and stepping outward.
			const angle = Math.atan2( ay - cy, ax - cx );
			const dx = Math.cos( angle );
			const dy = Math.sin( angle );

			// Submenu items orbit the hovered tile in their own little
			// satellite ring. We constrain the fan to the OUTWARD half
			// (away from the sun) so pills never wrap behind the parent
			// and collide with neighbor tiles on the same ring or with
			// the inner-ring tiles. Radius scales with item count so
			// dense submenus push further out and stay readable.
			const SAT_ORBIT_RADIUS = Math.max( 95, Math.min( 200, 75 + submenu.length * 14 ) );
			const arc = submenu.length === 1 ? 0 : Math.PI * 0.6;
			const arcStart = angle - arc / 2;

			submenu.forEach( ( sub, idx ) => {
				const t = submenu.length === 1 ? 0.5 : idx / ( submenu.length - 1 );
				const subAngle = submenu.length === 1 ? angle : arcStart + t * arc;
				const sx = ax + Math.cos( subAngle ) * SAT_ORBIT_RADIUS;
				const sy = ay + Math.sin( subAngle ) * SAT_ORBIT_RADIUS;

				const sat = document.createElement( 'button' );
				sat.type = 'button';
				sat.className = 'alcazaba-orbit__satellite';
				sat.title = sub.title || sub.label || '';
				sat.textContent = sub.title || sub.label || '';
				// Position via transform so the entrance animation can
				// interpolate from the parent tile's center (--ax/--ay)
				// to the pill's resolved radial position (--sx/--sy).
				sat.style.setProperty( '--sx', sx + 'px' );
				sat.style.setProperty( '--sy', sy + 'px' );
				sat.style.setProperty( '--ax', ax + 'px' );
				sat.style.setProperty( '--ay', ay + 'px' );
				// Stagger BOTH the transition (transform/opacity/filter)
				// and the keyframe afterglow flash, otherwise the flash
				// fires simultaneously on every pill while the pills
				// themselves cascade — looks out of sync.
				const delay = ( idx * 45 ) + 'ms';
				sat.style.transitionDelay = delay;
				sat.style.animationDelay = delay;

				sat.addEventListener( 'mouseenter', () => {
					window.clearTimeout( closeTimer );
					closeTimer = 0;
				} );
				sat.addEventListener( 'mouseleave', () => scheduleCloseSatellites() );
				sat.addEventListener( 'click', ( e ) => {
					e.stopPropagation();
					closeSatellites();
					// Restore others first, then open the pick — same
					// reason as the tile-click handler above.
					setExpanded( false, { restore: true } );
					pickSubmenu( item, sub );
				} );

				stage.appendChild( sat );
				activeSatellites.push( sat );
				// Force a synchronous layout flush so the browser
				// commits the closed-state transform (collapsed at
				// the parent tile, scaled, rotated, blurred) BEFORE
				// we toggle `is-open`. Without this, a fast hover
				// from one tile to another (close → re-open in the
				// same frame budget) can let the browser optimize
				// away the "before" state and the pill snaps to its
				// final position instead of springing out from the
				// parent. A single requestAnimationFrame is not
				// enough — rAF fires before paint, after the style
				// recalc, but the browser may still coalesce the
				// fresh element's initial style with the next class
				// change.
				//
				// Reading `offsetWidth` is the canonical "force
				// reflow" trick — cheap (one layout per pill, ≤10
				// per submenu) and absolutely reliable.
				void sat.offsetWidth;
				sat.classList.add( 'is-open' );
			} );
		}

		function scheduleCloseSatellites() {
			window.clearTimeout( closeTimer );
			closeTimer = window.setTimeout( closeSatellites, 220 );
		}

		function closeSatellites() {
			window.clearTimeout( closeTimer );
			closeTimer = 0;
			activeSatellites.forEach( ( s ) => s.remove() );
			activeSatellites = [];
			activeAnchorId = null;
		}

		function pickSubmenu( parent, sub ) {
			if ( typeof sub.onOpen === 'function' ) {
				sub.onOpen();
				return;
			}
			// `openSubmenuPick` routes through the same code path as
			// the default renderer: derives the id via the public
			// `deriveWindowId`, shares baseId with the parent,
			// propagates submenu into the in-window tab strip.
			if ( typeof openSubmenuPick === 'function' ) {
				openSubmenuPick( parent, sub );
			}
		}

		// ── Animation loop ────────────────────────────────────────────────

		function tick( ts ) {
			if ( destroyed ) {
				return;
			}
			if ( ! lastTs ) {
				lastTs = ts;
			}
			const dt = Math.min( 50, ts - lastTs );
			lastTs = ts;

			// Tiles are positioned imperatively (positionTiles), not in
			// the loop, so the tick body only paints the canvas now.
			// Emit a trickle of trail particles at the visible tiles
			// while expanded for ambient life.
			if ( expanded ) {
				const cxPx = window.innerWidth  / 2;
				const cyPx = window.innerHeight / 2;
				tileEls.forEach( ( rec ) => {
					if ( Math.random() < 0.06 ) {
						trails.push( {
							x: cxPx + rec.x,
							y: cyPx + rec.y,
							vx: ( Math.random() - 0.5 ) * 0.05,
							vy: ( Math.random() - 0.5 ) * 0.05,
							life: 700 + Math.random() * 600,
							age: 0,
							r: 1 + Math.random() * 1.6,
							hue: rec.kind === 'system' ? 270 : ( rec.ring === 'inner' ? 40 : 200 ),
						} );
					}
				} );
			}

			// Render canvas — starfield + trails.
			ctx.clearRect( 0, 0, window.innerWidth, window.innerHeight );

			// Stars.
			for ( let s = 0; s < stars.length; s++ ) {
				const star = stars[ s ];
				star.tw += star.ts * dt;
				const a = 0.35 + 0.45 * ( 0.5 + 0.5 * Math.sin( star.tw ) );
				ctx.globalAlpha = a;
				ctx.fillStyle = '#fff';
				ctx.beginPath();
				ctx.arc( star.x, star.y, star.r, 0, Math.PI * 2 );
				ctx.fill();
			}
			ctx.globalAlpha = 1;

			// Trails.
			for ( let t = trails.length - 1; t >= 0; t-- ) {
				const p = trails[ t ];
				p.age += dt;
				p.x += p.vx * dt;
				p.y += p.vy * dt;
				if ( p.age >= p.life ) {
					trails.splice( t, 1 );
					continue;
				}
				const a = 1 - p.age / p.life;
				ctx.globalAlpha = a * 0.85;
				ctx.fillStyle = 'hsl( ' + p.hue + ', 100%, ' + ( 60 + a * 20 ) + '% )';
				ctx.beginPath();
				ctx.arc( p.x, p.y, p.r, 0, Math.PI * 2 );
				ctx.fill();
			}
			ctx.globalAlpha = 1;

			// Cap trails to prevent unbounded growth on huge desktops.
			if ( trails.length > 1500 ) {
				trails.splice( 0, trails.length - 1500 );
			}

			rafId = requestAnimationFrame( tick );
		}

		function burst( x, y, count, color ) {
			for ( let i = 0; i < count; i++ ) {
				const a = Math.random() * Math.PI * 2;
				const sp = 0.15 + Math.random() * 0.4;
				trails.push( {
					x, y,
					vx: Math.cos( a ) * sp,
					vy: Math.sin( a ) * sp,
					life: 600 + Math.random() * 400,
					age: 0,
					r: 1.2 + Math.random() * 2,
					hue: color.indexOf( '220' ) > -1 ? 50 : 35,
				} );
			}
		}

		// (System tiles — including OS Settings, Cron, Chat, Recycle
		// Bin, plugin native windows — now arrive via `fullSystemTiles`
		// in mount-deps, regardless of rail affinity. The synthesized
		// OS Settings + DOM-scrape proxy that lived here previously is
		// no longer needed.)

		// Boot — start collapsed: sun in the bottom-left corner, no
		// ring, no tiles. The user clicks the sun to expand.
		overlay.classList.add( 'is-collapsed' );
		resize();
		buildTiles();
		rafId = requestAnimationFrame( tick );

		// ── Controller ────────────────────────────────────────────────────

		return {
			replaceItems( next ) {
				// Merge the rail-specific update with the full menu
				// from boot config so that a live refresh from one
				// rail still leaves the other rail's items in place.
				menuItems = fullMenuSet( next );
				buildTiles();
			},
			appendSystemItem( item ) {
				// Replace if already present (registration order is the API).
				const idx = systemItems.findIndex( ( x ) => x.id === item.id );
				if ( idx >= 0 ) {
					systemItems[ idx ] = item;
				} else {
					systemItems.push( item );
				}
				buildTiles();
			},
			removeSystemItem( id ) {
				const idx = systemItems.findIndex( ( x ) => x.id === id );
				if ( idx >= 0 ) {
					systemItems.splice( idx, 1 );
					buildTiles();
				}
			},
			setBadge( itemId, count ) {
				const rec = tileEls.get( 'menu:' + itemId ) || tileEls.get( 'system:' + itemId );
				if ( ! rec ) {
					return;
				}
				let badge = rec.el.querySelector( '.alcazaba-orbit__badge' );
				if ( ! count || count <= 0 ) {
					badge && badge.remove();
					return;
				}
				if ( ! badge ) {
					badge = document.createElement( 'span' );
					badge.className = 'alcazaba-orbit__badge';
					rec.el.appendChild( badge );
				}
				badge.textContent = count > 99 ? '99+' : String( count );
			},
			setAttention( itemId, mode ) {
				const rec = tileEls.get( 'menu:' + itemId ) || tileEls.get( 'system:' + itemId );
				if ( ! rec ) {
					return;
				}
				if ( mode && mode !== 'none' ) {
					const p = tilePos( rec.el );
					burst( p.x, p.y, 32, 'rgba( 255, 100, 100, 1 )' );
				}
			},
			destroy() {
				destroyed = true;
				cancelAnimationFrame( rafId );
				ro.disconnect();
				window.removeEventListener( 'resize', resize );
				closeSatellites();
				if ( expanded ) {
					const wm = wp.desktop.windowManager;
					if ( wm && typeof wm.restoreFrom === 'function' ) {
						wm.restoreFrom( minimizedRefs );
					}
					minimizedRefs = [];
				}
				document.removeEventListener( 'click', onDocClick, true );
				unregisterDockSelector();
				tileEls.forEach( ( rec ) => rec.el.remove() );
				tileEls.clear();
				overlay.remove();
				container.style.display = prevDisplay;
				container.innerHTML = '';
				// Release the primary slot so the next dispatcher pass
				// (renderer change, layout change, plugin reactivation)
				// can claim a fresh primary mount instead of wedging
				// every subsequent mount onto the secondary path.
				primaryMountActive = false;
			},
		};
	}
} )();
