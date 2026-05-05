/**
 * Messages badge — UX policy module.
 *
 * **What it owns.** Deciding what number to render on the
 * messages tile (dock + taskbar). The framework's `Dock.setBadge`
 * is a dumb renderer; the messages module is the policy authority
 * for its own tile.
 *
 * **The policy.** Show 0 — i.e. no badge — when the user is
 * actively looking at the chat window (it's focused and not
 * minimized). Otherwise show the total-unread count from
 * server-derived state. Plugins that disagree with this policy
 * (e.g. an "always show count" admin override) can hook
 * `wp.desktop.activity.filter('messages/badge-count', ...)` to
 * mutate the count BEFORE we render.
 *
 * **Why an event-driven module.** The framework publishes window
 * lifecycle events (`wp-desktop.window.focused | blurred |
 * minimized | restored | closed | opened`) and presence /
 * unread state through the messages reactive store. This module
 * subscribes to both axes and recomputes the visible count on
 * every relevant change. Reverse: the framework MUST NOT
 * auto-suppress badges based on window state — that's a UX
 * decision and apps own it. See `docs/event-driven-framework.md`.
 *
 * @since 0.5.5
 */

import { activity } from './wp';
import { addAction, removeAction, HOOKS } from './wp';
import { setMessagesBadge } from './attention';
import { getState, subscribe } from './state';

const WINDOW_ID = 'wpdm-messages';

/**
 * Persistent lifecycle subscription. We can't use `onWindow`
 * because that helper auto-unsubscribes after `closed` — fine for
 * single-instance plugin handlers, but the badge policy outlives
 * every individual chat-window instance and needs to keep
 * reacting to opens / closes for the lifetime of the page.
 */
let installedLifecycleNamespace: string | null = null;

/**
 * The lifecycle hooks that affect badge visibility. We listen
 * to all of them and gate by windowId in the handler.
 */
const LIFECYCLE_HOOKS: readonly string[] = [
	HOOKS.WINDOW_OPENED,
	HOOKS.WINDOW_FOCUSED,
	HOOKS.WINDOW_BLURRED,
	HOOKS.WINDOW_MINIMIZED,
	HOOKS.WINDOW_RESTORED,
	HOOKS.WINDOW_CLOSED,
	HOOKS.WINDOW_REOPENED,
];

/**
 * Read current state + ask the manager whether the user is
 * looking at the messages window right now. The manager is the
 * source of truth — `state.windowFocused` / `state.windowMounted`
 * are local mirrors and can drift across CustomEvent drops.
 */
function isMessagesWindowActive(): boolean {
	const wp = ( window as unknown as {
		wp?: {
			desktop?: {
				windowManager?: { isActive?: ( id: string ) => boolean };
			};
		};
	} ).wp;
	return !! wp?.desktop?.windowManager?.isActive?.( WINDOW_ID );
}

/**
 * Compute and apply the badge count. Pure function on (state,
 * window-active-ness) — call it from any subscriber that thinks
 * either input might have changed. Idempotent in the renderer
 * (`Dock.setBadge` short-circuits when the value matches).
 */
function repaintBadge(): void {
	const totalUnread = getState().totalUnread;
	const active = isMessagesWindowActive();
	const raw = active ? 0 : totalUnread;
	// Public filter so plugin authors can override the policy
	// (e.g. "always show count, even when window is open" for an
	// admin dashboard view, or "never show when DND active").
	const final = activity.filter( 'messages/badge-count', raw, {
		totalUnread,
		windowActive: active,
	} );
	setMessagesBadge(
		typeof final === 'number' ? Math.max( 0, Math.floor( final ) ) : raw,
	);
}

/**
 * Boot the badge policy. Idempotent — running twice is a no-op.
 * Returns a teardown for symmetry / tests; production code never
 * calls it (the policy lives for the lifetime of the page).
 */
export function startMessagesBadgePolicy(): () => void {
	if ( installedLifecycleNamespace ) {
		// Already started.
		return () => undefined;
	}
	installedLifecycleNamespace = `wp-desktop-mode/messages-badge-policy/${ Date.now() }`;
	const ns = installedLifecycleNamespace;

	// State subscription — fires on any messages-state mutation,
	// which is wider than what we strictly need (we only care
	// about totalUnread). We accept the over-fire because the
	// renderer is a no-op when the count hasn't changed.
	const stateUnsub = subscribe( () => repaintBadge() );

	// Lifecycle subscription — gated by windowId so the handler
	// short-circuits for sibling windows.
	for ( const hook of LIFECYCLE_HOOKS ) {
		addAction( hook, ns, ( payload: unknown ) => {
			const detail = payload as { windowId?: string };
			if ( detail?.windowId !== WINDOW_ID ) {
				return;
			}
			repaintBadge();
		} );
	}

	// Initial paint — `state.totalUnread` may already be > 0 at
	// boot if Heartbeat populated unread before this module's
	// state subscription was added.
	repaintBadge();

	return () => {
		stateUnsub();
		for ( const hook of LIFECYCLE_HOOKS ) {
			removeAction( hook, ns );
		}
		installedLifecycleNamespace = null;
	};
}
