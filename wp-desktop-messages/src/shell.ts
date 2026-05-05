/**
 * Always-loaded messages shell — runs on every desktop-mode page,
 * even when the chat window has never been opened. Owns the
 * always-on plumbing:
 *
 *   - Heartbeat probe (delivery + presence when chat window closed).
 *   - SSE leader election (one tab per browser session holds SSE).
 *   - SSE client (only the leader connects).
 *   - Sound preload + autoplay primer.
 *   - Toast / dock-attention on incoming-while-not-focused.
 *   - Exposes `wp.desktop.messages.*` API.
 *   - Registers the OS Settings tab.
 *
 * @since 0.22.0
 */

import { __, applyPresenceBatch, showToast } from './wp';
import {
	openAndShakeMessagesWindow,
	requestMessagesAttention,
} from './attention';
import { startMessagesBadgePolicy } from './badge-policy';
import { registerMessagesSettingsTab } from './settings-tab';
import { installAutoplayPrimer, soundRegistry } from './sounds';
import {
	appendMessage,
	bumpUnread,
	getState,
	setFocusedConversation,
	setSounds,
	setSettings,
	setTyping,
	setUnread,
	subscribe,
	upsertConversation,
} from './state';
import { startHeartbeatProbe, computeUserActive } from './transport/heartbeat';
import { MessagesLeader } from './transport/leader';
import { MessagesPoller, type PollerState } from './transport/poller';
import { MessagesSseClient } from './transport/sse';
import {
	fetchMessages,
	fetchSince,
	fetchSounds,
	listConversations,
	markRead,
	postNudge,
	postPresence,
	sendMessage as restSendMessage,
	startConversation,
} from './transport/rest';
import type {
	MessageRow,
	MessagesApi,
	PresenceStatus,
	SsePresencePayload,
	SseTypingPayload,
} from './types';

const CONFIG = (): Window[ 'wpDesktopMessagesConfig' ] | undefined =>
	window.wpDesktopMessagesConfig;

let lastSeenId = 0;
let lastUserInputMs = Date.now();

function noteUserActivity(): void {
	lastUserInputMs = Date.now();
}

// "I just sent this" tracking lives in `./self-sent` so the composer
// (in the lazy `messages` bundle) and the poller / SSE handlers (in
// the always-on `messages-shell` bundle) agree on the same set. The
// underlying store is built on `wp.desktop.createSharedStore` — see
// `src/shared-store.ts` for why a window-level singleton is required
// for cross-bundle state.
import { isSelfSent, markMessageAsSelfSent } from './self-sent';
export { markMessageAsSelfSent };

/**
 * Source-of-truth check: is the messages chat window currently
 * visible to the user?
 *
 * "Visible" means: the window exists in the manager AND its state
 * is not 'minimized'. Closed → invisible; minimized → invisible;
 * normal/maximized/snapped/fullscreen → visible.
 *
 * Belt-and-suspenders: queries the manager **and** falls back to
 * `state.windowMounted` if the manager lookup misses. The manager
 * lookup is the source of truth, but it can transiently return
 * `undefined` (e.g. during the openWindow → push-to-stack frame on
 * fast hosts, or before the messages-shell sees `wp.desktop` set up).
 * The `state.windowMounted` flag is set inside the chat window's
 * render callback — if it's true, the window has already been
 * mounted in this tab, so a toast for the same conversation would
 * stack directly next to the chat UI. We treat that as "visible"
 * even when the manager lookup briefly disagrees.
 */
function isMessagesWindowVisible(): boolean {
	const wp = ( window as unknown as {
		wp?: {
			desktop?: {
				windowManager?: {
					getById?: ( id: string ) => { state?: string } | null | undefined;
				};
			};
		};
	} ).wp;
	const win = wp?.desktop?.windowManager?.getById?.( 'wpdm-messages' );
	if ( win ) {
		return win.state !== 'minimized';
	}
	// Manager didn't find the window — fall back to the state flag.
	// `state.windowMounted` is set false on close + minimize, so it
	// only stays true while a chat UI is actively on screen.
	return getState().windowMounted;
}

/**
 * Boot the shell. Idempotent — running twice is a no-op.
 *
 * Wrapped in try/catch so a thrown error in any single subsystem
 * (poller, leader, settings tab, heartbeat) doesn't cascade into
 * "this script tag throws" — which would prevent any later `<script>`
 * (including third-party plugin shells that register OS Settings tabs)
 * from running.
 */
export function bootShell(): void {
	if ( ( window as unknown as { __wpdmMessagesShellBooted?: boolean } ).__wpdmMessagesShellBooted ) {
		return;
	}
	( window as unknown as { __wpdmMessagesShellBooted?: boolean } ).__wpdmMessagesShellBooted = true;

	const cfg = CONFIG();
	if ( ! cfg ) {
		return;
	}

	try {
		bootShellInternal( cfg );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[wpdm-messages] shell boot failed:', err );
	}
}

function bootShellInternal( cfg: NonNullable< ReturnType< typeof CONFIG > > ): void {
	soundRegistry.registerAll( cfg.sounds );
	setSounds( cfg.sounds, cfg.defaultSoundId );
	setSettings( cfg.userSettings );
	installAutoplayPrimer();

	// User-activity tracking for "inactive" presence detection.
	document.addEventListener( 'pointerdown', noteUserActivity, { capture: true, passive: true } );
	document.addEventListener( 'keydown', noteUserActivity, { capture: true, passive: true } );

	// Adaptive REST poller — the DEFAULT delivery channel. Cheap-host
	// friendly. Cadence shifts with the chat window state (see
	// computePollerState below).
	const poller = new MessagesPoller(
		{
			activeMs: cfg.pollIntervalActiveMs,
			idleMs: cfg.pollIntervalIdleMs,
			hiddenMs: cfg.pollIntervalHiddenMs,
			getCursor: () => lastSeenId,
			setCursor: ( id ) => {
				if ( id > lastSeenId ) {
					lastSeenId = id;
				}
			},
			getState: () => computePollerState(),
		},
		{
			onMessage: ( row ) => handleIncomingMessage( row ),
			onNudge: ( row ) => handleIncomingNudge( row ),
		},
	);

	// SSE client — only started when the admin has opted in via
	// Extended Options. Holds a long-lived PHP-FPM worker per active
	// admin tab; great on capable hosts, bad on cheap shared hosting.
	const sse = new MessagesSseClient( {
		onMessage: ( row ) => handleIncomingMessage( row ),
		onNudge: ( row ) => handleIncomingNudge( row ),
		onTyping: ( payload ) => handleTyping( payload ),
		onPresence: ( payload ) => handlePresence( payload ),
		onError: () => {
			// silent — `MessagesSseClient` handles reconnect; if SSE
			// drops, the poller is still running so messages still flow.
		},
		onState: ( state ) => {
			document.dispatchEvent(
				new CustomEvent( 'wp-desktop-messages-sse-state', {
					detail: { state, isLeader: leader.getLeaderState().isLeader },
				} ),
			);
		},
		// The SSE's per-instance lastEventId is initialised to 0; on
		// first connect it would otherwise ship `last_event_id=0` and
		// the server would replay every message in the user's inbox
		// (one toast per row). Read the SHELL's cursor lazily so the
		// connect URL reflects whatever bootstrap / poller / heartbeat
		// has already advanced.
		initialLastEventId: () => lastSeenId,
	} );
	sse.configure( {
		url: cfg.streamUrl,
		nonce: cfg.restNonce,
		reconnectMs: cfg.sseReconnectMs,
	} );

	// Leader election only matters when SSE is the active transport —
	// we don't want N tabs all holding their own SSE worker. Polling
	// is fine to run per-tab (tiny REST GET, no worker held).
	const leader = new MessagesLeader( {
		onBecameLeader: () => {
			document.dispatchEvent(
				new CustomEvent( 'wp-desktop-messages-leader-changed', {
					detail: { tabId: leader.getLeaderState().tabId, isLeader: true },
				} ),
			);
			if ( cfg.realtimeSseEnabled ) {
				sse.start();
			}
		},
		onLostLeadership: () => {
			document.dispatchEvent(
				new CustomEvent( 'wp-desktop-messages-leader-changed', {
					detail: { tabId: leader.getLeaderState().tabId, isLeader: false },
				} ),
			);
			sse.stop();
		},
		onEvent: ( payload ) => {
			// Follower — apply the leader's events locally.
			applyChannelEvent( payload );
		},
	} );

	// Stash the poller for visibility-change wake-up (without making
	// `bootShell` return it — keeps the public boot signature simple).
	// `pokeNow` / `rescheduleForState` are no-ops while the poller is
	// `stopped`, so wiring this BEFORE the bootstrap-gated `.start()`
	// below is safe.
	( window as unknown as {
		__wpdmMessagesPoller?: typeof poller;
	} ).__wpdmMessagesPoller = poller;

	// Repaint the dock badge + trigger poller cadence updates from
	// state changes (window mounted/focused).
	subscribe( () => {
		poller.rescheduleForState();
	} );

	// Heartbeat is reduced to: total-unread badge + messages-scoped
	// presence subset. The framework owns the Heartbeat-driven
	// presence record (`includes/presence.php` + `src/presence/`) —
	// this handler still carries the messages-scoped snapshot
	// because the conversation-list reads it for per-row dot
	// colours.
	startHeartbeatProbe( {
		getActiveFlag: () => true,
		getUserActiveFlag: () => computeUserActive( lastUserInputMs, getState().settings ),
		getLastSeenId: () => lastSeenId,
		onMessages: () => {
			// Delivery comes from the poller / SSE — ignore Heartbeat
			// `newSinceLastSeen` so we don't double-deliver. Kept the
			// payload in the response for plugins that may want it.
		},
		onPresence: ( batch ) =>
			applyPresenceBatch(
				batch.map( ( entry ) => ( {
					userId: entry.userId,
					status: entry.status,
				} ) ),
			),
		onUnread: ( total, byConv ) => {
			// Just push the data into state — `badge-policy.ts`
			// subscribes to `totalUnread` and decides what to
			// render. Keeping the heartbeat handler out of the
			// rendering business is the whole point of the
			// event-driven refactor (see
			// `docs/event-driven-framework.md`).
			setUnread( total, byConv );
		},
	} );

	// Now that state + lifecycle plumbing is in place, install the
	// badge-rendering policy. It owns deciding what number to
	// paint on the messages tile (zero while the window is
	// active, totalUnread otherwise) — the framework's
	// `Dock.setBadge` is a dumb renderer.
	startMessagesBadgePolicy();

	function computePollerState(): PollerState {
		if ( document.hidden ) {
			return 'hidden';
		}
		const s = getState();
		if ( s.windowMounted && s.windowFocused ) {
			return 'active';
		}
		return 'idle';
	}

	registerMessagesSettingsTab();

	// Boot order matters here:
	//   1. Pull history SILENTLY first — establishes the absolute
	//      `lastSeenId` watermark by reading the cursor returned by
	//      `/messages/since` (which the server computes via MAX(id),
	//      not the LIMIT-truncated payload max).
	//   2. THEN start the delivery channels (poller + optional SSE).
	//      Without this gate, a slow bootstrap could lose the race
	//      with the poller's first tick — the tick would call
	//      `/since?lastEventId=0`, the server returns the LIMIT-200
	//      oldest unseen messages, and `handleIncomingMessage`
	//      toasts every single one as "new". On a reload of an
	//      account with hundreds of historical messages, that
	//      manifests as the toast storm users were reporting.
	//   3. THEN hydrate conversations + sounds (cheap, parallel-safe).
	void bootstrapHistorySilently()
		.catch( () => undefined )
		.then( () => {
			// Always-on poller; even when SSE is enabled, polling
			// acts as a defensive secondary so dropped SSE events
			// don't strand the client.
			poller.start();
			if ( cfg.realtimeSseEnabled ) {
				leader.start();
			}
		} )
		.then( () => hydrateInitial() );

	// Public API surface.
	exposePublicApi();

	document.dispatchEvent(
		new CustomEvent( 'wp-desktop-messages-ready', {
			detail: { user: cfg.currentUserId, allowedRoles: cfg.allowedRoles },
		} ),
	);
}

async function hydrateInitial(): Promise< void > {
	try {
		const out = await listConversations();
		for ( const c of out.conversations ) {
			upsertConversation( c );
		}
	} catch ( _err ) {
		// silent
	}
	try {
		const sounds = await fetchSounds();
		soundRegistry.registerAll( sounds.sounds );
		setSounds( sounds.sounds, sounds.defaultSoundId );
	} catch ( _err ) {
		// silent
	}
}

/**
 * Boot-time silent history load: pull every message that exists in
 * the user's conversations and inject them into local state without
 * toasting / playing sound / pulsing the dock. Sets `lastSeenId` to
 * the highest id seen so the poller's next tick is a fresh-events
 * baseline — not a re-delivery of every unread message at boot.
 *
 * Without this step, every page reload fired a toast for every
 * unread message in history. The first poll tick saw `lastSeenId =
 * 0` and pulled every message > 0 (basically everything in the
 * user's threads), each running through `handleIncomingMessage`
 * which fires a toast on each.
 */
async function bootstrapHistorySilently(): Promise< void > {
	try {
		const out = await fetchSince( 0 );
		for ( const row of out.messages ) {
			appendMessage( row );
			if ( row.id > lastSeenId ) {
				lastSeenId = row.id;
			}
		}
		// Trust the server's cursor too — it may be ahead of any row
		// we received (it's the high-water mark).
		if ( typeof out.cursor === 'number' && out.cursor > lastSeenId ) {
			lastSeenId = out.cursor;
		}
	} catch ( _err ) {
		// silent
	}
}

function handleIncomingMessage( row: MessageRow ): void {
	if ( row.id <= lastSeenId ) {
		return;
	}
	lastSeenId = Math.max( lastSeenId, row.id );

	appendMessage( row );

	// If this is the first message we've seen for this conversation
	// (e.g., another user just started a chat with us), the sidebar
	// won't have an entry to render — appendMessage's "update the
	// summary" branch is also skipped. Refetch the list so the new
	// dyad surfaces. One REST GET, fires once per never-seen-before
	// conversation.
	if ( ! getState().conversations.some( ( c ) => c.id === row.conversationId ) ) {
		void hydrateInitial();
	}

	const state = getState();
	const cfg = CONFIG();
	const isOwn =
		( !! cfg && Number( row.authorId ) === Number( cfg.currentUserId ) ) ||
		isSelfSent( row.id );

	document.dispatchEvent(
		new CustomEvent( 'wp-desktop-messages-message-incoming', {
			detail: {
				message: row,
				conversationId: row.conversationId,
				isWindowFocused: state.windowFocused,
			},
		} ),
	);

	if ( isOwn ) {
		document.dispatchEvent(
			new CustomEvent( 'wp-desktop-messages-message-sent', {
				detail: { message: row, conversationId: row.conversationId },
			} ),
		);
		return;
	}

	const focusedHere = state.focusedConversationId === row.conversationId && state.windowFocused;

	// Optimistic unread bump for inbound, non-focused messages. The
	// next heartbeat tick (~5s) reconciles to server truth, but
	// without this the badge sits stale on `state.totalUnread` from
	// the prior tick and back-to-back arrivals never bump the count
	// until heartbeat catches up.
	if ( ! focusedHere ) {
		bumpUnread( row.conversationId );
	}

	if ( focusedHere ) {
		// Already on the conversation in a focused window — visual
		// thread update is enough; no toast / sound / pulse.
		return;
	}

	const conv = state.conversations.find( ( c ) => c.id === row.conversationId );
	const senderName = conv?.otherUser?.displayName ?? __( 'New message' );

	// Toast only when the chat window is GENUINELY not visible.
	// Source of truth = the window manager itself (queried below),
	// NOT my own `state.windowMounted` tracking — that's driven by
	// CustomEvent listeners which can fall out of sync with the
	// manager under any dropped event. Reading the manager directly
	// each time cannot drift.
	if ( ! isMessagesWindowVisible() && state.settings.showToast ) {
		toast( senderName, row );
	}

	// Sound: respect "play sound when window focused" preference.
	const shouldPlay =
		state.settings.soundWhileFocused || ! state.windowFocused;
	if ( shouldPlay ) {
		const id = state.settings.nudgeSoundId || state.defaultSoundId;
		soundRegistry.play( id, state.settings.volume );
	}

	// Pulse the dock/taskbar tile whenever the message isn't on the
	// currently focused conversation+window pair — that's true here
	// since the early-return above handled the focused case.
	requestMessagesAttention( 'pulse', 4000 );
}

function handleIncomingNudge( row: MessageRow ): void {
	if ( row.id <= lastSeenId ) {
		return;
	}
	lastSeenId = Math.max( lastSeenId, row.id );
	appendMessage( row );

	// First-touch hydration — same rationale as handleIncomingMessage.
	if ( ! getState().conversations.some( ( c ) => c.id === row.conversationId ) ) {
		void hydrateInitial();
	}

	// Two redundant self-checks. The composer marks ids it just sent
	// via `markMessageAsSelfSent` (cross-bundle shared store); the
	// authorId check is a backup. If EITHER matches, this row is our
	// own — never shake/sound/open for it.
	const cfg = CONFIG();
	const isOwnByAuthor =
		!! cfg && Number( row.authorId ) === Number( cfg.currentUserId );
	const isOwnBySent = isSelfSent( row.id );
	if ( isOwnByAuthor || isOwnBySent ) {
		return;
	}

	const state = getState();

	// Optimistic unread bump — same rationale as handleIncomingMessage.
	// A nudge that arrives while the user isn't focused on the
	// conversation should pop the badge immediately, not wait for the
	// heartbeat tick.
	const focusedHereForNudge =
		state.focusedConversationId === row.conversationId && state.windowFocused;
	if ( ! focusedHereForNudge ) {
		bumpUnread( row.conversationId );
	}

	const soundId =
		( row.payload && typeof row.payload.soundId === 'string' && row.payload.soundId ) ||
		state.settings.nudgeSoundId ||
		state.defaultSoundId;
	soundRegistry.play( soundId, state.settings.volume );
	// Nudges are explicit "look at me" requests — match MSN /
	// Slack semantics: surface the chat window (open if closed,
	// restore if minimized, focus if already open), focus the
	// conversation that initiated the nudge, and shake the window
	// itself. The dock-icon shake stays for the brief moment
	// before the window is on screen.
	requestMessagesAttention( 'shake', 1500 );
	setFocusedConversation( row.conversationId );
	openAndShakeMessagesWindow();

	document.dispatchEvent(
		new CustomEvent( 'wp-desktop-messages-nudge-received', {
			detail: {
				conversationId: row.conversationId,
				fromUserId: row.authorId,
				soundId,
			},
		} ),
	);
}

function handleTyping( payload: SseTypingPayload ): void {
	for ( const [ conversationId, entries ] of Object.entries( payload ) ) {
		setTyping( Number( conversationId ), entries );
	}
	// Decay: schedule a check that strips entries whose untilMs has elapsed.
	window.setTimeout( () => {
		const state = getState();
		const now = Date.now();
		for ( const [ id, entries ] of state.typingByConversation ) {
			const live = entries.filter( ( e ) => e.untilMs > now );
			if ( live.length !== entries.length ) {
				setTyping( id, live );
			}
		}
	}, 4000 );
}

function handlePresence( payload: SsePresencePayload ): void {
	const batch: Array< {
		userId: number;
		status: PresenceStatus;
		lastSeenMs?: number;
	} > = [];
	for ( const [ k, v ] of Object.entries( payload ) ) {
		batch.push( {
			userId: Number( k ),
			status: v.status,
			lastSeenMs: typeof v.lastSeenMs === 'number' ? v.lastSeenMs : undefined,
		} );
	}
	applyPresenceBatch( batch );
}

function applyChannelEvent( payload: unknown ): void {
	if ( ! payload || typeof payload !== 'object' ) {
		return;
	}
	const ev = payload as { kind?: string; row?: MessageRow; data?: unknown };
	switch ( ev.kind ) {
		case 'message':
			if ( ev.row ) {
				handleIncomingMessage( ev.row );
			}
			break;
		case 'nudge':
			if ( ev.row ) {
				handleIncomingNudge( ev.row );
			}
			break;
		case 'typing':
			handleTyping( ev.data as SseTypingPayload );
			break;
		case 'presence':
			handlePresence( ev.data as SsePresencePayload );
			break;
	}
}

/**
 * Outstanding message-toast dismiss callbacks. Tracked so we can
 * tear them down the moment the chat window mounts — a stale toast
 * from before the user opened the window would otherwise linger
 * for up to 5 s alongside an already-visible chat UI.
 */
const outstandingToasts = new Set<() => void >();

function toast( title: string, row: MessageRow ): void {
	const cfg = CONFIG();
	const message =
		row.kind === 'nudge'
			? `${ title } 👋`
			: `${ title }: ${ stripTags( row.content ) }`;
	// Fire the public toast action for plugin observers (logging,
	// integrations) AND keep a direct dismiss handle so we can
	// retire the toast when the chat window opens. The action
	// listener in desktop.ts also calls showToast — so we'd
	// duplicate the visible toast if we did both. Bypass the
	// action and call showToast directly here; the public hook is
	// still emitted for observability.
	const wp = ( window as unknown as {
		wp?: { hooks?: { doAction?: ( name: string, ...args: unknown[] ) => void } };
	} ).wp;
	const payload = {
		message,
		duration: 5000,
		action: cfg
			? {
				label: __( 'Open' ),
				onClick: () => {
					api().openWindow( { conversationId: row.conversationId } );
				},
			}
			: undefined,
	};
	const dismiss = showToast( payload );
	outstandingToasts.add( dismiss );
	// Auto-cleanup after the toast's natural lifetime + a margin.
	window.setTimeout( () => outstandingToasts.delete( dismiss ), 6000 );
	// Mirror to the action bus for plugin observability — but tag
	// `_silent: true` so the desktop.ts shell-toast listener can
	// skip rendering a duplicate toast for our payload.
	wp?.hooks?.doAction?.( 'wp-desktop.messages.toast', payload );
}

/**
 * Dismiss every in-flight message toast. Called when the chat
 * window mounts so we don't show toast-noise next to an already-
 * visible chat UI.
 */
function dismissOutstandingToasts(): void {
	for ( const dismiss of outstandingToasts ) {
		try {
			dismiss();
		} catch ( _err ) {
			// swallow
		}
	}
	outstandingToasts.clear();
}

function stripTags( html: string ): string {
	const div = document.createElement( 'div' );
	div.innerHTML = html;
	return ( div.textContent || div.innerText || '' ).slice( 0, 140 );
}

/* ------------------------------------------------------------------------- *
 * Public API
 * ------------------------------------------------------------------------- */

let cachedApi: MessagesApi | null = null;

function api(): MessagesApi {
	if ( cachedApi ) {
		return cachedApi;
	}
	cachedApi = {
		openWindow: ( opts ) => {
			// Honour the optional `conversationId` *before* the window
			// opens so the render callback's seededFocusedId logic
			// lands on the right thread on first paint (rather than
			// the placeholder + a follow-up state notify).
			if ( opts && typeof opts.conversationId === 'number' ) {
				setFocusedConversation( opts.conversationId );
			}
			const wp = ( window as unknown as {
				wp?: { desktop?: { openWindow?: ( id: string ) => boolean } };
			} ).wp;
			wp?.desktop?.openWindow?.( 'wpdm-messages' );
			document.dispatchEvent(
				new CustomEvent( 'wp-desktop-messages-window-opened', {
					detail: opts ?? {},
				} ),
			);
		},
		closeWindow: () => {
			const wp = ( window as unknown as {
				wp?: { desktop?: { windowManager?: { getById?: ( id: string ) => unknown } } };
			} ).wp;
			const w = wp?.desktop?.windowManager?.getById?.( 'wpdm-messages' ) as
				| { close?: () => void }
				| null
				| undefined;
			w?.close?.();
		},
		startConversationWith: async ( userId ) => {
			const out = await startConversation( userId );
			upsertConversation( out.conversation );
			return out.conversation;
		},
		send: async ( conversationId, content, opts ) => {
			const out = await restSendMessage( conversationId, content, opts );
			if ( out.message ) {
				// Same self-sent marker the composer sets — without
				// it the round-tripped row gets toast/sound/pulse
				// treatment as if it were inbound.
				markMessageAsSelfSent( out.message.id );
				appendMessage( out.message );
				return out.message;
			}
			throw new Error( '[wpdm-messages] Send returned no message' );
		},
		markRead: async ( conversationId, lastReadId ) => {
			const state = getState();
			const id =
				lastReadId ??
				( state.messagesByConversation.get( conversationId ) ?? [] )
					.map( ( r ) => r.id )
					.reduce( ( a, b ) => Math.max( a, b ), 0 );
			if ( id > 0 ) {
				await markRead( conversationId, id );
			}
		},
		nudge: async ( conversationId, soundId ) => {
			const out = await postNudge( conversationId, soundId );
			// `postNudge` returns the inserted nudge row when the
			// server hands one back. Mark it self-sent + append so
			// the caller's local thread shows their own affordance
			// row immediately and the eventual poll re-delivery is
			// suppressed by `isSelfSent`.
			if ( out.message ) {
				markMessageAsSelfSent( out.message.id );
				appendMessage( out.message );
			}
		},
		listConversations: async () => {
			const out = await listConversations();
			for ( const c of out.conversations ) {
				upsertConversation( c );
			}
			return out.conversations;
		},
		fetchMessages: async ( conversationId, opts ) => {
			const out = await fetchMessages( conversationId, opts );
			return out.messages;
		},
		getPresence: ( userId ) => {
			// Framework presence is the source of truth as of 0.5.5.
			// `wp.desktop.presence.getStatus()` returns 'offline' for
			// untracked users, so the chat-app's `getPresence()`
			// inherits that contract for free.
			const fwk = ( window as unknown as {
				wp?: { desktop?: { presence?: { getStatus( id: number ): PresenceStatus } } };
			} ).wp?.desktop?.presence;
			return fwk ? fwk.getStatus( userId ) : 'offline';
		},
		getUnreadCount: ( conversationId ) => {
			const state = getState();
			if ( typeof conversationId === 'number' ) {
				return state.unreadByConversation.get( conversationId ) ?? 0;
			}
			return state.totalUnread;
		},
		subscribe: ( event, cb ) => {
			const handler = ( e: Event ): void => {
				const detail = ( e as CustomEvent ).detail;
				cb( detail );
			};
			document.addEventListener( event, handler );
			return () => document.removeEventListener( event, handler );
		},
	};
	return cachedApi;
}

function exposePublicApi(): void {
	const wp = ( window as unknown as {
		wp?: { desktop?: { registerNamespace?: ( name: string, ns: object ) => void } & Record< string, unknown > };
	} ).wp;
	if ( ! wp || ! wp.desktop ) {
		// Shell not yet booted — defer to ready.
		const readyFn = ( window as unknown as {
			wp?: { desktop?: { ready?: ( cb: () => void ) => void } };
		} ).wp?.desktop?.ready;
		if ( typeof readyFn === 'function' ) {
			readyFn( () => exposePublicApi() );
		} else {
			// Try again on the next tick.
			window.setTimeout( exposePublicApi, 50 );
		}
		return;
	}
	// Prefer the public registerNamespace path (since 0.23.0) so the
	// shell can validate + warn about reserved keys. Fall back to a
	// direct assignment for environments where an older shell loaded
	// this bundle (defensive — script deps make that unlikely).
	if ( typeof wp.desktop.registerNamespace === 'function' ) {
		wp.desktop.registerNamespace( 'messages', api() );
	} else {
		wp.desktop.messages = api();
	}
}

// Trigger a presence update on visibility change so the server learns
// about idle / wake transitions sooner than the next Heartbeat tick.
// Also poke the poller so a freshly-visible tab refreshes immediately
// instead of waiting up to `pollIntervalHiddenMs`.
document.addEventListener( 'visibilitychange', () => {
	if ( document.hidden ) {
		void postPresence( true ).catch( () => undefined );
	} else {
		noteUserActivity();
		void postPresence( false ).catch( () => undefined );
		const w = ( window as unknown as {
			__wpdmMessagesPoller?: { pokeNow: () => void; rescheduleForState: () => void };
		} ).__wpdmMessagesPoller;
		w?.rescheduleForState?.();
		w?.pokeNow?.();
	}
} );

// Subscribe local lastSeenId to state changes — keeps the Heartbeat
// "seen id" cursor honest as messages flow through. Also dismisses
// any in-flight message toasts the moment the chat window opens
// (windowMounted: false → true transition). Badge rendering is
// owned by `badge-policy.ts`, NOT this subscriber — keep them
// decoupled so we don't end up with two writers fighting over
// the same DOM.
let lastWindowMounted = false;
subscribe( ( state ) => {
	const ids: number[] = [];
	for ( const rows of state.messagesByConversation.values() ) {
		for ( const r of rows ) {
			ids.push( r.id );
		}
	}
	const max = ids.reduce( ( a, b ) => Math.max( a, b ), 0 );
	if ( max > lastSeenId ) {
		lastSeenId = max;
	}

	if ( ! lastWindowMounted && state.windowMounted ) {
		dismissOutstandingToasts();
	}
	lastWindowMounted = state.windowMounted;
} );
