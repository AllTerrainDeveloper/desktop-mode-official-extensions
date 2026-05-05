/**
 * Sidebar list of conversations. Each row: avatar + name + last
 * message preview + relative time + unread badge. Click selects
 * the conversation. Repaints when state.conversations or
 * state.unreadByConversation changes.
 *
 * @since 0.22.0
 */

import { __ } from '../wp';
import { getStatus as getPresenceStatus } from '../wp';
import { renderKeyedList, clearKeyedList } from '../wp';
import { getState, setFocusedConversation, subscribe } from '../state';
import type { ConversationSummary } from '../types';

export interface ConversationListProps {
	host: HTMLElement;
	onSelect( conversation: ConversationSummary ): void;
	onStartNew(): void;
}

export function mountConversationList( props: ConversationListProps ): () => void {
	// `renderKeyedList` reuses each row's DOM node across re-renders
	// (same `keyOf` value → same `<li>`), so listeners attached in
	// `buildRow` survive every state notification. No document-level
	// delegation, no mousedown workaround needed — the row the user
	// presses is the same DOM node when they release.
	const repaint = (): void => render( props );
	const unsubscribe = subscribe( repaint );
	repaint();
	return () => {
		unsubscribe();
		clearKeyedList( props.host );
	};
}

/**
 * Find or create the persistent `<ul>` that holds the keyed list.
 * The `<ul>` itself is the host the reconciler manages; it survives
 * renders so its event listeners (and the `<li>`s under it) are
 * stable across data updates.
 */
function ensureListContainer(
	host: HTMLElement,
	props: ConversationListProps,
): HTMLUListElement {
	let list = host.querySelector< HTMLUListElement >( '.wpdm-messages__list-items' );
	if ( list ) {
		return list;
	}
	// First render — wipe whatever's there (typically the PHP-template
	// empty state) and install the persistent ul.
	host.innerHTML = '';
	list = document.createElement( 'ul' );
	list.className = 'wpdm-messages__list-items';
	list.setAttribute( 'role', 'list' );
	host.appendChild( list );

	// Surface-level click: lets a row's onSelect fire via event
	// delegation. mousedown-based per-row listeners (in buildRow) are
	// the primary path — this is the catch-all for keyboard-Enter,
	// touch, etc. that synthesise click without mousedown.
	list.addEventListener( 'click', ( ev ) => {
		const target = ev.target as HTMLElement | null;
		const li = target?.closest< HTMLLIElement >( '.wpdm-messages__list-item' );
		if ( ! li ) {
			return;
		}
		const id = Number( li.dataset.conversationId );
		if ( ! Number.isFinite( id ) || id <= 0 ) {
			return;
		}
		const conv = getState().conversations.find( ( c ) => c.id === id );
		if ( ! conv ) {
			return;
		}
		setFocusedConversation( id );
		props.onSelect( conv );
	} );

	return list;
}

function showEmptyState( props: ConversationListProps ): void {
	const host = props.host;
	// If we previously had a list, remove it cleanly.
	clearKeyedList( host );
	host.innerHTML = '';

	const empty = document.createElement( 'wpd-empty-state' );
	empty.setAttribute( 'icon', 'dashicons-format-chat' );
	empty.setAttribute( 'heading', __( 'No conversations yet' ) );
	empty.setAttribute(
		'description',
		__( 'Start a chat with another administrator or editor.' ),
	);
	const cta = document.createElement( 'wpd-button' );
	cta.setAttribute( 'variant', 'primary' );
	cta.setAttribute( 'slot', 'cta' );
	cta.textContent = __( 'New chat' );
	cta.addEventListener( 'click', () => props.onStartNew() );
	empty.appendChild( cta );
	host.appendChild( empty );
}

function render( props: ConversationListProps ): void {
	const state = getState();

	if ( state.conversations.length === 0 ) {
		showEmptyState( props );
		return;
	}

	const list = ensureListContainer( props.host, props );

	// Keyed reconciliation. Existing rows are reused; new keys are
	// built; gone keys are removed. Listeners attached in buildRow
	// survive every repaint that doesn't change membership.
	renderKeyedList( list, state.conversations, {
		keyOf: ( c ) => c.id,
		buildItem: ( c ) => buildRow( c, props ),
		updateItem: ( el, c ) => updateRow( el as HTMLLIElement, c ),
	} );
}

/**
 * In-place row updater. Refreshes the bits of an existing `<li>`
 * that may have changed since the last render — name, preview,
 * timestamp, badge, presence, active state — without rebuilding
 * the row. The row's `mousedown` listener (attached in `buildRow`
 * once) survives every update.
 */
function updateRow( li: HTMLLIElement, c: ConversationSummary ): void {
	const state = getState();
	li.classList.toggle(
		'wpdm-messages__list-item--active',
		state.focusedConversationId === c.id,
	);

	const avatar = li.querySelector< HTMLElement >( 'wpd-avatar' );
	if ( avatar ) {
		avatar.setAttribute( 'name', c.otherUser?.displayName ?? '' );
		if ( c.otherUser?.avatarUrl ) {
			avatar.setAttribute( 'src', c.otherUser.avatarUrl );
		} else {
			avatar.removeAttribute( 'src' );
		}
		// Presence comes from the framework store now. The
		// `getPresenceStatus` import returns 'offline' for untracked
		// users; the conv summary's baked-in `c.otherUser?.presence`
		// is the cold-load fallback for the brief window before the
		// first heartbeat tick lands a snapshot.
		const presence = getPresenceStatus( c.otherUserId );
		const fallback = c.otherUser?.presence;
		const resolved = presence !== 'offline' ? presence : fallback ?? presence;
		if ( resolved ) {
			avatar.setAttribute( 'presence', resolved );
		} else {
			avatar.removeAttribute( 'presence' );
		}
	}

	const nameEl = li.querySelector< HTMLElement >( '.wpdm-messages__list-item-name' );
	if ( nameEl ) {
		const next = c.otherUser?.displayName ?? __( 'Unknown user' );
		if ( nameEl.textContent !== next ) {
			nameEl.textContent = next;
		}
	}

	const previewEl = li.querySelector< HTMLElement >( '.wpdm-messages__list-item-preview' );
	if ( previewEl ) {
		const next = c.lastMessage.preview || __( 'No messages yet' );
		if ( previewEl.textContent !== next ) {
			previewEl.textContent = next;
		}
	}

	const trailing = li.querySelector< HTMLElement >( '.wpdm-messages__list-item-trailing' );
	if ( trailing ) {
		// Time + badge are cheap to rebuild — no listeners on them.
		trailing.innerHTML = '';
		if ( c.lastMessage.createdAtMs > 0 ) {
			const time = document.createElement( 'wpd-relative-time' );
			time.setAttribute(
				'datetime',
				new Date( c.lastMessage.createdAtMs ).toISOString(),
			);
			trailing.appendChild( time );
		}
		const unread = state.unreadByConversation.get( c.id ) ?? c.unreadCount;
		if ( unread > 0 ) {
			const badge = document.createElement( 'wpd-badge' );
			badge.setAttribute( 'tone', 'danger' );
			badge.setAttribute( 'no-dot', '' );
			badge.textContent = unread > 99 ? '99+' : String( unread );
			trailing.appendChild( badge );
		}
	}
}

function buildRow(
	c: ConversationSummary,
	props: ConversationListProps,
): HTMLLIElement {
	const state = getState();
	const li = document.createElement( 'li' );
	li.className = 'wpdm-messages__list-item';
	li.dataset.conversationId = String( c.id );
	if ( state.focusedConversationId === c.id ) {
		li.classList.add( 'wpdm-messages__list-item--active' );
	}
	li.setAttribute( 'role', 'listitem' );

	const avatar = document.createElement( 'wpd-avatar' );
	avatar.setAttribute( 'size', '40' );
	avatar.setAttribute( 'name', c.otherUser?.displayName ?? '' );
	if ( c.otherUser?.avatarUrl ) {
		avatar.setAttribute( 'src', c.otherUser.avatarUrl );
	}
	if ( c.otherUserId ) {
		avatar.setAttribute( 'user-id', String( c.otherUserId ) );
	}
	// Same framework-presence read as `updateRow` — keep this in
	// sync if either site changes.
	const presenceFromFwk = getPresenceStatus( c.otherUserId );
	const presence =
		presenceFromFwk !== 'offline'
			? presenceFromFwk
			: c.otherUser?.presence ?? presenceFromFwk;
	if ( presence ) {
		avatar.setAttribute( 'presence', presence );
	}

	const meta = document.createElement( 'div' );
	meta.className = 'wpdm-messages__list-item-meta';

	const name = document.createElement( 'div' );
	name.className = 'wpdm-messages__list-item-name';
	name.textContent = c.otherUser?.displayName ?? __( 'Unknown user' );

	const preview = document.createElement( 'div' );
	preview.className = 'wpdm-messages__list-item-preview';
	preview.textContent = c.lastMessage.preview || __( 'No messages yet' );

	meta.appendChild( name );
	meta.appendChild( preview );

	const trailing = document.createElement( 'div' );
	trailing.className = 'wpdm-messages__list-item-trailing';

	if ( c.lastMessage.createdAtMs > 0 ) {
		const time = document.createElement( 'wpd-relative-time' );
		time.setAttribute(
			'datetime',
			new Date( c.lastMessage.createdAtMs ).toISOString(),
		);
		trailing.appendChild( time );
	}

	const unread = state.unreadByConversation.get( c.id ) ?? c.unreadCount;
	if ( unread > 0 ) {
		const badge = document.createElement( 'wpd-badge' );
		badge.setAttribute( 'tone', 'danger' );
		badge.setAttribute( 'no-dot', '' );
		badge.textContent = unread > 99 ? '99+' : String( unread );
		trailing.appendChild( badge );
	}

	li.appendChild( avatar );
	li.appendChild( meta );
	li.appendChild( trailing );

	// Plain click listener. DOM identity is preserved across renders
	// by the keyed-list reconciler (same conversation id → same `<li>`),
	// so the mousedown→click race that motivated the earlier mousedown
	// workaround can no longer happen here.
	li.addEventListener( 'click', () => {
		setFocusedConversation( c.id );
		props.onSelect( c );
	} );

	return li;
}
