/**
 * Gutenberg Live Preview — editor (iframe) side.
 *
 * Pinned PluginSidebar with the eye icon. Inside, a single
 * Connect / Connected MenuItem. Hover/focus spotlights the preview
 * window via Window.setHighlight on the parent shell. Click toggles
 * the bridge connection — the parent-side coordinator
 * (`window.top.wpglpShell`) opens the native preview window and
 * `wp.desktop.connect()`s back to this iframe; we publish
 * `wpglp:content` debounced 500 ms.
 *
 * `wp.desktop.iframe` is auto-enqueued for every desktop-mode user
 * since wp-desktop-mode 0.18.x, so we can rely on it being present
 * by the time the user clicks Connect — no polling fallback needed.
 */
( function ( wp ) {
	if ( ! wp || ! wp.plugins || ! wp.element || ! wp.components || ! wp.data ) {
		return;
	}

	const { registerPlugin }                              = wp.plugins;
	// `wp.editor` is canonical since WP 6.6; `wp.editPost` is the
	// deprecated namespace that emits a console warning. Prefer the
	// new namespace and fall back for older WP installs.
	const editorNs                                        = wp.editor || wp.editPost || {};
	const { PluginSidebar, PluginSidebarMoreMenuItem }    = editorNs;
	const { PanelBody, MenuGroup, MenuItem, Notice }      = wp.components;
	const { createElement: el, Fragment, useState, useEffect } = wp.element;
	const { __ }                                          = wp.i18n;

	const PREVIEW_ID  = 'wpglp/preview';
	const TOPIC       = 'wpglp:content';
	const TOPIC_HELLO = 'wpglp:hello';
	const SIDEBAR     = 'wpglp-live-preview';
	const TITLE       = __( 'Live Preview', 'wpglp' );

	function getDesktop() {
		try {
			if ( window.top && window.top !== window && window.top.wp && window.top.wp.desktop ) {
				return window.top.wp.desktop;
			}
		} catch ( _e ) { /* cross-origin */ }
		return null;
	}

	function getShellHelper() {
		try {
			return window.top && window.top.wpglpShell ? window.top.wpglpShell : null;
		} catch ( _e ) {
			return null;
		}
	}

	function getPreview() {
		const d = getDesktop();
		return d ? d.windowManager.getById( PREVIEW_ID ) : null;
	}

	function highlight( mode ) {
		const win = getPreview();
		if ( win && typeof win.setHighlight === 'function' ) {
			win.setHighlight( mode );
		}
	}

	function LivePreviewPanel() {
		const [ connected, setConnected ] = useState( () => !! getPreview() );

		useEffect( () => {
			const d = getDesktop();
			const closedHook = d && d.HOOKS && d.HOOKS.WINDOW_CLOSED;
			if ( ! d || ! d.hooks || ! closedHook ) {
				return;
			}
			const handler = ( payload ) => {
				if ( payload && payload.windowId === PREVIEW_ID ) {
					setConnected( false );
				}
			};
			d.hooks.addAction( closedHook, 'wpglp/track-close', handler );
			return () => d.hooks.removeAction( closedHook, 'wpglp/track-close' );
		}, [] );

		const desktopAvailable = !! getDesktop() && !! getShellHelper();

		if ( ! desktopAvailable ) {
			return el(
				PanelBody,
				{ title: TITLE, initialOpen: true },
				el(
					Notice,
					{ status: 'info', isDismissible: false },
					__( 'Enable Desktop Mode to use Live Preview.', 'wpglp' )
				)
			);
		}

		const [ saving, setSaving ] = useState( false );

		const onConnect = async () => {
			console.log( '[wpglp:editor] Connect clicked' );
			const shell = getShellHelper();
			if ( ! shell ) {
				console.warn( '[wpglp:editor] no shell helper' );
				return;
			}
			const editorSelect   = wp.data.select( 'core/editor' );
			const editorDispatch = wp.data.dispatch( 'core/editor' );
			if ( ! editorSelect || ! editorDispatch ) {
				console.warn( '[wpglp:editor] no core/editor store' );
				return;
			}

			const postId   = editorSelect.getCurrentPostId();
			const status   = editorSelect.getEditedPostAttribute && editorSelect.getEditedPostAttribute( 'status' );
			const isDirty  = editorSelect.isEditedPostDirty && editorSelect.isEditedPostDirty();
			const linkBefore = editorSelect.getEditedPostPreviewLink && editorSelect.getEditedPostPreviewLink();
			console.log( '[wpglp:editor] state before save:', { postId, status, isDirty, linkBefore } );

			// `auto-draft` is the placeholder status WP assigns when
			// the editor opens for a new post — it has an id and a
			// preview URL, but the front end routes it as 404 (and
			// the URL has no `preview_nonce` to bypass that gating).
			// Promote it to a real `draft` by calling savePost so
			// the preview URL becomes authenticated and resolvable.
			setSaving( true );
			try {
				// Step 1 — promote `auto-draft` to `draft`. Calling
				// `savePost()` directly is a no-op for a blank
				// canvas (`isEditedPostSaveable` returns false when
				// title + content are both empty). Explicitly editing
				// the status field marks the post dirty, then
				// savePost actually pushes the change to the server.
				if ( status === 'auto-draft' ) {
					console.log( '[wpglp:editor] editPost status -> draft' );
					editorDispatch.editPost( { status: 'draft' } );
				}
				if ( status === 'auto-draft' || isDirty || ! postId ) {
					console.log( '[wpglp:editor] calling savePost()' );
					const r1 = await editorDispatch.savePost();
					console.log( '[wpglp:editor] savePost resolved with', r1, 'status now', editorSelect.getEditedPostAttribute( 'status' ) );
				}
				// Step 2 — create the autosave revision that
				// populates `preview_link` with `preview_id` +
				// `preview_nonce`. Without this autosave,
				// `getEditedPostPreviewLink()` returns the public
				// permalink with `?preview=true` only — no nonce, so
				// WP's `is_preview()` returns false and the front
				// end serves a 404 for the still-non-public draft.
				console.log( '[wpglp:editor] calling savePost({isPreview:true})' );
				const r2 = await editorDispatch.savePost( { isPreview: true } );
				console.log( '[wpglp:editor] preview-save resolved with', r2 );
			} catch ( err ) {
				setSaving( false );
				console.warn( '[wpglp:editor] save chain rejected', err );
				return;
			}
			setSaving( false );

			const newPostId = editorSelect.getCurrentPostId();
			const newStatus = editorSelect.getEditedPostAttribute( 'status' );
			console.log( '[wpglp:editor] state after save:', { newPostId, newStatus } );

			// Build the preview URL server-side via our REST
			// endpoint. WP's `get_preview_post_link()` always
			// returns a nonce-authenticated URL regardless of
			// whether the post has an autosave revision — sidesteps
			// the entire Gutenberg `isEditedPostAutosaveable`
			// dance that was returning empty preview URLs for
			// blank-canvas posts.
			let finalUrl = null;
			try {
				const result = await wp.apiFetch( {
					path: wp.url.addQueryArgs( '/wpglp/v1/preview-url', { post_id: newPostId } ),
				} );
				finalUrl = result && typeof result.url === 'string' ? result.url : null;
				console.log( '[wpglp:editor] preview URL from server:', finalUrl );
			} catch ( err ) {
				console.warn( '[wpglp:editor] preview-url fetch failed', err );
			}

			if ( ! finalUrl ) {
				console.warn( '[wpglp:editor] no preview URL available' );
				return;
			}

			console.log( '[wpglp:editor] calling shell.openPreviewFor with', finalUrl );
			const opened = shell.openPreviewFor( window, { previewUrl: finalUrl } );
			console.log( '[wpglp:editor] openPreviewFor returned', opened );
			setConnected( true );
		};

		const onDisconnect = () => {
			const shell = getShellHelper();
			if ( shell ) {
				shell.closePreview();
			}
			setConnected( false );
		};

		const label = saving
			? __( 'Saving draft…', 'wpglp' )
			: ( connected ? __( 'Connected', 'wpglp' ) : __( 'Connect', 'wpglp' ) );
		const icon  = saving ? 'update' : ( connected ? 'yes' : 'admin-links' );

		return el(
			PanelBody,
			{ title: TITLE, initialOpen: true },
			el(
				'p',
				{ className: 'wpglp-help' },
				__( 'Hover an option to spotlight the preview window. Selecting Connect opens it and starts streaming this draft.', 'wpglp' )
			),
			el(
				MenuGroup,
				null,
				el(
					MenuItem,
					{
						icon,
						onMouseEnter: () => highlight( 'preview' ),
						onMouseLeave: () => highlight( connected ? 'persistent' : null ),
						onFocus:      () => highlight( 'preview' ),
						onBlur:       () => highlight( connected ? 'persistent' : null ),
						onClick:      saving ? undefined : ( connected ? onDisconnect : onConnect ),
						disabled:     saving,
						className:    connected ? 'wpglp-item is-connected' : 'wpglp-item',
					},
					label
				)
			)
		);
	}

	registerPlugin( 'wpglp-live-preview', {
		icon: 'visibility',
		render() {
			return el(
				Fragment,
				null,
				PluginSidebarMoreMenuItem
					? el(
						PluginSidebarMoreMenuItem,
						{ target: SIDEBAR, icon: 'visibility' },
						TITLE
					)
					: null,
				PluginSidebar
					? el(
						PluginSidebar,
						{ name: SIDEBAR, title: TITLE, icon: 'visibility' },
						el( LivePreviewPanel )
					)
					: null
			);
		},
	} );

	/* ------------------------------------------------------------------
	 * Always-on publisher.
	 *
	 * `wp.desktop.iframe.publish` is a no-op when no parent caller
	 * has connected, so the only cost before Connect is one
	 * selector read per debounced tick. The onConnection hook
	 * re-publishes the latest snapshot immediately so the preview
	 * frame doesn't sit empty.
	 * ------------------------------------------------------------------ */
	( function setupPublisher() {
		if ( ! wp.data || ! wp.data.subscribe ) {
			return;
		}

		// Sentinel — guarantees the first publish per session goes
		// through even when the post is brand-new (empty title +
		// empty content). Comparing against '' would dedup the very
		// first call into a no-op.
		let lastSig = null;
		let timer   = 0;

		function publishNow() {
			if ( ! wp.desktop || ! wp.desktop.iframe || typeof wp.desktop.iframe.publish !== 'function' ) {
				return;
			}
			const editor = wp.data.select( 'core/editor' );
			if ( ! editor ) {
				return;
			}
			const content = editor.getEditedPostContent ? editor.getEditedPostContent() : '';
			const title   = editor.getEditedPostAttribute ? ( editor.getEditedPostAttribute( 'title' ) || '' ) : '';
			const postId  = editor.getCurrentPostId ? editor.getCurrentPostId() : 0;
			const sig     = title + '' + content;
			if ( sig === lastSig ) {
				return;
			}
			lastSig = sig;
			wp.desktop.iframe.publish( TOPIC, { title, content, postId } );
		}

		wp.data.subscribe( () => {
			window.clearTimeout( timer );
			timer = window.setTimeout( publishNow, 500 );
		} );

		if ( wp.desktop && wp.desktop.iframe ) {
			// Fast path — fire on handshake.
			if ( typeof wp.desktop.iframe.onConnection === 'function' ) {
				wp.desktop.iframe.onConnection( () => {
					lastSig = null;
					publishNow();
				} );
			}
			// Belt-and-suspenders — the parent shell sends a
			// `wpglp:hello` right after subscribing. Independent of
			// `onConnection` timing, so the preview frame populates
			// even on posts that already have content (no wait for
			// the first keystroke to break dedup).
			if ( typeof wp.desktop.iframe.subscribe === 'function' ) {
				wp.desktop.iframe.subscribe( TOPIC_HELLO, () => {
					lastSig = null;
					publishNow();
				} );
			}
		}
	} )();
} )( window.wp );
