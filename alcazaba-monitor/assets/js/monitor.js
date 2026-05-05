/**
 * Alcazaba System Monitor — a WP Desktop widget that surfaces
 * the errors your admin session is quietly swallowing.
 *
 * Registered end-to-end in PHP via `desktop_mode_register_widget()`
 * — the shell owns the picker entry, the script enqueue, and the
 * mount lifecycle across plugin activation / deactivation. This
 * file only contributes the mount callback, published on
 * `window.wpDesktopWidgets[ 'alcazaba-monitor/system' ]` for the
 * shell to pick up. The card paints a compact, monospaced,
 * scrollable feed with three live data sources:
 *
 *   1. Uncaught runtime errors — `window` `error` event
 *      (bubbles all synchronous throws from scripts, inline
 *      handlers, event callbacks).
 *   2. Unhandled promise rejections — `window`
 *      `unhandledrejection`. These are nearly always silent
 *      in the DevTools console when they come from libraries
 *      that catch-and-log-but-don't-rethrow, so surfacing
 *      them here is a real diagnostic win.
 *   3. HTTP failures — `fetch()` responses with a 4xx / 5xx
 *      status, plus `XMLHttpRequest` `loadend` for the same
 *      band. Transport-level failures (CORS, DNS, offline)
 *      surface with `status: 0` and a "Request failed" label.
 *      Redirects (3xx) are skipped on purpose — `fetch()`
 *      auto-follows them and they're not user-visible
 *      failures.
 *
 * We deliberately do NOT patch `console.log` / `console.info`
 * — those are informational and would drown real signal. We
 * patch `console.error` and `console.warn` because plugins
 * routinely use them as the last-resort error channel (when
 * no exception is thrown but something is still wrong).
 *
 * ### Shell-forwarded observability
 *
 * In addition to the parent-frame interceptors above, we
 * subscribe to three hooks the shell publishes for us (added
 * in wp-desktop-mode 0.10.0):
 *
 *   * `IFRAME_ERROR` — runtime errors + unhandled rejections
 *     caught inside chromeless admin-page iframes. Origin-
 *     filtered at the shell so cross-origin frames stay
 *     opaque.
 *   * `IFRAME_NETWORK_COMPLETED` — every `fetch` / XHR that
 *     completes inside a chromeless iframe. We only render
 *     failures (status 0, or 4xx/5xx) so the admin's normal
 *     REST chatter doesn't drown the feed.
 *   * `SHELL_ERROR` — exceptions the shell's own try/catch
 *     barriers caught (widget mount, wallpaper teardown,
 *     session save, menu refresh). These used to vanish into
 *     the browser console; now they're first-class rows.
 *
 * Entries are normalized into the canonical `MonitorEntry`
 * shape (`src/types.ts`) before being run through the
 * `MONITOR_ENTRY` filter — plugins can rewrite messages, add
 * `extra` context, or return `null` to suppress specific
 * entries without patching this widget.
 *
 * @since 0.1.0
 */

( function () {
	'use strict';

	var WIDGET_ID = 'alcazaba-monitor/system';
	var NAMESPACE = 'alcazaba-monitor';

	var CONFIG = {
		/** Ring-buffer cap. Older entries fall off the top. */
		maxEntries:       200,
		/** Truncate individual messages so a stringified 1MB
		 *  DOMException payload can't blow up the DOM. */
		maxMessageChars:  400,
		/** Consecutive identical entries within this window
		 *  collapse into a count badge on the tail row, so a
		 *  setInterval throwing at 60Hz doesn't hide everything
		 *  else behind a wall of duplicates. */
		dedupWindowMs:    1500,
	};

	var STYLE_ID = 'alcazaba-monitor-styles';

	/**
	 * Scoped stylesheet injected on first mount. Uses the shell's
	 * `[data-widget-id]` attribute selector so the card container
	 * contributes nothing of its own to cascade conflicts, and
	 * every rule is isolated by the `.alcazaba-monitor` class the
	 * mount creates inside the card body.
	 */
	var STYLES =
		'[data-widget-id="' + WIDGET_ID + '"] {'
			+ '--am-bg: rgba(0,0,0,0.22);'
			+ '--am-border: rgba(255,255,255,0.08);'
			+ '--am-muted: rgba(255,255,255,0.55);'
		+ '}'
		+ '.alcazaba-monitor {'
			+ 'display:flex;flex-direction:column;height:100%;'
			+ 'margin:-12px;' /* cancel card body padding so the feed goes edge-to-edge */
			+ 'font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;'
			+ 'color:rgba(255,255,255,0.9);'
			+ 'background:var(--am-bg);'
			+ 'border-radius:inherit;'
			+ 'overflow:hidden;'
		+ '}'
		+ '.alcazaba-monitor__head {'
			+ 'display:flex;align-items:center;gap:6px;'
			+ 'padding:7px 9px;'
			+ 'border-bottom:1px solid var(--am-border);'
			+ 'flex:0 0 auto;'
		+ '}'
		+ '.alcazaba-monitor__counts {'
			+ 'display:flex;gap:4px;flex:1 1 auto;min-width:0;'
		+ '}'
		+ '.alcazaba-monitor__count {'
			+ 'display:inline-flex;align-items:center;gap:3px;'
			+ 'padding:1px 6px;border-radius:3px;'
			+ 'font-size:10.5px;font-weight:600;'
		+ '}'
		+ '.alcazaba-monitor__count--error   { background:rgba(224,82,82,0.18); color:#ff8a8a; }'
		+ '.alcazaba-monitor__count--warn    { background:rgba(240,173,78,0.18); color:#f0ad4e; }'
		+ '.alcazaba-monitor__count--network { background:rgba(108,132,208,0.22); color:#97b0ee; }'
		+ '.alcazaba-monitor__clear {'
			+ 'border:1px solid var(--am-border);'
			+ 'background:transparent;color:inherit;font:inherit;'
			+ 'font-size:10.5px;padding:1px 8px;border-radius:3px;'
			+ 'cursor:pointer;'
		+ '}'
		+ '.alcazaba-monitor__clear:hover { background:rgba(255,255,255,0.05); }'
		+ '.alcazaba-monitor__list {'
			+ 'flex:1 1 auto;overflow-y:auto;overflow-x:hidden;'
			+ 'padding:0;margin:0;list-style:none;'
		+ '}'
		+ '.alcazaba-monitor__empty {'
			+ 'padding:16px 12px;text-align:center;'
			+ 'color:var(--am-muted);font-size:10.5px;'
		+ '}'
		+ '.alcazaba-monitor__row {'
			+ 'display:grid;'
			+ 'grid-template-columns:3px 54px 1fr auto;'
			+ 'gap:6px;align-items:start;'
			+ 'padding:4px 9px 4px 0;'
			+ 'border-bottom:1px solid rgba(255,255,255,0.04);'
		+ '}'
		+ '.alcazaba-monitor__row--error        { --chip:#e05252; }'
		+ '.alcazaba-monitor__row--iframe-error { --chip:#e05252; }'
		+ '.alcazaba-monitor__row--shell-error  { --chip:#cc3333; }'
		+ '.alcazaba-monitor__row--warn         { --chip:#f0ad4e; }'
		+ '.alcazaba-monitor__row--network      { --chip:#6c84d0; }'
		+ '.alcazaba-monitor__row--promise      { --chip:#c678dd; }'
		+ '.alcazaba-monitor__chip {'
			+ 'background:var(--chip,#888);'
			+ 'align-self:stretch;'
		+ '}'
		+ '.alcazaba-monitor__time {'
			+ 'color:var(--am-muted);font-size:10px;'
			+ 'padding-top:1px;font-variant-numeric:tabular-nums;'
		+ '}'
		+ '.alcazaba-monitor__msg { min-width:0; }'
		+ '.alcazaba-monitor__msg-main {'
			+ 'white-space:pre-wrap;word-break:break-word;'
		+ '}'
		+ '.alcazaba-monitor__msg-meta {'
			+ 'color:var(--am-muted);font-size:10px;'
			+ 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
		+ '}'
		+ '.alcazaba-monitor__dedup {'
			+ 'align-self:start;margin-top:1px;'
			+ 'padding:0 5px;border-radius:8px;'
			+ 'background:rgba(255,255,255,0.08);'
			+ 'font-size:10px;font-weight:600;'
		+ '}';

	function ensureStyles() {
		if ( document.getElementById( STYLE_ID ) ) {
			return;
		}
		var el = document.createElement( 'style' );
		el.id = STYLE_ID;
		el.textContent = STYLES;
		document.head.appendChild( el );
	}

	function truncate( s ) {
		if ( s.length <= CONFIG.maxMessageChars ) {
			return s;
		}
		return s.slice( 0, CONFIG.maxMessageChars ) + '…';
	}

	/**
	 * Serialize a `console.error(arg1, arg2, ...)` argument list
	 * into a single diagnostic string. Strings pass through; Error
	 * instances contribute their message; everything else goes
	 * through `JSON.stringify` with a safety net for circular refs
	 * (so a logged DOM node can't throw inside our handler).
	 */
	function fmtArgs( args ) {
		var parts = [];
		for ( var i = 0; i < args.length; i++ ) {
			parts.push( fmtOne( args[ i ] ) );
		}
		return parts.join( ' ' );
	}

	function fmtOne( v ) {
		if ( v === null ) {
			return 'null';
		}
		if ( v === undefined ) {
			return 'undefined';
		}
		if ( typeof v === 'string' ) {
			return v;
		}
		if ( v instanceof Error ) {
			return v.message || String( v );
		}
		try {
			return JSON.stringify( v );
		} catch ( _ ) {
			return String( v );
		}
	}

	function fmtTime( ts ) {
		var d = new Date( ts );
		var pad = function ( n ) { return n < 10 ? '0' + n : '' + n; };
		return pad( d.getHours() ) + ':' + pad( d.getMinutes() ) + ':' + pad( d.getSeconds() );
	}

	/**
	 * Extract a usable URL from whatever the caller passed to
	 * `fetch()`. `fetch` accepts a `string | URL | Request`; each
	 * exposes the URL differently.
	 */
	function fetchUrl( input ) {
		if ( typeof input === 'string' ) {
			return input;
		}
		if ( input && typeof input.url === 'string' ) {
			return input.url;
		}
		if ( input && typeof input.href === 'string' ) {
			return input.href;
		}
		return '';
	}

	function fetchMethod( input, init ) {
		if ( init && init.method ) {
			return String( init.method ).toUpperCase();
		}
		if ( input && typeof input.method === 'string' ) {
			return input.method.toUpperCase();
		}
		return 'GET';
	}

	/**
	 * Called by the shell when the user enables this widget via
	 * the picker. Builds the UI, installs the global interceptors,
	 * returns a teardown that reverses both.
	 *
	 * @param {HTMLElement} container Card body (12px padded by the shell).
	 * @param {Object}      ctx      { id, pluginUrl }.
	 * @return {Function} Teardown.
	 */
	function mountMonitor( container, ctx ) {
		ensureStyles();

		// Stash references the shell exposes once it has booted.
		// Capturing here (inside `mount`) guarantees they exist —
		// `whenReady` has already resolved by the time the widget
		// layer mounts us.
		var api      = window.wp && window.wp.desktop;
		var hooksApi = api && api.hooks ? api.hooks : ( window.wp && window.wp.hooks );
		var HOOKS    = ( api && api.HOOKS ) || {};
		var MONITOR_ENTRY_HOOK           = HOOKS.MONITOR_ENTRY            || null;
		var IFRAME_ERROR_HOOK            = HOOKS.IFRAME_ERROR             || null;
		var IFRAME_NETWORK_COMPLETED_HOOK = HOOKS.IFRAME_NETWORK_COMPLETED || null;
		var SHELL_ERROR_HOOK             = HOOKS.SHELL_ERROR              || null;

		var root = document.createElement( 'div' );
		root.className = 'alcazaba-monitor';
		container.appendChild( root );

		// Header
		var head = document.createElement( 'div' );
		head.className = 'alcazaba-monitor__head';
		var counts = document.createElement( 'div' );
		counts.className = 'alcazaba-monitor__counts';
		var countError = makeCount( 'error',   '!' );
		var countWarn  = makeCount( 'warn',    '*' );
		var countNet   = makeCount( 'network', '~' );
		counts.appendChild( countError.el );
		counts.appendChild( countWarn.el );
		counts.appendChild( countNet.el );
		var clearBtn = document.createElement( 'button' );
		clearBtn.type = 'button';
		clearBtn.className = 'alcazaba-monitor__clear';
		clearBtn.textContent = 'Clear';
		head.appendChild( counts );
		head.appendChild( clearBtn );
		root.appendChild( head );

		// Scrollable list
		var list = document.createElement( 'ul' );
		list.className = 'alcazaba-monitor__list';
		list.setAttribute( 'role', 'log' );
		list.setAttribute( 'aria-live', 'polite' );
		root.appendChild( list );

		var empty = document.createElement( 'div' );
		empty.className = 'alcazaba-monitor__empty';
		empty.textContent =
			'No errors yet. Shell, iframe, and network failures all surface here.';
		list.appendChild( empty );

		// In-memory ring buffer. `entries` holds MonitorEntry-shaped
		// objects (plus an internal `dedupCount`); `rowOf` maps entry
		// → its DOM row so dedup updates don't re-create the row.
		var entries = [];
		var rowOf = new WeakMap();
		// Track every MonitorEntry `type` we consume. The head bar
		// shows three buckets (errors / warnings / network) — all
		// error-family types fold into the error count so the
		// summary stays scannable at a glance.
		var tally = {
			'error':        0,
			'iframe-error': 0,
			'shell-error':  0,
			'promise':      0,
			'warn':         0,
			'network':      0,
		};

		function bumpTally( type, delta ) {
			if ( ! Object.prototype.hasOwnProperty.call( tally, type ) ) {
				tally[ type ] = 0;
			}
			tally[ type ] = Math.max( 0, tally[ type ] + delta );
		}

		function errorBucketTotal() {
			return (
				tally[ 'error' ] +
				tally[ 'iframe-error' ] +
				tally[ 'shell-error' ] +
				tally[ 'promise' ]
			);
		}

		function updateCounts() {
			countError.setValue( errorBucketTotal() );
			countWarn.setValue( tally.warn );
			countNet.setValue( tally.network );
		}
		updateCounts();

		function addEntry( raw ) {
			// Normalize to the MonitorEntry shape the shell documents
			// in `src/types.ts`. Optional fields are copied only when
			// present so we don't litter the object with `undefined`
			// keys that a filter author might misread as "set".
			var entry = {
				ts:      Date.now(),
				type:    raw.type,
				message: truncate( raw.message || '' ),
			};
			if ( raw.source )       { entry.source   = raw.source; }
			if ( 'status'   in raw && raw.status   !== undefined ) { entry.status   = raw.status; }
			if ( raw.method )       { entry.method   = raw.method; }
			if ( raw.url )          { entry.url      = raw.url; }
			if ( 'duration' in raw && raw.duration !== undefined ) { entry.duration = raw.duration; }
			if ( 'failed'   in raw && raw.failed   !== undefined ) { entry.failed   = raw.failed; }
			if ( raw.extra )        { entry.extra    = raw.extra; }

			// Apply the shell's MONITOR_ENTRY filter. Plugins can
			// mutate the entry (rewrite the message, attach `extra`)
			// or return null to drop it — spammy entries that would
			// otherwise blow out the ring buffer can be silenced
			// upstream without patching this widget.
			if ( hooksApi && typeof hooksApi.applyFilters === 'function' && MONITOR_ENTRY_HOOK ) {
				var filtered;
				try {
					filtered = hooksApi.applyFilters( MONITOR_ENTRY_HOOK, entry );
				} catch ( _ ) {
					filtered = entry;
				}
				if ( filtered === null || filtered === undefined ) {
					return;
				}
				entry = filtered;
				// A filter could set `ts` to something weird; dedup
				// still needs a monotonically-incrementing clock, so
				// re-anchor it if the filter blanked the field.
				if ( typeof entry.ts !== 'number' ) {
					entry.ts = Date.now();
				}
			}

			entry.dedupCount = 1;

			// Dedup: if the most recent entry has the same type +
			// message AND arrived within the dedup window, bump its
			// count rather than appending a new row.
			var last = entries.length > 0 ? entries[ entries.length - 1 ] : null;
			if (
				last
				&& last.type === entry.type
				&& last.message === entry.message
				&& ( entry.ts - last.ts ) <= CONFIG.dedupWindowMs
			) {
				last.dedupCount  += 1;
				last.ts           = entry.ts;
				updateDedup( last );
				return;
			}

			entries.push( entry );
			bumpTally( entry.type, 1 );
			updateCounts();

			if ( empty.parentNode ) {
				empty.parentNode.removeChild( empty );
			}

			var atBottom =
				list.scrollHeight - list.scrollTop - list.clientHeight < 16;

			var row = buildRow( entry );
			rowOf.set( entry, row );
			list.appendChild( row );

			while ( entries.length > CONFIG.maxEntries ) {
				var evicted = entries.shift();
				bumpTally( evicted.type, -1 );
				var evictedRow = rowOf.get( evicted );
				if ( evictedRow && evictedRow.parentNode ) {
					evictedRow.parentNode.removeChild( evictedRow );
				}
			}
			updateCounts();

			if ( atBottom ) {
				list.scrollTop = list.scrollHeight;
			}
		}

		function updateDedup( entry ) {
			var row = rowOf.get( entry );
			if ( ! row ) {
				return;
			}
			var badge = row.querySelector( '.alcazaba-monitor__dedup' );
			if ( ! badge ) {
				badge = document.createElement( 'span' );
				badge.className = 'alcazaba-monitor__dedup';
				row.appendChild( badge );
			}
			badge.textContent = '×' + entry.dedupCount;
			var timeEl = row.querySelector( '.alcazaba-monitor__time' );
			if ( timeEl ) {
				timeEl.textContent = fmtTime( entry.ts );
			}
		}

		function buildRow( entry ) {
			var li = document.createElement( 'li' );
			li.className =
				'alcazaba-monitor__row alcazaba-monitor__row--' + rowModifier( entry.type );

			var chip = document.createElement( 'span' );
			chip.className = 'alcazaba-monitor__chip';
			li.appendChild( chip );

			var time = document.createElement( 'span' );
			time.className = 'alcazaba-monitor__time';
			time.textContent = fmtTime( entry.ts );
			li.appendChild( time );

			var msg = document.createElement( 'div' );
			msg.className = 'alcazaba-monitor__msg';
			var main = document.createElement( 'div' );
			main.className = 'alcazaba-monitor__msg-main';
			main.textContent = entry.message;
			msg.appendChild( main );
			var metaText = buildMeta( entry );
			if ( metaText ) {
				var meta = document.createElement( 'div' );
				meta.className = 'alcazaba-monitor__msg-meta';
				meta.textContent = metaText;
				meta.title       = metaText;
				msg.appendChild( meta );
			}
			li.appendChild( msg );

			// Full message + meta on the row title so long
			// stack traces are accessible on hover.
			var hover = entry.message;
			if ( metaText ) {
				hover += '\n' + metaText;
			}
			li.title = hover;

			return li;
		}

		function buildMeta( entry ) {
			if ( entry.type === 'network' ) {
				var parts = [];
				if ( entry.status ) {
					parts.push( entry.status );
				} else {
					parts.push( '✕' );
				}
				if ( entry.method ) {
					parts.push( entry.method );
				}
				if ( entry.url ) {
					parts.push( entry.url );
				}
				if ( typeof entry.duration === 'number' ) {
					parts.push( Math.round( entry.duration ) + 'ms' );
				}
				return parts.join( '  ' );
			}
			if ( entry.source ) {
				return entry.source;
			}
			return '';
		}

		function rowModifier( type ) {
			if ( type === 'error' )        { return 'error'; }
			if ( type === 'iframe-error' ) { return 'iframe-error'; }
			if ( type === 'shell-error' )  { return 'shell-error'; }
			if ( type === 'warn' )         { return 'warn'; }
			if ( type === 'network' )      { return 'network'; }
			if ( type === 'promise' )      { return 'promise'; }
			return 'error';
		}

		function clearAll() {
			entries.length = 0;
			for ( var k in tally ) {
				if ( Object.prototype.hasOwnProperty.call( tally, k ) ) {
					tally[ k ] = 0;
				}
			}
			updateCounts();
			while ( list.firstChild ) {
				list.removeChild( list.firstChild );
			}
			list.appendChild( empty );
		}
		clearBtn.addEventListener( 'click', clearAll );

		// Install global interceptors. Kept in a dedicated helper
		// so the teardown path can uninstall them atomically and
		// we don't accidentally leak handlers by returning early.
		var uninstall = installInterceptors( addEntry );

		// ── Shell observability hooks ────────────────────────────
		// The parent-scoped interceptors above catch events that
		// bubble up to our window. The shell additionally forwards
		// a curated set of *in-iframe* events (admin-page errors,
		// admin-ajax 4xx/5xx, Gutenberg REST 500s, …) and its own
		// try/catch barriers through the hook bus — subscribe so
		// the monitor reflects genuine admin observability, not
		// just what happens inside the shell frame.
		var iframeErrorRegistered      = false;
		var iframeNetworkRegistered    = false;
		var shellErrorRegistered       = false;

		var iframeErrorHandler = function ( detail ) {
			if ( ! detail ) {
				return;
			}
			var where = '';
			if ( detail.filename ) {
				where = detail.filename;
				if ( detail.lineno ) {
					where += ':' + detail.lineno;
					if ( detail.colno ) {
						where += ':' + detail.colno;
					}
				}
			}
			var src = detail.windowId
				? ( detail.windowId + ( where ? ' · ' + where : '' ) )
				: where;
			addEntry( {
				type:    'iframe-error',
				message: detail.message || 'Iframe error',
				source:  src,
				failed:  true,
				extra:   detail.stack ? { stack: detail.stack, kind: detail.kind } : { kind: detail.kind },
			} );
		};

		var iframeNetworkHandler = function ( detail ) {
			if ( ! detail ) {
				return;
			}
			// Only surface failures — success responses from inside
			// the admin would otherwise drown out the feed. `failed`
			// covers transport errors (status 0); 4xx/5xx covers
			// server-side failures. 3xx and 2xx are not user-visible
			// errors so we skip them (mirrors the parent-fetch rule).
			var isHttpFail = detail.status >= 400 && detail.status < 600;
			if ( ! detail.failed && ! isHttpFail ) {
				return;
			}
			var method = detail.method || 'GET';
			var url    = detail.url || '';
			var status = detail.status || 0;
			var msg    = detail.failed && status === 0
				? 'Network failure: ' + method + ' ' + url
				: method + ' ' + url + ' → ' + status;
			addEntry( {
				type:     'network',
				status:   status,
				method:   method,
				url:      url,
				duration: detail.duration,
				failed:   true,
				source:   detail.windowId || '',
				message:  msg,
			} );
		};

		var shellErrorHandler = function ( detail ) {
			if ( ! detail ) {
				return;
			}
			var err = detail.error;
			var msg = '';
			if ( err instanceof Error ) {
				msg = err.message || String( err );
			} else if ( typeof err === 'string' ) {
				msg = err;
			} else {
				msg = fmtOne( err );
			}
			var src = detail.scope
				? ( detail.id ? detail.scope + ' · ' + detail.id : detail.scope )
				: '';
			addEntry( {
				type:    'shell-error',
				message: msg || 'Shell error',
				source:  src,
				failed:  true,
				extra:   err instanceof Error && err.stack ? { stack: err.stack } : undefined,
			} );
		};

		if ( hooksApi && typeof hooksApi.addAction === 'function' ) {
			if ( IFRAME_ERROR_HOOK ) {
				hooksApi.addAction(
					IFRAME_ERROR_HOOK,
					NAMESPACE + '/iframe-error',
					iframeErrorHandler
				);
				iframeErrorRegistered = true;
			}
			if ( IFRAME_NETWORK_COMPLETED_HOOK ) {
				hooksApi.addAction(
					IFRAME_NETWORK_COMPLETED_HOOK,
					NAMESPACE + '/iframe-network',
					iframeNetworkHandler
				);
				iframeNetworkRegistered = true;
			}
			if ( SHELL_ERROR_HOOK ) {
				hooksApi.addAction(
					SHELL_ERROR_HOOK,
					NAMESPACE + '/shell-error',
					shellErrorHandler
				);
				shellErrorRegistered = true;
			}
		}

		return function teardown() {
			uninstall();
			if ( hooksApi && typeof hooksApi.removeAction === 'function' ) {
				if ( iframeErrorRegistered ) {
					hooksApi.removeAction( IFRAME_ERROR_HOOK, NAMESPACE + '/iframe-error' );
				}
				if ( iframeNetworkRegistered ) {
					hooksApi.removeAction( IFRAME_NETWORK_COMPLETED_HOOK, NAMESPACE + '/iframe-network' );
				}
				if ( shellErrorRegistered ) {
					hooksApi.removeAction( SHELL_ERROR_HOOK, NAMESPACE + '/shell-error' );
				}
			}
			clearBtn.removeEventListener( 'click', clearAll );
			if ( root.parentNode ) {
				root.parentNode.removeChild( root );
			}
		};
	}

	function makeCount( variant, glyph ) {
		var el = document.createElement( 'span' );
		el.className = 'alcazaba-monitor__count alcazaba-monitor__count--' + variant;
		var glyphEl = document.createElement( 'span' );
		glyphEl.textContent = glyph;
		var valueEl = document.createElement( 'span' );
		valueEl.textContent = '0';
		el.appendChild( glyphEl );
		el.appendChild( valueEl );
		return {
			el:       el,
			setValue: function ( n ) { valueEl.textContent = String( n ); },
		};
	}

	/**
	 * Attach global observers for every error channel we surface.
	 *
	 * Design constraints:
	 *   * Non-invasive — every wrapped function calls the original
	 *     with the original `this` and arguments, and preserves
	 *     return values / promise shapes.
	 *   * Fail-safe — a throw inside our own handler can't propagate
	 *     to the host, so each observer is try/catch-gated around
	 *     the `onEntry` call.
	 *   * Reversible — teardown returns the globals to the way we
	 *     found them, except when someone else has wrapped our
	 *     wrappers in the meantime (we can't safely pop out of the
	 *     middle of a chain, so we flip an `active` flag and let
	 *     our wrapper become a passthrough).
	 *
	 * @param {Function} onEntry Called with every normalized entry.
	 * @return {Function} Uninstaller.
	 */
	function installInterceptors( onEntry ) {
		var active = true;
		var report = function ( entry ) {
			if ( ! active ) {
				return;
			}
			try {
				onEntry( entry );
			} catch ( _ ) {
				// Swallow: our own render throwing must not feed
				// back into window.onerror → another entry → loop.
			}
		};

		// ── 1. Uncaught runtime errors ────────────────────────────
		var errorListener = function ( e ) {
			var src = '';
			if ( e.filename ) {
				src = e.filename;
				if ( e.lineno ) {
					src += ':' + e.lineno;
					if ( e.colno ) {
						src += ':' + e.colno;
					}
				}
			}
			report( {
				type:    'error',
				message: e.message || ( e.error && e.error.message ) || 'Error',
				source:  src,
			} );
		};
		// Capture phase so we see errors even if a descendant
		// handler calls `stopPropagation` on the event.
		window.addEventListener( 'error', errorListener, true );

		// ── 2. Unhandled promise rejections ──────────────────────
		var rejListener = function ( e ) {
			var reason = e.reason;
			var msg;
			if ( reason instanceof Error ) {
				msg = reason.message || String( reason );
			} else if ( typeof reason === 'string' ) {
				msg = reason;
			} else {
				msg = fmtOne( reason );
			}
			report( { type: 'promise', message: msg, source: '' } );
		};
		window.addEventListener( 'unhandledrejection', rejListener );

		// ── 3. console.error / console.warn ──────────────────────
		var origConsoleError = window.console && window.console.error;
		var origConsoleWarn  = window.console && window.console.warn;
		var patchedConsoleError = null;
		var patchedConsoleWarn  = null;
		if ( window.console && typeof origConsoleError === 'function' ) {
			patchedConsoleError = function () {
				report( { type: 'error', message: fmtArgs( arguments ), source: '' } );
				return origConsoleError.apply( window.console, arguments );
			};
			window.console.error = patchedConsoleError;
		}
		if ( window.console && typeof origConsoleWarn === 'function' ) {
			patchedConsoleWarn = function () {
				report( { type: 'warn', message: fmtArgs( arguments ), source: '' } );
				return origConsoleWarn.apply( window.console, arguments );
			};
			window.console.warn = patchedConsoleWarn;
		}

		// ── 4. fetch() ───────────────────────────────────────────
		var origFetch = window.fetch;
		var patchedFetch = null;
		if ( typeof origFetch === 'function' ) {
			patchedFetch = function ( input, init ) {
				var method = fetchMethod( input, init );
				var url    = fetchUrl( input );
				var p;
				try {
					p = origFetch.apply( this, arguments );
				} catch ( syncErr ) {
					// Some polyfills throw synchronously for bad input;
					// surface that too rather than let it vanish.
					report( {
						type:    'network',
						status:  0,
						method:  method,
						url:     url,
						message: ( syncErr && syncErr.message ) || 'fetch() threw',
					} );
					throw syncErr;
				}
				if ( ! p || typeof p.then !== 'function' ) {
					return p;
				}
				return p.then(
					function ( response ) {
						if ( response && response.status >= 400 && response.status < 600 ) {
							report( {
								type:    'network',
								status:  response.status,
								method:  method,
								url:     url,
								failed:  true,
								message: method + ' ' + url + ' → ' + response.status,
							} );
						}
						return response;
					},
					function ( err ) {
						report( {
							type:    'network',
							status:  0,
							method:  method,
							url:     url,
							failed:  true,
							message:
								'Network failure: ' +
								method + ' ' + url +
								( err && err.message ? ' (' + err.message + ')' : '' ),
						} );
						throw err;
					}
				);
			};
			window.fetch = patchedFetch;
		}

		// ── 5. XMLHttpRequest ────────────────────────────────────
		// `open` stores the method/url pair on the instance; `send`
		// attaches a one-shot `loadend` listener that reads final
		// state and reports on 4xx/5xx or transport failure.
		var origOpen = XMLHttpRequest.prototype.open;
		var origSend = XMLHttpRequest.prototype.send;
		var patchedOpen = function ( method, url ) {
			this.__alcazabaMonitorMethod = String( method || 'GET' ).toUpperCase();
			this.__alcazabaMonitorUrl    = String( url || '' );
			return origOpen.apply( this, arguments );
		};
		var patchedSend = function () {
			var xhr = this;
			var started = ( typeof performance !== 'undefined' && performance.now )
				? performance.now()
				: Date.now();
			var listener = function () {
				var status  = xhr.status;
				var elapsed = (
					( typeof performance !== 'undefined' && performance.now )
						? performance.now()
						: Date.now()
				) - started;
				if ( status >= 400 && status < 600 ) {
					report( {
						type:     'network',
						status:   status,
						method:   xhr.__alcazabaMonitorMethod,
						url:      xhr.__alcazabaMonitorUrl,
						duration: elapsed,
						failed:   true,
						message:
							xhr.__alcazabaMonitorMethod + ' ' + xhr.__alcazabaMonitorUrl +
							' → ' + status,
					} );
				} else if (
					status === 0 &&
					// `loadend` fires for aborts too — those we don't
					// want to log (user navigation, dropped REST
					// polls, etc). Only report when the `error` or
					// `timeout` events are what closed the request.
					xhr.__alcazabaMonitorFailed
				) {
					report( {
						type:     'network',
						status:   0,
						method:   xhr.__alcazabaMonitorMethod,
						url:      xhr.__alcazabaMonitorUrl,
						duration: elapsed,
						failed:   true,
						message:
							'Network failure: ' +
							xhr.__alcazabaMonitorMethod + ' ' + xhr.__alcazabaMonitorUrl,
					} );
				}
			};
			var markFailed = function () { xhr.__alcazabaMonitorFailed = true; };
			xhr.addEventListener( 'error', markFailed );
			xhr.addEventListener( 'timeout', markFailed );
			xhr.addEventListener( 'loadend', listener );
			return origSend.apply( this, arguments );
		};
		XMLHttpRequest.prototype.open = patchedOpen;
		XMLHttpRequest.prototype.send = patchedSend;

		return function uninstall() {
			active = false;
			window.removeEventListener( 'error', errorListener, true );
			window.removeEventListener( 'unhandledrejection', rejListener );
			// Only restore globals we installed AND still own — if
			// something else has wrapped our wrapper, popping our
			// layer out would break their chain. Leaving our wrapper
			// in place is fine: `active` is false, so it's now a
			// passthrough.
			if ( patchedConsoleError && window.console.error === patchedConsoleError ) {
				window.console.error = origConsoleError;
			}
			if ( patchedConsoleWarn && window.console.warn === patchedConsoleWarn ) {
				window.console.warn = origConsoleWarn;
			}
			if ( patchedFetch && window.fetch === patchedFetch ) {
				window.fetch = origFetch;
			}
			if ( XMLHttpRequest.prototype.open === patchedOpen ) {
				XMLHttpRequest.prototype.open = origOpen;
			}
			if ( XMLHttpRequest.prototype.send === patchedSend ) {
				XMLHttpRequest.prototype.send = origSend;
			}
		};
	}

	// Register the mount callback on the global registry the shell
	// reads when syncing widgets declared via
	// `desktop_mode_register_widget()`. No `whenReady` dance, no
	// `wp.desktop.registerWidget` call — the shell owns picker
	// lifecycle, we just hand it the function to run on mount.
	//
	// Keying on the same id the PHP side passed to
	// `desktop_mode_register_widget()` is the contract between the
	// two halves.
	window.wpDesktopWidgets = window.wpDesktopWidgets || {};
	window.wpDesktopWidgets[ WIDGET_ID ] = mountMonitor;
}() );
