/**
 * Reactive state store for the messages feature.
 *
 * Plain subscribe/publish; no Redux, no signals library — every
 * mutation flows through one of the named setters, which compute
 * the next snapshot and notify subscribers.
 *
 * **Cross-bundle sharing.** The messages feature ships as two
 * separate Vite IIFE bundles (`messages-shell`, always-on, and
 * `messages`, lazy-loaded when the chat window opens). Each
 * bundle is built independently and has its own copy of every
 * module's compiled code — INCLUDING this file. Mutations inside
 * one bundle's compiled state would be invisible to the other
 * bundle's subscribers. We dodge that by routing all state
 * through the framework's `createSharedStore` primitive
 * (`src/shared-store.ts`), which dedupes via a window-level slot
 * keyed by string. Both bundles compile this file with the same
 * key, so both end up with the same underlying record.
 *
 * @since 0.22.0
 */

import { createSharedStore, subscribePresence } from './wp';
import type {
	ConversationSummary,
	MessageRow,
	SoundDef,
	SseTypingEntry,
	UserSettings,
} from './types';

interface State {
	conversations: ConversationSummary[];
	focusedConversationId: number | null;
	messagesByConversation: Map< number, MessageRow[] >;
	typingByConversation: Map< number, SseTypingEntry[] >;
	settings: UserSettings;
	sounds: SoundDef[];
	defaultSoundId: string;
	totalUnread: number;
	unreadByConversation: Map< number, number >;
	windowMounted: boolean;
	windowFocused: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
	nudgeSoundId: '',
	volume: 0.7,
	showToast: true,
	soundWhileFocused: false,
	inactiveAfterSeconds: 300,
	acceptFrom: 'everyone',
};

type Listener = ( snapshot: Readonly< State > ) => void;

const store = createSharedStore< State >( 'wpdm-messages/state', () => ( {
	conversations: [],
	focusedConversationId: null,
	messagesByConversation: new Map(),
	typingByConversation: new Map(),
	settings: { ...DEFAULT_SETTINGS },
	sounds: [],
	defaultSoundId: '',
	totalUnread: 0,
	unreadByConversation: new Map(),
	windowMounted: false,
	windowFocused: false,
} ) );

const state: State = store.state;

function notify(): void {
	store.notify();
}

// Bridge: framework presence updates fire messages-state notify so
// existing UI subscribers (conversation-list, thread, …) re-render
// when a peer's status flips. Presence READS go straight to the
// framework store via `fwkPresence.getStatus(...)` — there is no
// messages-side cache. Idempotent across bundle loads because both
// `fwkPresence.subscribe` and `store.subscribe` use the framework
// shared-store dedupe.
subscribePresence( () => {
	store.notify();
} );

export function getState(): Readonly< State > {
	return store.getState();
}

export function subscribe( cb: Listener ): () => void {
	return store.subscribe( cb );
}

/* ------------------------------------------------------------------------- *
 * Mutations
 * ------------------------------------------------------------------------- */

export function setConversations( list: ConversationSummary[] ): void {
	state.conversations = list.slice().sort( ( a, b ) => b.updatedAtMs - a.updatedAtMs );
	notify();
}

export function upsertConversation( c: ConversationSummary ): void {
	const existing = state.conversations.findIndex( ( x ) => x.id === c.id );
	if ( existing >= 0 ) {
		state.conversations[ existing ] = c;
	} else {
		state.conversations.push( c );
	}
	state.conversations.sort( ( a, b ) => b.updatedAtMs - a.updatedAtMs );

	// Seed `unreadByConversation` from the conversation summary so
	// thread.ts's `markRead` gate (`unread > 0`) doesn't have to wait
	// for the first heartbeat tick (~5s) to learn the per-conv count.
	// Heartbeat reconciles to truth on its first tick — until then
	// we use the server-side count baked into the conversation row.
	// Skip when the map already has an entry (don't clobber a heartbeat-
	// derived value or an optimistic `bumpUnread`).
	if ( ! state.unreadByConversation.has( c.id ) ) {
		state.unreadByConversation.set( c.id, c.unreadCount );
		state.totalUnread = state.totalUnread + c.unreadCount;
	}

	notify();
}

export function setFocusedConversation( id: number | null ): void {
	state.focusedConversationId = id;
	notify();
}

/**
 * Replace the message list for a conversation, **merging** any rows
 * already in state that aren't in the incoming list.
 *
 * The merge matters because hydration is async: when the user clicks
 * a conversation we kick off `GET /messages` and the response replaces
 * state.messagesByConversation[id]. But the poller (or SSE) can land
 * a new row between that GET being issued and the response arriving.
 * If we naively overwrote, that just-arrived row would vanish from
 * the UI on hydrate-complete — the exact "text doesn't show in the
 * window" symptom users reported. Nudges hid the bug because
 * `handleIncomingNudge` calls `setFocusedConversation` which causes
 * `hydrateMessages` to early-return on the next focus-driven sync
 * (state already has the nudge row), so no overwrite happens. Text
 * messages don't focus-switch, so the overwrite path is reachable.
 *
 * Merge strategy: id-keyed map. Server rows take precedence (latest
 * server-side state); local rows missing from the server are
 * preserved so optimistic appends and out-of-band poll deliveries
 * survive a concurrent hydrate.
 */
export function setMessagesForConversation(
	conversationId: number,
	rows: MessageRow[],
): void {
	const existing = state.messagesByConversation.get( conversationId ) ?? [];
	if ( existing.length === 0 ) {
		state.messagesByConversation.set( conversationId, rows.slice() );
		notify();
		return;
	}
	const byId = new Map< number, MessageRow >();
	for ( const r of rows ) {
		byId.set( r.id, r );
	}
	for ( const r of existing ) {
		if ( ! byId.has( r.id ) ) {
			byId.set( r.id, r );
		}
	}
	const merged = Array.from( byId.values() ).sort( ( a, b ) => a.id - b.id );
	state.messagesByConversation.set( conversationId, merged );
	notify();
}

export function appendMessage( row: MessageRow ): void {
	const list = state.messagesByConversation.get( row.conversationId ) ?? [];
	if ( list.some( ( r ) => r.id === row.id ) ) {
		return;
	}
	list.push( row );
	list.sort( ( a, b ) => a.id - b.id );
	state.messagesByConversation.set( row.conversationId, list );

	// Keep the conversation summary's last-message + sort cursor in
	// sync so the list reorders without a refetch.
	const conv = state.conversations.find( ( c ) => c.id === row.conversationId );
	if ( conv ) {
		conv.lastMessage = {
			preview: row.kind === 'nudge' ? '👋 sent a nudge' : row.content,
			authorId: row.authorId,
			createdAtMs: row.createdAtMs,
		};
		conv.updatedAtMs = row.createdAtMs;
		state.conversations.sort( ( a, b ) => b.updatedAtMs - a.updatedAtMs );
	}

	notify();
}

// `setPresence` / `setPresenceBatch` removed in 0.5.5 — presence
// lives in the framework store now. SSE / heartbeat handlers
// delegate to `wp.desktop.presence.applyPresenceBatch` (or
// `applyPresenceBatch` exported from `src/presence`). The bridge
// above ensures messages-state subscribers still see the change.

export function setTyping( conversationId: number, entries: SseTypingEntry[] ): void {
	if ( entries.length === 0 ) {
		state.typingByConversation.delete( conversationId );
	} else {
		state.typingByConversation.set( conversationId, entries.slice() );
	}
	notify();
}

export function setSettings( settings: UserSettings ): void {
	state.settings = { ...settings };
	notify();
}

export function setSounds( list: SoundDef[], defaultId: string ): void {
	state.sounds = list.slice();
	state.defaultSoundId = defaultId;
	notify();
}

export function setUnread(
	total: number,
	byConversation: Record< string, number >,
): void {
	state.totalUnread = total;
	state.unreadByConversation = new Map();
	for ( const [ k, v ] of Object.entries( byConversation ) ) {
		state.unreadByConversation.set( Number( k ), v );
	}
	notify();
}

/**
 * Optimistically increment the unread counter for a conversation
 * (and the total) when an incoming message lands via poller / SSE.
 * The heartbeat handler reconciles to server truth on the next tick
 * (~5s), so any drift self-corrects — but until then the badge
 * stays accurate without waiting on the heartbeat round-trip.
 *
 * @since 0.23.0
 */
export function bumpUnread( conversationId: number ): void {
	const current = state.unreadByConversation.get( conversationId ) ?? 0;
	state.unreadByConversation.set( conversationId, current + 1 );
	state.totalUnread = state.totalUnread + 1;
	notify();
}

/**
 * Optimistically clear unread for a conversation (and decrement
 * the total). Called when the client dispatches `markRead` — the
 * server confirms on the next heartbeat tick, so this just avoids
 * the visual lag where the sidebar badge keeps showing the count
 * for ~5s while the user is already reading the messages.
 *
 * @since 0.23.0
 */
export function clearUnreadForConversation( conversationId: number ): void {
	const current = state.unreadByConversation.get( conversationId ) ?? 0;
	if ( current === 0 ) {
		return;
	}
	state.unreadByConversation.set( conversationId, 0 );
	state.totalUnread = Math.max( 0, state.totalUnread - current );
	notify();
}

export function setWindowMounted( mounted: boolean ): void {
	state.windowMounted = mounted;
	notify();
}

export function setWindowFocused( focused: boolean ): void {
	state.windowFocused = focused;
	notify();
}

/** Reset state — used in tests, never in production. */
export function _resetForTests(): void {
	store.reset();
}
