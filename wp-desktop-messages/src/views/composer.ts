/**
 * Composer — `<wpd-textarea>` + send + nudge buttons. Emits a
 * throttled typing event on every keystroke (server applies its own
 * de-dup window on top of this).
 *
 * @since 0.22.0
 */

import { __ } from '../wp';
// Import from `../self-sent` directly rather than `../shell` so the
// composer's bundle doesn't drag the always-on shell's poller / SSE
// / leader-elector code in alongside the chat-window UI. The
// `markMessageAsSelfSent` symbol is re-exported from `../shell` for
// backwards compatibility, but `self-sent.ts` is the canonical home.
import { markMessageAsSelfSent } from '../self-sent';
import { appendMessage } from '../state';
import { postNudge, postTyping, sendMessage } from '../transport/rest';
import type { ConversationSummary } from '../types';

const TYPING_THROTTLE_MS = 1500;

export interface ComposerProps {
	host: HTMLElement;
	getConversation(): ConversationSummary | null;
}

export function mountComposer( props: ComposerProps ): () => void {
	props.host.innerHTML = '';

	const textarea = document.createElement( 'wpd-textarea' );
	textarea.setAttribute( 'placeholder', __( 'Type a message…' ) );
	// One row by default so the composer collapses to the same
	// height as the buttons. Auto-grow expands to multi-line as
	// the user types, capped at 6 rows.
	textarea.setAttribute( 'rows', '1' );
	textarea.setAttribute( 'maxlength', '4000' );
	textarea.setAttribute( 'auto-grow', '' );
	textarea.setAttribute( 'max-rows', '6' );
	textarea.setAttribute( 'submit-on-enter', '' );
	textarea.classList.add( 'wpdm-messages__composer-input' );

	const actions = document.createElement( 'div' );
	actions.className = 'wpdm-messages__composer-actions';

	const nudgeBtn = document.createElement( 'wpd-button' );
	nudgeBtn.setAttribute( 'variant', 'secondary' );
	nudgeBtn.setAttribute( 'title', __( 'Send a nudge' ) );
	nudgeBtn.setAttribute( 'aria-label', __( 'Send a nudge' ) );
	nudgeBtn.classList.add( 'wpdm-messages__composer-nudge' );
	nudgeBtn.innerHTML = '<span class="wpdm-messages__composer-nudge-icon" aria-hidden="true">👋</span>';

	const sendBtn = document.createElement( 'wpd-button' );
	sendBtn.setAttribute( 'variant', 'primary' );
	sendBtn.classList.add( 'wpdm-messages__composer-send' );
	sendBtn.textContent = __( 'Send' );

	actions.appendChild( nudgeBtn );
	actions.appendChild( sendBtn );

	props.host.appendChild( textarea );
	props.host.appendChild( actions );

	let lastTypingMs = 0;

	const submit = async (): Promise< void > => {
		const conv = props.getConversation();
		if ( ! conv ) {
			return;
		}
		const value = ( ( textarea as unknown as { value: string | null } ).value ?? '' ).trim();
		if ( ! value ) {
			return;
		}
		// Optimistic UX: clear the box first; the server roundtrip
		// returns the canonical row, which we inject into local
		// state so the user sees their own message instantly (rather
		// than waiting for the next poll tick).
		( textarea as unknown as { clear?: () => void } ).clear?.();
		try {
			const out = await sendMessage( conv.id, value );
			if ( out.message ) {
				markMessageAsSelfSent( out.message.id );
				appendMessage( out.message );
			}
		} catch ( _err ) {
			// Restore the value so the user can retry; silent so
			// the optimistic empty state isn't disruptive.
			( textarea as unknown as { value: string } ).value = value;
		}
	};

	textarea.addEventListener( 'wpd-submit', () => {
		void submit();
	} );

	textarea.addEventListener( 'wpd-input-change', () => {
		const conv = props.getConversation();
		if ( ! conv ) {
			return;
		}
		const now = Date.now();
		if ( now - lastTypingMs < TYPING_THROTTLE_MS ) {
			return;
		}
		lastTypingMs = now;
		void postTyping( conv.id ).catch( () => undefined );
	} );

	sendBtn.addEventListener( 'click', () => {
		void submit();
	} );

	nudgeBtn.addEventListener( 'click', async () => {
		const conv = props.getConversation();
		if ( ! conv ) {
			return;
		}
		try {
			const out = await postNudge( conv.id );
			if ( out.message ) {
				markMessageAsSelfSent( out.message.id );
				appendMessage( out.message );
			}
		} catch ( _err ) {
			// silent
		}
	} );

	// Caller's teardown — clear children to drop any stray listeners
	// on the children themselves (event listeners are auto-cleaned
	// when the element is GC'd, but explicit clear is defensive).
	return () => {
		props.host.innerHTML = '';
	};
}
