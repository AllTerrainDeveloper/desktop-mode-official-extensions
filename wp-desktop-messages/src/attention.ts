/**
 * Attention helper — resolves the messages window via the public
 * window manager and dispatches `Window.requestAttention()` with a
 * sensible default mode ("pulse"). Falls back to a direct
 * `Dock.setAttention` call if the window isn't currently mounted
 * but a tile is registered, so the user still sees the badge.
 *
 * @since 0.22.0
 */

const WINDOW_ID = 'wpdm-messages';

interface DockApi {
	setAttention?: (
		id: string,
		mode: 'pulse' | 'shake' | 'bounce' | null,
		opts?: { durationMs?: number; intensity?: 'subtle' | 'normal' | 'strong' },
	) => void;
	setBadge?: ( id: string, count: number ) => void;
}

/**
 * Rails that respond to attention requests (pulse / shake / bounce).
 * Wallpaper icons don't have an attention surface — they're static
 * tiles, so they're omitted from `resolveDocks()`.
 */
function resolveDocks(): DockApi[] {
	const wp = ( window as unknown as {
		wp?: { desktop?: { dock?: DockApi | null; taskbar?: DockApi | null } };
	} ).wp;
	const out: DockApi[] = [];
	const dock = wp?.desktop?.dock;
	const taskbar = wp?.desktop?.taskbar;
	if ( dock && typeof dock.setAttention === 'function' ) {
		out.push( dock );
	}
	if ( taskbar && typeof taskbar.setAttention === 'function' ) {
		out.push( taskbar );
	}
	return out;
}

/**
 * Every rail that surfaces a numeric badge for the messages window:
 * dock + taskbar (depending on `placement`) + the wallpaper icon
 * registered via `desktop_mode_register_icon`. Each `setBadge` is a
 * silent no-op on rails where our id isn't present, so fan-out is
 * safe regardless of which rail actually hosts our tile.
 *
 * The icons rail is the third badge surface introduced in
 * framework 0.24.0 — without it the wallpaper shortcut sat
 * forever-zero while the taskbar showed unread.
 */
function resolveBadgeRails(): DockApi[] {
	const wp = ( window as unknown as {
		wp?: {
			desktop?: {
				dock?: DockApi | null;
				taskbar?: DockApi | null;
				icons?: DockApi | null;
			};
		};
	} ).wp;
	const out: DockApi[] = [];
	const dock = wp?.desktop?.dock;
	const taskbar = wp?.desktop?.taskbar;
	const icons = wp?.desktop?.icons;
	if ( dock && typeof dock.setBadge === 'function' ) {
		out.push( dock );
	}
	if ( taskbar && typeof taskbar.setBadge === 'function' ) {
		out.push( taskbar );
	}
	if ( icons && typeof icons.setBadge === 'function' ) {
		out.push( icons );
	}
	return out;
}

interface WindowManagerLike {
	getById?: ( id: string ) => unknown;
}

interface WindowLike {
	id?: string;
	state?: string;
	requestAttention?: (
		mode: 'pulse' | 'shake' | 'bounce' | null,
		opts?: { durationMs?: number; intensity?: 'subtle' | 'normal' | 'strong' },
	) => void;
	shake?: () => void;
	restore?: () => void;
	focus?: () => void;
}

interface WindowManagerLikeFull {
	getById?: ( id: string ) => WindowLike | null | undefined;
}

/**
 * Pulse the messages tile / window for a few seconds. Used by
 * `shell.ts` when an incoming message lands while the chat window
 * is closed or unfocused.
 */
export function requestMessagesAttention(
	mode: 'pulse' | 'shake' | 'bounce' = 'pulse',
	durationMs = 4000,
): void {
	const wp = ( window as unknown as {
		wp?: { desktop?: { windowManager?: WindowManagerLike } };
	} ).wp;
	const win = wp?.desktop?.windowManager?.getById?.( WINDOW_ID ) as
		| WindowLike
		| null
		| undefined;
	if ( win && typeof win.requestAttention === 'function' ) {
		win.requestAttention( mode, { durationMs } );
		return;
	}
	for ( const d of resolveDocks() ) {
		d.setAttention?.( WINDOW_ID, mode, { durationMs } );
	}
}

/**
 * Set / clear the unread-count badge on the messages tile.
 */
export function setMessagesBadge( count: number ): void {
	for ( const d of resolveBadgeRails() ) {
		d.setBadge?.( WINDOW_ID, count );
	}
}

/**
 * Full-attention nudge response: open / restore / focus the chat
 * window AND shake it. Used by the recipient when an incoming
 * nudge arrives. If the window is closed, opens it. If minimized,
 * restores it. Either way, focuses + shakes after a frame so the
 * shake plays on a visible window.
 */
export function openAndShakeMessagesWindow(): void {
	const wp = ( window as unknown as {
		wp?: {
			desktop?: {
				openWindow?: ( id: string ) => boolean;
				windowManager?: WindowManagerLikeFull;
			};
		};
	} ).wp;
	const desktop = wp?.desktop;

	// `openWindow` either opens (if not yet open) or focuses (if open).
	// Both paths leave the window in a focused, restored state.
	desktop?.openWindow?.( WINDOW_ID );

	// Restore from minimized + shake on the next frame so the
	// animation starts when the window is actually visible.
	requestAnimationFrame( () => {
		const win = desktop?.windowManager?.getById?.( WINDOW_ID );
		if ( ! win ) {
			return;
		}
		if ( win.state === 'minimized' && typeof win.restore === 'function' ) {
			win.restore();
		}
		if ( typeof win.shake === 'function' ) {
			win.shake();
		}
	} );
}
