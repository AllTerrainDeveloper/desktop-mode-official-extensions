/**
 * Conversation thread view — message bubbles, scroll-to-bottom on
 * new arrival, infinite-scroll back-load on near-top scroll.
 *
 * @since 0.22.0
 */

import { __ } from '../wp';
import { getState, setMessagesForConversation, subscribe } from '../state';
import type { ConversationSummary, MessageRow } from '../types';
import { fetchMessages } from '../transport/rest';

const SCROLL_BACKLOAD_THRESHOLD_PX = 80;

export interface ThreadProps {
	host: HTMLElement;
	/**
	 * Read the focused conversation summary from state, if present.
	 * May be null EVEN WHEN a conversation IS focused — happens when
	 * the summary hasn't hydrated into `state.conversations` yet
	 * (e.g., a nudge from a brand-new dyad arrives before the
	 * conversation list refetch completes).
	 */
	getConversation(): ConversationSummary | null;
	/**
	 * Read the focused conversation id directly from state. The thread
	 * renders messages keyed off this id; it's the source of truth
	 * regardless of whether the summary has hydrated.
	 */
	getConversationId(): number | null;
	onMarkRead( lastReadId: number ): void;
}

export function mountThread( props: ThreadProps ): () => void {
	props.host.innerHTML = '';
	const scroller = document.createElement( 'div' );
	scroller.className = 'wpdm-messages__thread-scroller';
	const list = document.createElement( 'ol' );
	list.className = 'wpdm-messages__thread-list';
	list.setAttribute( 'role', 'log' );
	list.setAttribute( 'aria-live', 'polite' );
	scroller.appendChild( list );
	props.host.appendChild( scroller );

	let loadingMore = false;
	let lastRenderedConversation = 0;
	let lastRowCount = 0;
	// `markRead` cursor per conversation id. `0` = nothing acked yet.
	// Prevents the "first open with existing unread" race: on initial
	// mount, `arrived` is true but `windowFocused` is still false (the
	// focus event hasn't propagated yet), so the original
	// `arrived && windowFocused` gate dropped the read-ack. Deduping
	// on `lastMarkedId` lets us drop `arrived` entirely without
	// hammering REST on every state notify.
	const lastMarkedIdByConv = new Map< number, number >();

	const scrollToBottom = (): void => {
		// rAF so the scroll happens AFTER the DOM mutations have
		// settled and the new bubble's height is in scrollHeight.
		requestAnimationFrame( () => {
			scroller.scrollTop = scroller.scrollHeight;
		} );
	};

	const repaint = (): void => {
		// Read the id directly — independent of whether the summary
		// has hydrated. A fresh nudge sets focusedConversationId
		// before `hydrateInitial` completes; we still want the
		// thread to render the nudge message immediately.
		const convId = props.getConversationId();
		if ( convId === null ) {
			list.innerHTML = '';
			lastRowCount = 0;
			return;
		}
		const state = getState();
		const rows = state.messagesByConversation.get( convId ) ?? [];
		const conversationChanged = lastRenderedConversation !== convId;
		lastRenderedConversation = convId;

		// Detect arrival by row-count delta. ANY new row in the focused
		// conversation forces a scroll to the bottom — required for
		// nudges (the whole point is that the recipient sees them) and
		// expected behavior for incoming messages or own sends. Older
		// "preserve user scroll position" logic is gone: the user
		// explicitly asked for unconditional scroll-down on new
		// messages.
		const arrived = rows.length > lastRowCount;

		list.innerHTML = '';
		for ( const row of rows ) {
			list.appendChild( buildBubble( row, state.settings.nudgeSoundId ) );
		}
		// Typing indicator at the bottom — appears as the last row,
		// styled to match the row but with three pulsing dots.
		const typing = state.typingByConversation.get( convId );
		if ( typing && typing.length > 0 ) {
			list.appendChild( buildTypingDots( typing.length ) );
		}

		if ( arrived || conversationChanged ) {
			scrollToBottom();
		}
		lastRowCount = rows.length;

		// Mark read whenever the window is focused on this
		// conversation and we have visible rows. Deduped on the
		// `lastMarkedIdByConv` cursor so a quiet repaint (state
		// notify with no new rows) doesn't hammer the REST endpoint.
		const unread = state.unreadByConversation.get( convId ) ?? 0;
		if ( unread > 0 && state.windowFocused && rows.length > 0 ) {
			const lastId = rows[ rows.length - 1 ].id;
			const acked = lastMarkedIdByConv.get( convId ) ?? 0;
			if ( lastId > 0 && lastId > acked ) {
				lastMarkedIdByConv.set( convId, lastId );
				props.onMarkRead( lastId );
			}
		}
	};

	const onScroll = async (): Promise< void > => {
		if ( loadingMore ) {
			return;
		}
		const convId = props.getConversationId();
		if ( convId === null ) {
			return;
		}
		if ( scroller.scrollTop > SCROLL_BACKLOAD_THRESHOLD_PX ) {
			return;
		}
		const state = getState();
		const rows = state.messagesByConversation.get( convId ) ?? [];
		if ( rows.length === 0 ) {
			return;
		}
		loadingMore = true;
		try {
			const oldest = rows[ 0 ].id;
			const out = await fetchMessages( convId, { before: oldest, limit: 50 } );
			if ( out.messages.length > 0 ) {
				const merged = [ ...out.messages, ...rows ];
				setMessagesForConversation( convId, merged );
				// Restore visible scroll position so old messages don't
				// jump past the user's eye.
				scroller.scrollTop = SCROLL_BACKLOAD_THRESHOLD_PX + 10;
			}
		} catch ( _err ) {
			// silent — the SSE / heartbeat path will recover when it can.
		} finally {
			loadingMore = false;
		}
	};

	scroller.addEventListener( 'scroll', () => {
		void onScroll();
	} );

	const unsubscribe = subscribe( repaint );
	repaint();
	return unsubscribe;
}

function buildBubble( row: MessageRow, _soundId: string ): HTMLLIElement {
	const li = document.createElement( 'li' );
	li.className = 'wpdm-messages__bubble';
	li.dataset.messageId = String( row.id );

	const cfg = window.wpDesktopMessagesConfig;
	const isMine =
		!! cfg && Number( cfg.currentUserId ) === Number( row.authorId );
	li.classList.add( isMine ? 'wpdm-messages__bubble--mine' : 'wpdm-messages__bubble--theirs' );
	if ( row.kind === 'nudge' ) {
		li.classList.add( 'wpdm-messages__bubble--nudge' );
	}

	const body = document.createElement( 'div' );
	body.className = 'wpdm-messages__bubble-body';

	if ( row.kind === 'nudge' ) {
		body.innerHTML = '👋 ' + __( 'sent a nudge' );
	} else {
		// Content was sanitized server-side; we render as HTML.
		body.innerHTML = row.content;
	}
	li.appendChild( body );

	const time = document.createElement( 'wpd-relative-time' );
	time.className = 'wpdm-messages__bubble-time';
	time.setAttribute( 'datetime', new Date( row.createdAtMs ).toISOString() );
	li.appendChild( time );

	return li;
}

function buildTypingDots( count: number ): HTMLLIElement {
	const li = document.createElement( 'li' );
	li.className = 'wpdm-messages__typing';
	li.setAttribute(
		'aria-label',
		count === 1 ? __( 'Someone is typing' ) : __( 'Several people are typing' ),
	);
	for ( let i = 0; i < 3; i++ ) {
		const dot = document.createElement( 'span' );
		dot.className = 'wpdm-messages__typing-dot';
		li.appendChild( dot );
	}
	return li;
}
