/**
 * Alcazaba SQL Inspector — devtools dropdown + Query-Monitor-style
 * inspector window.
 *
 * Each row shows: time | type | component | rows | SQL (one line,
 * truncated). Click a row to slide up a bottom details panel with
 * full SQL, full caller backtrace, request URL, and every captured
 * field. Header strip aggregates total-queries / total-time / per-
 * type counts so you can see at a glance where the load went.
 *
 * Built on the wp-desktop-mode 0.20 devtools surface:
 *   - addRequestHeader (header tagging)
 *   - debug.startSession (session minting)
 *   - <wpd-log auto-row-height>, <wpd-badge>, <wpd-code copy>
 *
 * Polling goes through `wp.apiFetch` rather than the framework's
 * `subscribe()` — see prior DX gap reports for why.
 */
( function () {
	'use strict';

	var BUTTON_ID = 'alcazaba-sql-inspector-attach';
	var OWNER     = 'alcazaba-sql-inspector';
	// `wp_debug_session` is the framework default query-arg name
	// for `reloadWithDebugSession`; aligning with it keeps our
	// PHP-side fallback resolver compatible with any future
	// server-side support the framework adds.
	var QUERY_ARG = 'wp_debug_session';
	var POLL_MS   = 500;

	var ICON =
		'<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
			'<path d="M19 8h-1.81C16.62 7.04 15.85 6.25 14.92 5.71l1.65-1.66-1.41-1.41-2.04 2.04C12.74 4.6 12.38 4.5 12 4.5s-.74.1-1.12.18L8.84 2.64 7.43 4.05l1.65 1.66C8.16 6.25 7.39 7.04 6.81 8H5v2h1.09c-.05.33-.09.66-.09 1v1H5v2h1v1c0 .34.04.67.09 1H5v2h1.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H19v-2h-1.09c.05-.33.09-.66.09-1v-1h1v-2h-1v-1c0-.34-.04-.67-.09-1H19V8zm-6 8h-2v-2h2v2zm0-4h-2v-2h2v2z"/>' +
		'</svg>';

	// SQL type → badge color. Read paths green-ish, writes amber/
	// red, transactional grey. Picked for legibility on light bg.
	var TYPE_COLORS = {
		SELECT:   { bg: '#e8f5e9', fg: '#1b5e20' },
		SHOW:     { bg: '#e8f5e9', fg: '#1b5e20' },
		DESCRIBE: { bg: '#e8f5e9', fg: '#1b5e20' },
		EXPLAIN:  { bg: '#e8f5e9', fg: '#1b5e20' },
		INSERT:   { bg: '#fff3e0', fg: '#e65100' },
		UPDATE:   { bg: '#fff3e0', fg: '#e65100' },
		REPLACE:  { bg: '#fff3e0', fg: '#e65100' },
		DELETE:   { bg: '#ffebee', fg: '#b71c1c' },
		TRUNCATE: { bg: '#ffebee', fg: '#b71c1c' },
		DROP:     { bg: '#ffebee', fg: '#b71c1c' },
		ALTER:    { bg: '#fff3e0', fg: '#e65100' },
		CREATE:   { bg: '#e3f2fd', fg: '#0d47a1' },
		BEGIN:    { bg: '#f0f0f1', fg: '#646970' },
		COMMIT:   { bg: '#f0f0f1', fg: '#646970' },
		ROLLBACK: { bg: '#f0f0f1', fg: '#646970' },
		SET:      { bg: '#f0f0f1', fg: '#646970' },
		START:    { bg: '#f0f0f1', fg: '#646970' },
		OTHER:    { bg: '#f0f0f1', fg: '#646970' },
	};

	function ready( cb ) {
		if ( window.wp && wp.desktop && wp.desktop.windowManager ) {
			cb();
			return;
		}
		document.addEventListener( 'wp-desktop-init', cb, { once: true } );
	}

	function describeWindow( win ) {
		var cfg = ( win && win.config ) || {};
		return {
			title:    cfg.title || win.id,
			owner:    cfg.ownerHandle || ( cfg.url ? new URL( cfg.url, location.origin ).pathname : 'unknown' ),
			isIframe: !! win.iframe,
		};
	}

	function escapeHtml( s ) {
		return String( s ).replace( /[&<>"']/g, function ( c ) {
			return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ c ];
		} );
	}

	function shortUri( uri ) {
		if ( ! uri ) {
			return '';
		}
		try {
			var u = new URL( uri, location.origin );
			u.searchParams.delete( QUERY_ARG );
			var path = u.pathname.replace( /^\/wp-admin\//, '' ).replace( /^\/wp-json\//, '/' );
			var qs   = u.searchParams.toString();
			return qs ? path + '?' + qs : path;
		} catch ( _e ) {
			return String( uri );
		}
	}

	function fmtMs( seconds ) {
		var ms = ( seconds || 0 ) * 1000;
		if ( ms < 1 ) {
			return ms.toFixed( 2 ) + ' ms';
		}
		if ( ms < 100 ) {
			return ms.toFixed( 1 ) + ' ms';
		}
		return Math.round( ms ) + ' ms';
	}

	/**
	 * Fallback for wp-desktop-mode bundles older than 0.21 where
	 * `desktop.devtools.reloadWithDebugSession` doesn't exist yet.
	 * Implements the four-step boilerplate the new helper bundles:
	 *   1. addRequestHeader for fetch / XHR / sendBeacon
	 *   2. rewrite iframe.src to include the session as a query-arg
	 *      so document loads are captured
	 *   3. listen for the iframe's `load` event and re-push the
	 *      header so subsequent navigations stay instrumented
	 *   4. expose a single `dispose()` so the inspector's teardown
	 *      doesn't have to know which path was taken
	 *
	 * Drop this when 0.21+ is the minimum-supported framework.
	 */
	function manualAttachWithDebugSession( desktop, targetWin, session ) {
		var stopHdr = desktop.devtools.addRequestHeader( targetWin.id, 'X-WP-Debug-Session', session );
		var rePushOnReload = null;
		try {
			var ifr = targetWin.iframe;
			if ( ifr ) {
				rePushOnReload = function () {
					if ( stopHdr ) {
						try { stopHdr(); } catch ( _e ) {}
					}
					stopHdr = desktop.devtools.addRequestHeader( targetWin.id, 'X-WP-Debug-Session', session );
				};
				ifr.addEventListener( 'load', rePushOnReload );

				var current = ifr.contentWindow && ifr.contentWindow.location && ifr.contentWindow.location.href
					? ifr.contentWindow.location.href
					: ifr.src;
				var u = new URL( current, location.origin );
				u.searchParams.set( QUERY_ARG, session );
				ifr.src = u.toString();
			}
		} catch ( _e ) { /* same-origin or detached — header alone covers AJAX */ }

		return {
			dispose: function () {
				if ( stopHdr ) {
					try { stopHdr(); } catch ( _e ) {}
					stopHdr = null;
				}
				if ( rePushOnReload && targetWin.iframe ) {
					try { targetWin.iframe.removeEventListener( 'load', rePushOnReload ); } catch ( _e ) {}
					rePushOnReload = null;
				}
			},
		};
	}

	function typeBadge( type ) {
		var t = String( type || 'OTHER' ).toUpperCase();
		var c = TYPE_COLORS[ t ] || TYPE_COLORS.OTHER;
		return '<span style="background:' + c.bg + ';color:' + c.fg + ';padding:1px 6px;border-radius:3px;font-weight:600;flex-shrink:0;font-size:10px;letter-spacing:.3px;">' + escapeHtml( t ) + '</span>';
	}

	/**
	 * Open (or focus) the inspector window for `targetWin`.
	 */
	function openInspector( targetWin ) {
		var desktop      = wp.desktop;
		var INSPECTOR_ID = 'sql-inspector/' + targetWin.id;

		var existing = desktop.windowManager.getById( INSPECTOR_ID );
		if ( existing ) {
			desktop.windowManager.focus( existing );
			return existing;
		}

		var info     = describeWindow( targetWin );
		var session  = desktop.devtools.debug.startSession();
		var attachHandle = null; // returned by reloadWithDebugSession
		var teardown = function () {};

		// Local state — accumulated across the polling lifetime.
		var totals = {
			count:     0,
			totalTime: 0,
			byType:    Object.create( null ),
			slowest:   0,
		};
		// Index events by id so the details panel can re-render
		// the most-recent click target without holding a DOM ref.
		var eventById = Object.create( null );
		var selectedEventId = null;

		var inspector = desktop.registerWindow( {
			id:        INSPECTOR_ID,
			title:     'SQL — ' + info.title,
			icon:      'dashicons-search',
			width:     960,
			height:    600,
			minWidth:  560,
			minHeight: 380,
			autofocus: true,
			onClose:   function () { teardown(); },
			render:    function ( body ) {
				body.innerHTML =
					'<wpd-stack gap="0" style="height:100%;box-sizing:border-box;">' +
						// Top header strip — status + aggregates.
						'<div style="padding:8px 12px;border-block-end:1px solid rgba(0,0,0,.08);display:flex;flex-direction:column;gap:6px;">' +
							'<wpd-cluster gap="8" style="align-items:center;">' +
								'<wpd-badge tone="success" data-role="status">Attached</wpd-badge>' +
								'<span style="opacity:0.7;font-size:12px;" title="Owner plugin or URL of the target window">' + escapeHtml( info.owner ) + '</span>' +
								'<span style="flex:1"></span>' +
								'<wpd-button data-role="clear" variant="secondary" size="sm">Clear</wpd-button>' +
							'</wpd-cluster>' +
							'<div data-role="aggregates" style="font:11px/1.4 ui-monospace,Menlo,monospace;color:#646970;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
								'<span>0 queries</span>' +
							'</div>' +
						'</div>' +
						( info.isIframe
							? ''
							: '<wpd-empty-state heading="Native window" description="SQL inspection is only available for iframe windows. Native windows render in the parent shell and don\'t issue independent server requests."></wpd-empty-state>'
						) +
						// Log fills the remaining space above the
						// details panel.
						'<wpd-log data-role="log" auto-row-height max-rows="2000" style="flex:1;min-height:0;"></wpd-log>' +
						// Details panel — hidden until a row is
						// clicked; takes a fixed slice of the
						// window when shown.
						'<div data-role="details" style="display:none;border-block-start:1px solid rgba(0,0,0,.08);background:#fafafa;height:240px;overflow:auto;padding:10px 12px;font:11px/1.5 ui-monospace,Menlo,monospace;color:#1d2327;flex-shrink:0;"></div>' +
					'</wpd-stack>';

				var statusEl     = body.querySelector( '[data-role="status"]' );
				var aggsEl       = body.querySelector( '[data-role="aggregates"]' );
				var clearEl      = body.querySelector( '[data-role="clear"]' );
				var logEl        = body.querySelector( '[data-role="log"]' );
				var detailsEl    = body.querySelector( '[data-role="details"]' );

				function paintAggregates() {
					var byType = totals.byType;
					var typeChips = Object.keys( byType ).sort().map( function ( t ) {
						return typeBadge( t ) + '<span style="color:#1d2327;font-weight:600;margin-inline-start:2px;">' + byType[ t ] + '</span>';
					} ).join( '<span style="opacity:.4;margin:0 2px;">·</span>' );
					aggsEl.innerHTML =
						'<span><strong style="color:#1d2327;">' + totals.count + '</strong> ' + ( 1 === totals.count ? 'query' : 'queries' ) + '</span>' +
						'<span style="opacity:.4;">·</span>' +
						'<span><strong style="color:#1d2327;">' + fmtMs( totals.totalTime ) + '</strong> total</span>' +
						( totals.slowest > 0 ? '<span style="opacity:.4;">·</span><span>slowest <strong style="color:#1d2327;">' + fmtMs( totals.slowest ) + '</strong></span>' : '' ) +
						( typeChips ? '<span style="opacity:.4;">·</span>' + typeChips : '' );
				}
				paintAggregates();

				function showDetails( ev ) {
					var p = ev.payload || {};
					selectedEventId = ev.id;
					var lines = String( p.caller || '' ).split( ',' ).map( function ( s ) { return s.trim(); } ).filter( Boolean );
					var callerHtml = lines.length
						? '<div style="margin-block-start:4px;">' + lines.map( function ( l, i ) {
							return '<div style="padding:1px 0;color:' + ( 0 === i ? '#1d2327' : '#646970' ) + ';">' + ( 0 === i ? '<strong>' : '' ) + escapeHtml( l ) + ( 0 === i ? '</strong>' : '' ) + '</div>';
						} ).join( '' ) + '</div>'
						: '<em style="color:#646970;">No caller backtrace available.</em>';

					var fields = [
						[ 'Time',      fmtMs( p.time ) ],
						[ 'Type',      String( p.type || 'OTHER' ) ],
						[ 'Component', String( p.component || 'core' ) ],
						[ 'Rows',      String( p.rows || 0 ) + ( p.is_read ? ' returned' : ' affected' ) ],
						[ 'Insert id', p.insert_id ? String( p.insert_id ) : '—' ],
						[ 'Method',    String( p.method || '' ).toUpperCase() ],
						[ 'Request',   String( p.uri || '' ) ],
					];
					var fieldsHtml = '<dl style="display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0;">' +
						fields.map( function ( pair ) {
							return '<dt style="color:#646970;">' + escapeHtml( pair[ 0 ] ) + '</dt>' +
								'<dd style="margin:0;color:#1d2327;word-break:break-all;">' + escapeHtml( pair[ 1 ] ) + '</dd>';
						} ).join( '' ) +
						'</dl>';

					detailsEl.style.display = 'block';
					detailsEl.innerHTML =
						'<div style="display:flex;align-items:center;gap:8px;margin-block-end:8px;">' +
							'<strong style="color:#1d2327;font-family:-apple-system,system-ui,sans-serif;">Query #' + ev.id + '</strong>' +
							typeBadge( p.type ) +
							'<span style="flex:1"></span>' +
							'<button type="button" data-role="close-details" aria-label="Close details" style="border:0;background:transparent;cursor:pointer;color:#646970;font-size:14px;padding:2px 6px;">×</button>' +
						'</div>' +
						'<wpd-code copy block style="display:block;margin-block-end:10px;"></wpd-code>' +
						fieldsHtml +
						'<div style="margin-block-start:10px;color:#646970;"><strong style="color:#1d2327;">Caller:</strong>' + callerHtml + '</div>';

					detailsEl.querySelector( 'wpd-code' ).textContent = String( p.sql || '' );
					detailsEl.querySelector( '[data-role="close-details"]' ).addEventListener( 'click', function () {
						detailsEl.style.display = 'none';
						selectedEventId = null;
					} );
				}

				logEl.renderRow = function ( ev ) {
					var p          = ev.payload || {};
					var sql        = String( p.sql || '' ).replace( /\s+/g, ' ' ).trim();
					var component  = String( p.component || 'core' );
					var type       = String( p.type || 'OTHER' );
					var rows       = String( p.rows || 0 );
					var ms         = fmtMs( p.time );

					var row = document.createElement( 'div' );
					row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:0 8px;height:26px;font:11px/1.2 ui-monospace,Menlo,monospace;border-block-end:1px solid rgba(0,0,0,.06);cursor:pointer;' + ( ev.id === selectedEventId ? 'background:#e3f2fd;' : '' );
					row.title = 'Click for full details';
					row.innerHTML =
						'<span style="color:#1d2327;font-weight:600;min-width:62px;text-align:end;">' + ms + '</span>' +
						typeBadge( type ) +
						'<span style="color:#646970;flex-shrink:0;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="Component">' + escapeHtml( component ) + '</span>' +
						'<span style="color:#646970;flex-shrink:0;min-width:42px;text-align:end;" title="' + ( p.is_read ? 'Rows returned' : 'Rows affected' ) + '">' + rows + ' ' + ( p.is_read ? '↻' : '✎' ) + '</span>' +
						'<span style="flex:1;min-width:0;color:#1d2327;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml( sql ) + '</span>';
					row.addEventListener( 'click', function () {
						showDetails( ev );
					} );
					return row;
				};

				clearEl.addEventListener( 'click', function () {
					if ( typeof logEl.clear === 'function' ) {
						logEl.clear();
					}
					totals.count     = 0;
					totals.totalTime = 0;
					totals.slowest   = 0;
					totals.byType    = Object.create( null );
					eventById        = Object.create( null );
					selectedEventId  = null;
					detailsEl.style.display = 'none';
					paintAggregates();
				} );

				// Self-managed poll loop — see prior DX notes.
				var apiFetch    = window.wp && wp.apiFetch;
				var sinceCursor = 0;
				var pollAlive   = true;
				var pollTimer   = null;
				var pollOnce = function () {
					if ( ! pollAlive || ! apiFetch ) {
						return;
					}
					apiFetch( {
						path: '/wp-desktop/v1/debug?sessionId=' + encodeURIComponent( session )
							+ '&since=' + sinceCursor
							+ '&channels[]=query',
						method: 'GET',
					} ).then( function ( body ) {
						if ( body && typeof body.cursor === 'number' && body.cursor > sinceCursor ) {
							sinceCursor = body.cursor;
						}
						var events = ( body && body.events ) || [];
						if ( ! events.length ) {
							return;
						}
						events.forEach( function ( ev ) {
							var p = ev.payload || {};
							totals.count     += 1;
							totals.totalTime += ( p.time || 0 );
							if ( ( p.time || 0 ) > totals.slowest ) {
								totals.slowest = p.time || 0;
							}
							var t = String( p.type || 'OTHER' ).toUpperCase();
							totals.byType[ t ] = ( totals.byType[ t ] || 0 ) + 1;
							eventById[ ev.id ] = ev;
							logEl.push( ev );
						} );
						paintAggregates();
					} ).catch( function () {
						/* network blip — next tick retries */
					} ).finally( function () {
						if ( pollAlive ) {
							pollTimer = setTimeout( pollOnce, POLL_MS );
						}
					} );
				};
				pollOnce();

				// Prefer the framework's high-level
				// `reloadWithDebugSession` (since wp-desktop-mode
				// 0.21) — it bundles addRequestHeader + iframe URL
				// rewrite + `load` listener + cleanup into one
				// call. Fall back to the manual four-step dance
				// for older wp-desktop-mode bundles (0.19/0.20),
				// since SCRIPT_DEBUG installs may load a dev
				// bundle that's behind the prod one.
				if ( info.isIframe ) {
					if ( typeof desktop.devtools.reloadWithDebugSession === 'function' ) {
						attachHandle = desktop.devtools.reloadWithDebugSession(
							targetWin.id,
							session
						);
					} else {
						attachHandle = manualAttachWithDebugSession( desktop, targetWin, session );
					}
				}

				teardown = function () {
					pollAlive = false;
					if ( pollTimer ) {
						clearTimeout( pollTimer );
						pollTimer = null;
					}
					if ( attachHandle && typeof attachHandle.dispose === 'function' ) {
						try { attachHandle.dispose(); } catch ( _e ) {}
						attachHandle = null;
					}
					if ( statusEl ) {
						statusEl.setAttribute( 'tone', 'neutral' );
						statusEl.textContent = 'Detached';
					}
				};
			},
		} );

		return inspector;
	}

	function buildPopover( host, targetWin ) {
		var existing = document.querySelector( '.alcazaba-devtools-pop' );
		if ( existing ) {
			existing.remove();
			if ( existing.dataset.host === host.dataset.azDevId ) {
				return null;
			}
		}

		var pop = document.createElement( 'div' );
		pop.className = 'alcazaba-devtools-pop';
		pop.setAttribute( 'role', 'menu' );
		pop.dataset.host = host.dataset.azDevId;
		pop.style.cssText =
			'position:fixed;z-index:2147483646;' +
			'background:#fff;color:#1e1e1e;' +
			'border:1px solid rgba(0,0,0,.12);border-radius:6px;' +
			'box-shadow:0 8px 24px rgba(0,0,0,.18);' +
			'min-width:220px;padding:4px;' +
			'font:13px/1.4 -apple-system,system-ui,"Segoe UI",sans-serif;';

		var items = [
			{
				key:      'attach-sql',
				label:    'Attach SQL Inspector',
				icon:     'dashicons-database-view',
				disabled: ! targetWin.iframe,
				hint:     targetWin.iframe ? null : 'Native windows have no observable iframe.',
				onClick:  function () { openInspector( targetWin ); },
			},
		];

		items.forEach( function ( item ) {
			var btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.setAttribute( 'role', 'menuitem' );
			btn.disabled = !! item.disabled;
			btn.style.cssText =
				'display:flex;align-items:center;gap:8px;width:100%;' +
				'padding:8px 10px;background:transparent;border:0;border-radius:4px;' +
				'color:inherit;cursor:' + ( item.disabled ? 'not-allowed' : 'pointer' ) + ';' +
				'text-align:start;font:inherit;opacity:' + ( item.disabled ? '0.55' : '1' ) + ';';
			btn.innerHTML =
				'<span class="dashicons ' + item.icon + '" style="font-size:16px;width:16px;height:16px;"></span>' +
				'<span style="flex:1;">' + escapeHtml( item.label ) + '</span>' +
				( item.hint ? '<span style="opacity:.7;font-size:11px;">' + escapeHtml( item.hint ) + '</span>' : '' );
			if ( ! item.disabled ) {
				btn.addEventListener( 'mouseenter', function () { btn.style.background = 'rgba(34,113,177,0.1)'; } );
				btn.addEventListener( 'mouseleave', function () { btn.style.background = 'transparent'; } );
				btn.addEventListener( 'click', function () {
					pop.remove();
					item.onClick();
				} );
			}
			pop.appendChild( btn );
		} );

		var rect = host.getBoundingClientRect();
		pop.style.top  = Math.max( 8, rect.bottom + 6 ) + 'px';
		pop.style.left = Math.max( 8, Math.min( window.innerWidth - 240, rect.right - 220 ) ) + 'px';
		document.body.appendChild( pop );

		window.setTimeout( function () {
			var off = function ( e ) {
				if ( pop.contains( e.target ) || host.contains( e.target ) ) {
					return;
				}
				pop.remove();
				document.removeEventListener( 'mousedown', off, true );
			};
			document.addEventListener( 'mousedown', off, true );
		}, 0 );

		return pop;
	}

	var nextHostId = 0;

	ready( function () {
		var desktop = wp.desktop;
		if ( ! desktop || typeof desktop.registerTitleBarButton !== 'function' ) {
			return;
		}
		if ( ! desktop.devtools || typeof desktop.devtools.addRequestHeader !== 'function' ) {
			return;
		}

		desktop.registerTitleBarButton( {
			id:        BUTTON_ID,
			label:     'Devtools',
			icon:      ICON,
			placement: 'right',
			order:     200,
			owner:     OWNER,
			match:     function ( win ) {
				return ! ( win && win.id && 0 === win.id.indexOf( 'sql-inspector/' ) );
			},
			render: function ( host, win ) {
				host.dataset.azDevId = 'az-dev-' + ( ++nextHostId );
				host.addEventListener( 'wpd-button-activate', function () {
					buildPopover( host, win );
				} );
			},
		} );
	} );
} )();
