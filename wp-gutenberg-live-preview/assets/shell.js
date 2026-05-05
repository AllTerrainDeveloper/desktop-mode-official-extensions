/**
 * Gutenberg Live Preview — parent shell coordinator.
 *
 * Built on the wp-desktop-mode 0.18.x primitives:
 *   - registerWindow({ iframeContent }) — shell owns the iframe
 *     lifecycle, source validation, and the queued-until-ready
 *     `send()` closure.
 *   - Window.setHighlight / setTitle — drive the spotlight ring
 *     and stream the draft title into the window chrome.
 *
 * The editor sidebar (running inside the chromeless iframe) calls
 * `window.top.wpglpShell.openPreviewFor(iframeWindow)` via the
 * documented same-origin shortcut. From there:
 *   1. find the DesktopWindow whose iframe.contentWindow is the
 *      caller (so the editor doesn't have to learn its own id);
 *   2. open the native preview window with `iframeContent`;
 *   3. open a wp.desktop.connect() against the editor window,
 *      subscribed to `wpglp:content`;
 *   4. forward each payload into the preview frame via the `send`
 *      closure handed to us by `iframeContent.onReady`.
 *
 * Closing either window tears the rest down.
 */
( function () {
	const PREVIEW_ID    = 'wpglp/preview';
	const TOPIC         = 'wpglp:content';
	const TOPIC_HELLO   = 'wpglp:hello';
	const BASE_TITLE    = 'Live Preview';
	const OWNER         = 'wpglp-shell';

	const cfg = window.wpglpShellConfig || {};

	const state = {
		connection:    null, // WindowConnection (parent → editor iframe)
		previewWindow: null, // DesktopWindow (native, with iframeContent)
		editorWindowId: null, // editor window id we're connected to —
		                     // tracked so the WINDOW_CLOSED handler
		                     // below can tear down the preview when
		                     // the editor closes, independent of the
		                     // connection bridge's own onClose path.
		renderVersion: 0,    // monotonic counter — swallow stale REST responses
	};

	function withLiveFlag( url ) {
		if ( typeof url !== 'string' || ! url ) {
			return url;
		}
		return url + ( url.indexOf( '?' ) === -1 ? '?' : '&' ) + 'wpglp_live=1';
	}

	function ready( cb ) {
		if ( window.wp && wp.desktop && wp.desktop.windowManager ) {
			cb();
			return;
		}
		document.addEventListener( 'wp-desktop-init', cb, { once: true } );
	}

	function findEditorWindow( cw ) {
		const all = wp.desktop.windowManager.getAll();
		for ( let i = 0; i < all.length; i++ ) {
			const w = all[ i ];
			if ( w.iframe && w.iframe.contentWindow === cw ) {
				return w;
			}
		}
		return null;
	}

	function teardown() {
		if ( state.connection ) {
			try { state.connection.disconnect(); } catch ( _e ) {}
			state.connection = null;
		}
		if ( state.previewWindow ) {
			try { state.previewWindow.close(); } catch ( _e ) {}
			state.previewWindow = null;
		}
		state.editorWindowId = null;
	}

	ready( () => {
		const desktop = wp.desktop;

		window.wpglpShell = {
			openPreviewFor( iframeWindow, opts ) {
				opts = opts || {};
				const editor = findEditorWindow( iframeWindow );
				if ( ! editor ) {
					return null;
				}
				const previewUrl = withLiveFlag( opts.previewUrl );
				if ( ! previewUrl ) {
					return null;
				}

				if ( state.connection ) {
					try { state.connection.disconnect(); } catch ( _e ) {}
					state.connection = null;
				}

				state.previewWindow = desktop.registerWindow( {
					id:        PREVIEW_ID,
					title:     BASE_TITLE,
					icon:      'dashicons-visibility',
					width:     780,
					height:    600,
					minWidth:  360,
					minHeight: 280,
					autofocus: true,
					iframeContent: {
						url: previewUrl,
					},
				} );

				if ( state.previewWindow && typeof state.previewWindow.setHighlight === 'function' ) {
					state.previewWindow.setHighlight( 'persistent' );
				}

				state.editorWindowId = editor.id;
				state.connection = desktop.connect( editor.id, {
					topics: [ TOPIC ],
					onOpen: () => {
						// Force the iframe to publish its current
						// state right after the handshake completes.
						// Independent of iframe-side `onConnection`
						// timing — any post that already has content
						// shows up immediately instead of waiting
						// for the first keystroke.
						try {
							state.connection.send( TOPIC_HELLO, {} );
						} catch ( _e ) {}
					},
					onClose: ( reason ) => {
						state.connection = null;
						if ( reason !== 'disconnect' ) {
							teardown();
						}
					},
				} );
				state.connection.subscribe( TOPIC, async ( payload ) => {
					if ( ! payload || typeof payload !== 'object' ) {
						return;
					}
					const title   = typeof payload.title === 'string' ? payload.title : '';
					const content = typeof payload.content === 'string' ? payload.content : '';
					const postId  = typeof payload.postId === 'number' ? payload.postId : 0;

					// Title updates immediately — cheap and feels
					// responsive while we wait for the render.
					if (
						state.previewWindow &&
						typeof state.previewWindow.setTitle === 'function'
					) {
						state.previewWindow.setTitle(
							title ? BASE_TITLE + ' — ' + title : BASE_TITLE
						);
					}

					// Run the content through the server's full
					// `the_content` pipeline so dynamic blocks
					// (`wp:icon`, Query Loop, Latest Posts, …)
					// resolve to real HTML. Without this, the in-
					// place patcher would just paste raw block
					// markup into `.entry-content` and dynamic
					// blocks would render as their HTML-comment
					// placeholder.
					const myVersion = ++state.renderVersion;
					let rendered    = content;
					if ( cfg.renderUrl ) {
						try {
							const res = await fetch( cfg.renderUrl, {
								method:      'POST',
								credentials: 'same-origin',
								headers:     {
									'Content-Type': 'application/json',
									'X-WP-Nonce':   cfg.nonce || '',
								},
								body: JSON.stringify( { content, post_id: postId } ),
							} );
							// Bail if a newer payload arrived while we
							// were waiting — keeps fast typers from
							// briefly seeing stale renders.
							if ( myVersion < state.renderVersion ) {
								return;
							}
							if ( res.ok ) {
								const data = await res.json();
								if ( typeof data.html === 'string' ) {
									rendered = data.html;
								}
							}
						} catch ( _e ) {
							// Network error — fall back to raw
							// markup so static blocks still update.
						}
					}

					if ( myVersion < state.renderVersion ) {
						return;
					}

					if ( state.previewWindow && typeof state.previewWindow.iframeSend === 'function' ) {
						state.previewWindow.iframeSend(
							{ type: 'wpglp:render', title, content: rendered },
							{ coalesce: true }
						);
					}
				} );

				return editor.id;
			},

			closePreview() {
				teardown();
			},
		};

		// Title-bar button on the preview window — opens a tiny
		// popover with the plugin version. Just a smoke test for
		// the title-bar button hook; click toggles the popover,
		// outside-click closes it.
		if ( typeof desktop.registerTitleBarButton === 'function' ) {
			desktop.registerTitleBarButton( {
				// Title-bar registry validator rejects slashes
				// (`/^[a-z0-9_-]+$/`) — unlike the native-window
				// and command registries which accept `slug/sub`.
				id:        'wpglp-version',
				label:     'About Live Preview',
				icon:      'dashicons-info-outline',
				placement: 'right',
				order:     50,
				owner:     OWNER,
				match:     ( win ) => win && win.id === PREVIEW_ID,
				render:    ( host ) => {
					// `wpd-button-activate` is the canonical
					// once-per-gesture activation event on
					// <wpd-window-button>. The drag-exclusion fix
					// also makes plain `click` reliable on plugin
					// buttons, but `wpd-button-activate` is the
					// documented contract — prefer it.
					host.addEventListener( 'wpd-button-activate', () => {
						const existing = document.querySelector( '.wpglp-version-popover' );
						if ( existing ) {
							existing.remove();
							return;
						}

						const pop = document.createElement( 'div' );
						pop.className = 'wpglp-version-popover';
						pop.setAttribute( 'role', 'dialog' );
						pop.style.cssText = 'position:fixed;z-index:2147483646;background:#fff;color:#1e1e1e;border:1px solid rgba(0,0,0,0.18);border-radius:8px;padding:12px 14px;min-width:220px;font:13px/1.4 -apple-system,system-ui,"Segoe UI",sans-serif;box-shadow:0 12px 32px rgba(0,0,0,0.22);';
						pop.innerHTML =
							'<div style="font-weight:600;margin-bottom:6px;">Gutenberg Live Preview</div>' +
							'<div style="color:#555;margin-bottom:8px;">Plugin version <strong>v' + ( cfg.version || '?' ) + '</strong></div>' +
							'<div style="color:#888;font-size:11px;border-top:1px solid #eee;padding-top:8px;">Window id: ' + PREVIEW_ID + '</div>';

						const r = host.getBoundingClientRect();
						pop.style.top  = Math.max( 8, r.bottom + 6 ) + 'px';
						pop.style.left = Math.max( 8, Math.min( window.innerWidth - 240, r.right - 220 ) ) + 'px';

						document.body.appendChild( pop );

						// Defer the outside-click listener by one
						// tick so the same gesture that opened the
						// popover doesn't immediately close it.
						window.setTimeout( () => {
							const offClick = ( e ) => {
								if ( pop.contains( e.target ) || host.contains( e.target ) ) {
									return;
								}
								pop.remove();
								document.removeEventListener( 'mousedown', offClick, true );
							};
							document.addEventListener( 'mousedown', offClick, true );
						}, 0 );
					} );
				},
			} );
		}

		const closedHook = desktop.HOOKS && desktop.HOOKS.WINDOW_CLOSED;
		if ( desktop.hooks && closedHook ) {
			desktop.hooks.addAction( closedHook, 'wpglp/cleanup', ( payload ) => {
				if ( ! payload || ! payload.windowId ) {
					return;
				}
				// The preview window itself closed — drop the
				// connection but don't try to close a window we're
				// already inside the close-handler of.
				if ( payload.windowId === PREVIEW_ID ) {
					state.previewWindow  = null;
					state.editorWindowId = null;
					if ( state.connection ) {
						try { state.connection.disconnect(); } catch ( _e ) {}
						state.connection = null;
					}
					return;
				}
				// The editor window we're connected to closed —
				// tear the preview down too. We track this directly
				// instead of relying solely on the connection
				// bridge's own onClose path; the bridge's
				// auto-disconnect-on-window-close runs as an action
				// listener too, so order isn't guaranteed.
				if ( payload.windowId === state.editorWindowId ) {
					teardown();
				}
			} );
		}
	} );
} )();
