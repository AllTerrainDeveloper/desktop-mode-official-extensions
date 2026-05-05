/**
 * Messages chat window — the lazy bundle the native window
 * registration enqueues. Hydrates against the
 * `data-wpdm-messages-*` selectors in the template body, mounts
 * the conversation list / thread / composer, and updates state
 * when the window gains / loses focus or visibility.
 *
 * @since 0.22.0
 */

import { __ } from './wp';
import { mountComposer } from './views/composer';
import { mountConversationList } from './views/conversation-list';
import { mountDirectory } from './directory';
import { mountThread } from './views/thread';
import {
	clearUnreadForConversation,
	getState,
	setFocusedConversation,
	setMessagesForConversation,
	setWindowFocused,
	setWindowMounted,
	subscribe,
	upsertConversation,
} from './state';
import { fetchMessages, listConversations, markRead } from './transport/rest';
import type { ConversationSummary } from './types';

/**
 * The PHP-registered native window path (`desktop_mode_register_window`
 * + `wpDesktopNativeWindows[id]`) calls the render callback with ONLY
 * the body element — there is NO context object. Lifecycle plumbing
 * has to ride document-level CustomEvents (`wp-desktop-window-focused`,
 * `wp-desktop-window-changed`, `wp-desktop-window-closed`) and filter
 * by `windowId === MESSAGES_WINDOW_ID`.
 */
type RenderCallback = ( body: HTMLElement ) => ( () => void ) | void;

const MESSAGES_WINDOW_ID = 'wpdm-messages';

const ROOT = '[data-wpdm-messages-root]';
const SIDEBAR_LIST = '[data-wpdm-messages-list]';
const MAIN = '[data-wpdm-messages-main]';
const PLACEHOLDER = '[data-wpdm-messages-placeholder]';
const THREAD = '[data-wpdm-messages-thread]';
const COMPOSER = '[data-wpdm-messages-composer]';

const renderCallback: RenderCallback = ( body ) => {
	const root = body.querySelector< HTMLElement >( ROOT );
	if ( ! root ) {
		return;
	}
	setWindowMounted( true );

	// Resolve the title element on the parent window chrome — used to
	// rename the window when a conversation is opened. Walks up from
	// the body to the window root and queries the title element. Fails
	// gracefully when the markup doesn't match (older shell builds).
	const setWindowTitle = ( title: string ): void => {
		const win = body.closest< HTMLElement >( '.wp-desktop-window' );
		const titleEl = win?.querySelector< HTMLElement >(
			'.wp-desktop-window__title-text, .wp-desktop-window__title',
		);
		if ( titleEl ) {
			titleEl.textContent = title;
		}
	};

	let directoryTeardown: ( () => void ) | null = null;
	const teardowns: Array< () => void > = [];

	const sidebarList = body.querySelector< HTMLElement >( SIDEBAR_LIST );
	const main = body.querySelector< HTMLElement >( MAIN );
	const placeholder = body.querySelector< HTMLElement >( PLACEHOLDER );
	const thread = body.querySelector< HTMLElement >( THREAD );
	const composer = body.querySelector< HTMLElement >( COMPOSER );

	if ( ! sidebarList || ! main || ! placeholder || ! thread || ! composer ) {
		// Template was customized away from the contract — fail loudly
		// in dev, silently in prod.
		// eslint-disable-next-line no-console
		console.warn( '[wpdm-messages] Template missing data-wpdm-messages-* hooks' );
		return;
	}

	// Open the directory on click of any `[data-wpdm-messages-new]`
	// element. Belt-and-suspenders: direct listener on every match
	// found at hydrate time, PLUS a body-level delegate that walks
	// `composedPath()` so a click on the inner shadow-DOM button or
	// a slotted dashicons span still gets routed.
	const wireNewChatButtons = (): void => {
		body.querySelectorAll< HTMLElement >( '[data-wpdm-messages-new]' )
			.forEach( ( btn ) => {
				if ( btn.dataset.wpdmNewWired === '1' ) {
					return;
				}
				btn.dataset.wpdmNewWired = '1';
				btn.addEventListener( 'click', ( ev ) => {
					ev.preventDefault();
					ev.stopPropagation();
					openDirectory();
				} );
			} );
	};
	wireNewChatButtons();

	const onBodyClick = ( ev: Event ): void => {
		const path = ( ev.composedPath() as Array< EventTarget > ) || [];
		for ( const node of path ) {
			if ( ! ( node instanceof Element ) ) {
				continue;
			}
			if ( node.hasAttribute( 'data-wpdm-messages-new' ) ) {
				ev.preventDefault();
				openDirectory();
				return;
			}
		}
	};
	body.addEventListener( 'click', onBodyClick );
	teardowns.push( () => body.removeEventListener( 'click', onBodyClick ) );

	const getCurrentConversation = (): ConversationSummary | null => {
		const id = getState().focusedConversationId;
		if ( id === null ) {
			return null;
		}
		return getState().conversations.find( ( c ) => c.id === id ) ?? null;
	};

	// Use inline `style.display` instead of the `hidden` attribute.
	// Author CSS (`.wpdm-messages__thread { display: flex }`) ties at
	// specificity with the user-agent `[hidden] { display: none }`
	// rule, so the source-order winner is unpredictable across CSS
	// loading orders. Inline style ALWAYS wins.
	const showThread = (): void => {
		placeholder.style.display = 'none';
		thread.style.display = 'flex';
		composer.style.display = 'flex';
		placeholder.hidden = true;
		thread.hidden = false;
		composer.hidden = false;
	};
	const showPlaceholder = (): void => {
		placeholder.style.display = 'flex';
		thread.style.display = 'none';
		composer.style.display = 'none';
		placeholder.hidden = false;
		thread.hidden = true;
		composer.hidden = true;
	};
	// Seed the initial visual state from `state.focusedConversationId`.
	// `subscribe` only fires on FUTURE notifies, so a nudge that set
	// focused BEFORE the window opens needs the initial read here —
	// otherwise we'd land on the placeholder until the next state
	// change.
	const seededFocusedId = getState().focusedConversationId;
	// `seededTitleApplied` mirrors whether the seeded conv had its
	// summary in `state.conversations` at mount — i.e. whether
	// setWindowTitle could resolve a real display name. When false,
	// we leave `lastFocusedId` at null so the focusUnsub subscriber's
	// FIRST run treats the seeded id as a transition and re-runs the
	// title resolution after the conv has hydrated.
	let seededTitleApplied = false;
	if ( seededFocusedId !== null ) {
		showThread();
		void hydrateMessages( seededFocusedId );
		const seededConv = getCurrentConversation();
		if ( seededConv ) {
			setWindowTitle(
				seededConv.otherUser?.displayName ?? __( 'Messages' ),
			);
			seededTitleApplied = true;
		}
	} else {
		showPlaceholder();
	}

	teardowns.push(
		mountConversationList( {
			host: sidebarList,
			onSelect: ( c ) => {
				setFocusedConversation( c.id );
				void hydrateMessages( c.id );
				showThread();
				setWindowTitle( c.otherUser?.displayName ?? __( 'Messages' ) );
			},
			onStartNew: () => openDirectory(),
		} ),
	);

	const threadHostInner = document.createElement( 'div' );
	threadHostInner.className = 'wpdm-messages__thread-inner';
	thread.appendChild( threadHostInner );

	teardowns.push(
		mountThread( {
			host: threadHostInner,
			getConversation: getCurrentConversation,
			getConversationId: () => getState().focusedConversationId,
			onMarkRead: ( lastReadId ) => {
				const id = getState().focusedConversationId;
				if ( id === null ) {
					return;
				}
				// Optimistic clear so the sidebar badge drops to 0
				// immediately. The next heartbeat tick (~5s) confirms.
				clearUnreadForConversation( id );
				void markRead( id, lastReadId ).catch( () => undefined );
			},
		} ),
	);

	teardowns.push(
		mountComposer( {
			host: composer,
			getConversation: getCurrentConversation,
		} ),
	);

	function openDirectory(): void {
		if ( directoryTeardown ) {
			directoryTeardown();
		}
		const sheet = document.createElement( 'div' );
		sheet.className = 'wpdm-messages__directory-sheet';
		main!.appendChild( sheet );
		directoryTeardown = mountDirectory( {
			host: sheet,
			onClose: () => {
				if ( directoryTeardown ) {
					directoryTeardown();
					directoryTeardown = null;
				}
				sheet.remove();
				const c = getCurrentConversation();
				if ( c ) {
					showThread();
				} else {
					showPlaceholder();
				}
			},
		} );
		// While the directory is open, hide the placeholder + thread.
		placeholder!.hidden = true;
		thread!.hidden = true;
		composer!.hidden = true;
	}

	// Lifecycle subscriptions — the PHP-registered native window path
	// doesn't pass a ctx, so we ride document-level CustomEvents the
	// shell already dispatches and filter by windowId.
	const onWindowFocused = ( ev: Event ): void => {
		const detail = ( ev as CustomEvent< { windowId?: string } > ).detail;
		setWindowFocused( detail?.windowId === MESSAGES_WINDOW_ID );
	};
	const onWindowChanged = ( ev: Event ): void => {
		const detail = ( ev as CustomEvent< { windowId?: string; state?: string } > ).detail;
		if ( detail?.windowId !== MESSAGES_WINDOW_ID ) {
			return;
		}
		// Minimized → window is conceptually unmounted from the user's
		// perspective even though our DOM is still attached.
		setWindowMounted( detail.state !== 'minimized' );
	};
	const onWindowClosed = ( ev: Event ): void => {
		const detail = ( ev as CustomEvent< { windowId?: string } > ).detail;
		if ( detail?.windowId !== MESSAGES_WINDOW_ID ) {
			return;
		}
		setWindowMounted( false );
		setWindowFocused( false );
	};

	// `lastFocusedId` is referenced by both `onWindowReopened`
	// (declared right below) and by the focus-state subscriber
	// further down. Declared up here so both close over the same
	// binding. Seeded from the initial state ONLY IF the seeded
	// title was actually applied above; otherwise null so the first
	// notify (which usually brings the hydrated conv) re-runs the
	// title resolution.
	let lastFocusedId: number | null = seededTitleApplied
		? seededFocusedId
		: null;

	// Framework `wp-desktop-window-reopened` fires whenever
	// `desktop.openWindow('wpdm-messages')` is called on an already-
	// open window — the unambiguous "user requested an open" signal.
	// Used here to (a) close the directory sheet if it was over the
	// thread, and (b) force the thread + conv-list to re-paint
	// against `state.focusedConversationId` even if the upstream
	// state-subscription path (which should also trigger a repaint)
	// silently drops the notify in some race we haven't tracked
	// down. Belt-and-suspenders: if state subs fire correctly, this
	// is a cheap no-op repaint; if they don't, this is the bug fix.
	const onWindowReopened = ( ev: Event ): void => {
		const detail = ( ev as CustomEvent< { windowId?: string } > ).detail;
		if ( detail?.windowId !== MESSAGES_WINDOW_ID ) {
			return;
		}
		// Close any open directory sheet — a reopen call means the
		// caller wants to land on a specific thread, and the directory
		// would visually mask it.
		if ( directoryTeardown ) {
			directoryTeardown();
			directoryTeardown = null;
			body.querySelectorAll( '.wpdm-messages__directory-sheet' )
				.forEach( ( el ) => el.remove() );
		}
		// Force the focus-driven UI sync to re-evaluate against the
		// current state. Resetting `lastFocusedId` to `null` makes the
		// title-and-hydrate path below treat the current focused id as
		// a fresh transition even when nothing changed in `state`.
		lastFocusedId = null;
		const currentFocus = getState().focusedConversationId;
		if ( currentFocus !== null ) {
			showThread();
			void hydrateMessages( currentFocus );
			const conv = getCurrentConversation();
			if ( conv ) {
				setWindowTitle(
					conv.otherUser?.displayName ?? __( 'Messages' ),
				);
				lastFocusedId = currentFocus;
			}
		} else {
			showPlaceholder();
		}
	};
	document.addEventListener( 'wp-desktop-window-focused', onWindowFocused );
	document.addEventListener( 'wp-desktop-window-changed', onWindowChanged );
	document.addEventListener( 'wp-desktop-window-closed', onWindowClosed );
	document.addEventListener( 'wp-desktop-window-reopened', onWindowReopened );
	teardowns.push( () => {
		document.removeEventListener( 'wp-desktop-window-focused', onWindowFocused );
		document.removeEventListener( 'wp-desktop-window-changed', onWindowChanged );
		document.removeEventListener( 'wp-desktop-window-closed', onWindowClosed );
		document.removeEventListener( 'wp-desktop-window-reopened', onWindowReopened );
	} );

	// Initial focused state — opening a window also focuses it, but
	// the focus event is dispatched BEFORE the render callback runs,
	// so we read the manager's current focused id directly to seed.
	const wp = ( window as unknown as {
		wp?: { desktop?: { windowManager?: { getFocused?: () => { id?: string } | null } } };
	} ).wp;
	const focused = wp?.desktop?.windowManager?.getFocused?.();
	if ( focused?.id === MESSAGES_WINDOW_ID ) {
		setWindowFocused( true );
	}

	// Refresh conversation list every time the window is mounted.
	// At boot, the shell already hydrated, but a brand-new conversation
	// (started by the OTHER user since boot) only landed in state via
	// `handleIncomingMessage` -> `hydrateInitial`. If the user opens
	// the chat window AFTER seeing the toast but BEFORE the poller has
	// re-fetched conversations, the sidebar would render stale. Cheap
	// to refire on every mount: one REST GET.
	void listConversations()
		.then( ( out ) => {
			for ( const c of out.conversations ) {
				upsertConversation( c );
			}
		} )
		.catch( () => undefined );

	// Repaint placeholder/thread visibility when the focused
	// conversation changes externally (directory, public API, or an
	// inbound nudge that auto-focused a different dyad).
	//
	// Mirrors the click-to-select side-effects (hydrate messages,
	// refresh window title) ONLY on actual transitions — every state
	// notify runs this listener, so we'd otherwise refetch + retitle
	// on every poll tick. The shared `lastFocusedId` binding above is
	// what tracks that.
	const focusUnsub = subscribe( ( state ) => {
		const id = state.focusedConversationId;
		if ( id === null ) {
			showPlaceholder();
			lastFocusedId = null;
			return;
		}
		showThread();
		if ( id !== lastFocusedId ) {
			lastFocusedId = id;
			void hydrateMessages( id );
			const conv = getCurrentConversation();
			if ( conv ) {
				setWindowTitle(
					conv.otherUser?.displayName ?? __( 'Messages' ),
				);
			} else {
				// Conv summary still in flight — let the next notify
				// (after `hydrateInitial` resolves) try again.
				lastFocusedId = null;
			}
		}
	} );
	teardowns.push( focusUnsub );

	// Set initial title (idempotent — the PHP template already has
	// "Messages", so this is a no-op on first open and only matters
	// when the conversation list lands on a previously-selected dyad).
	setWindowTitle( __( 'Messages' ) );

	return () => {
		setWindowMounted( false );
		setWindowFocused( false );
		if ( directoryTeardown ) {
			directoryTeardown();
		}
		for ( const fn of teardowns ) {
			try {
				fn();
			} catch ( _err ) {
				// silent
			}
		}
	};
};

/**
 * Fetch the message history for a conversation if we don't already
 * have it in state. Cheap re-fetches are fine — the SSE / Heartbeat
 * channel keeps the cache eventually consistent anyway.
 */
async function hydrateMessages( conversationId: number ): Promise< void > {
	const state = getState();
	if ( state.messagesByConversation.has( conversationId ) ) {
		return;
	}
	try {
		const out = await fetchMessages( conversationId, { limit: 50 } );
		setMessagesForConversation( conversationId, out.messages );
	} catch ( _err ) {
		// silent — empty thread shows the empty state.
	}
}

const w = window as unknown as {
	wpDesktopNativeWindows?: Record< string, unknown >;
};
w.wpDesktopNativeWindows = w.wpDesktopNativeWindows ?? {};
w.wpDesktopNativeWindows[ 'wpdm-messages' ] = renderCallback;
