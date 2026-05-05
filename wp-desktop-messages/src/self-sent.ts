/**
 * Cross-bundle "I just sent this row" tracker.
 *
 * The composer (in the lazy `messages` bundle) calls
 * `markMessageAsSelfSent(id)` immediately after a successful POST so
 * the always-on shell's poller / SSE handler can recognise the
 * server's eventual re-delivery as our own and skip the
 * toast / sound / pulse path. Both sides MUST agree on which ids
 * are currently "self-sent" — without that, every message you send
 * triggers your own toast a few seconds later when it round-trips.
 *
 * Backed by `wp.desktop.createSharedStore` so the set is one
 * instance across the messages bundles. The state is a plain `Set`
 * + a "last-mutated tick" counter; we don't subscribe (no UI cares
 * when an id is added/removed), so the framework's notify
 * machinery is unused here on purpose.
 *
 * @since 0.5.5
 */

import { createSharedStore } from './wp';

interface SelfSentState {
	ids: Set< number >;
}

const store = createSharedStore< SelfSentState >(
	'wpdm-messages/self-sent',
	() => ( { ids: new Set() } ),
);

/**
 * How long to remember an id before dropping it. By then the poller
 * has had ample opportunity to re-deliver and we don't want the set
 * to grow unboundedly across a long session.
 */
const TTL_MS = 60_000;

/**
 * Mark a message id as "I just sent this from this tab/bundle".
 * Invoked by the composer (and the public API's `send()` /
 * `nudge()`) right after a successful REST POST. The shell's
 * `handleIncomingMessage` / `handleIncomingNudge` consult this set
 * via {@link isSelfSent} when a row arrives via the poller / SSE.
 */
export function markMessageAsSelfSent( id: number ): void {
	store.state.ids.add( id );
	window.setTimeout( () => {
		store.state.ids.delete( id );
	}, TTL_MS );
}

/**
 * True when `id` was marked self-sent within the last
 * {@link TTL_MS} milliseconds. Pair with `authorId === currentUserId`
 * — both checks are belt-and-suspenders for the same case (own
 * row re-delivered) and either positive answer is enough to skip
 * the toast/sound/pulse path.
 */
export function isSelfSent( id: number ): boolean {
	return store.state.ids.has( id );
}
