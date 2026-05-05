/**
 * Runtime bridge to the framework's public globals.
 *
 * **Load-order rule.** The plugin's bundles can be evaluated before
 * the framework's `wp-desktop` `init()` runs (footer scripts execute
 * synchronously before DOMContentLoaded; dynamically-injected
 * bundles can race the same way). This module MUST NOT throw at
 * import time when `window.wp.desktop` is missing — many plugin
 * source files run `createSharedStore()` and `subscribePresence()`
 * eagerly at module init.
 *
 * Strategy:
 *
 *   - Surfaces that don't actually need `wp.desktop` are
 *     reimplemented locally:
 *       - `createSharedStore` operates against a window-level slot
 *         (`window.__wpDesktopSharedStores`) — same dedupe target
 *         the framework uses, so cross-bundle stores still
 *         coalesce regardless of which bundle defined the function.
 *       - `__` reads `window.wp.i18n.__` directly (no `wp.desktop`).
 *       - `addAction` / `removeAction` go through `window.wp.hooks`
 *         directly (the framework's `wp.desktop.hooks` is just an
 *         alias of the same global).
 *       - `HOOKS` is a frozen object of the framework's published
 *         hook names; the strings are stable across versions and
 *         the constant is small enough to vendor.
 *       - `activity` is reimplemented as a thin wrapper over
 *         `window.wp.hooks` with the framework's
 *         `wp-desktop.activity.<channel>` namespace prefix —
 *         identical wire format, no `wp.desktop` dependency.
 *
 *   - Surfaces with closure-captured state on the framework side
 *     (`presence.applyBatch / .getStatus / .subscribe`,
 *     `heartbeat`, `showToast`, `renderKeyedList`/`clearKeyedList`)
 *     are runtime-bridged. They're only called from post-boot
 *     callbacks (event handlers, hook subscriptions, view
 *     renders), so a lazy lookup at call time always finds
 *     `wp.desktop` populated.
 *
 *   - `subscribePresence` is the one tricky exception — `state.ts`
 *     calls it at module-init. If `wp.desktop` isn't ready, queue
 *     the registration via `wp.desktop.ready` (provided by
 *     `wp-hooks` core script which IS available early), or
 *     `DOMContentLoaded` as a last-resort fallback.
 *
 * @since 0.23.0
 */

import type {
	KeyedListOptions,
	ToastOptions,
	WpDesktopPublicApi,
} from 'wp-desktop-mode';

/* ---------------------- helpers ---------------------- */

/**
 * Best-effort `wp.desktop` getter — returns undefined when not
 * yet populated rather than throwing. Use for lazy resolves at
 * call time.
 */
function desktopMaybe(): WpDesktopPublicApi | undefined {
	return window.wp?.desktop;
}

/**
 * Hard-fetch `wp.desktop` — throws when missing. Only use inside
 * callbacks that run after the shell has booted.
 */
function desktopReady(): WpDesktopPublicApi {
	const d = window.wp?.desktop;
	if ( ! d ) {
		throw new Error(
			'[wpdm-messages] window.wp.desktop not available at runtime — is wp-desktop-mode active?',
		);
	}
	return d;
}

/**
 * Defer `cb` until `wp.desktop` is populated. Resolves immediately
 * when already there; otherwise hooks `wp.desktop.ready` (preferred)
 * or falls back to `DOMContentLoaded` + a microtask.
 */
function whenDesktopReady( cb: ( d: WpDesktopPublicApi ) => void ): void {
	const d = desktopMaybe();
	// Short-circuit ONLY when the FULL API is up. Since the desktop
	// shell installs an early skeleton on `window.wp.desktop` (with
	// just `whenReady`/`ready`/`isReady` available pre-init), a bare
	// truthy check would fire `cb` against a partial `d` and explode
	// the moment we touch `d.presence` / `d.windowManager` / etc.
	if ( d && typeof d.isReady === 'function' && d.isReady() ) {
		cb( d );
		return;
	}
	const tryReady = (): void => {
		const ready = window.wp?.desktop?.ready;
		if ( typeof ready === 'function' ) {
			ready( () => cb( desktopReady() ) );
		} else if ( document.readyState === 'loading' ) {
			document.addEventListener(
				'DOMContentLoaded',
				() => queueMicrotask( tryReady ),
				{ once: true },
			);
		} else {
			// Last-ditch: poll once on the next macrotask. Almost
			// never reached; if it is, the framework script genuinely
			// hasn't run yet and we have a deeper config problem.
			window.setTimeout( tryReady, 50 );
		}
	};
	tryReady();
}

/* ---------------------------- i18n ---------------------------- */

export function __( text: string, _domain?: string ): string {
	return window.wp?.i18n?.__?.( text, 'wp-desktop-messages' ) ?? text;
}

/* --------------- shared store (local impl) -------------- */

/**
 * Cross-bundle reactive store. Mirrors the framework's
 * `createSharedStore` shape and dedupes via the same
 * `window.__wpDesktopSharedStores` slot, so a store created here
 * is identity-equal to the same key created from the framework's
 * own bundle. Implemented locally so eager module-init calls
 * don't depend on `wp.desktop` being populated yet.
 */
export interface SharedStore< T > {
	state: T;
	getState(): Readonly< T >;
	notify(): void;
	subscribe( cb: ( state: Readonly< T > ) => void ): () => void;
	reset(): void;
}

interface InternalRecord< T > {
	state: T;
	// Field name MUST match the framework's `InternalRecord.listeners`
	// (`wp-desktop-mode/src/shared-store.ts:98`) so a record created
	// here can be read by the framework's bundle and vice versa via
	// the shared `window.__wpDesktopSharedStores` slot.
	listeners: Set< ( state: Readonly< T > ) => void >;
	rebuild: () => T;
}

const SHARED_STORES_SLOT = '__wpDesktopSharedStores';

function resolveSlot(): Map< string, InternalRecord< unknown > > {
	const w = window as unknown as {
		[ SHARED_STORES_SLOT ]?: Map< string, InternalRecord< unknown > >;
	};
	let slot = w[ SHARED_STORES_SLOT ];
	if ( ! slot ) {
		slot = new Map();
		w[ SHARED_STORES_SLOT ] = slot;
	}
	return slot;
}

export function createSharedStore< T >(
	key: string,
	initialState: () => T,
): SharedStore< T > {
	const slot = resolveSlot();
	let record = slot.get( key ) as InternalRecord< T > | undefined;
	if ( ! record ) {
		record = {
			state: initialState(),
			listeners: new Set(),
			rebuild: initialState,
		};
		slot.set( key, record as InternalRecord< unknown > );
	}
	const r = record;
	return {
		get state(): T {
			return r.state;
		},
		set state( next: T ) {
			r.state = next;
		},
		getState(): Readonly< T > {
			return r.state;
		},
		notify(): void {
			for ( const cb of r.listeners ) {
				try {
					cb( r.state );
				} catch ( err ) {
					// eslint-disable-next-line no-console
					console.error( '[wpdm-messages] shared-store subscriber threw', err );
				}
			}
		},
		subscribe( cb: ( state: Readonly< T > ) => void ): () => void {
			r.listeners.add( cb );
			return () => {
				r.listeners.delete( cb );
			};
		},
		reset(): void {
			r.state = r.rebuild();
			r.listeners.clear();
		},
	};
}

/* --------------------------- hooks --------------------------- */

/**
 * Hardcoded snapshot of the framework's published `HOOKS` enum
 * (subset we use). Hook names are part of the framework's stable
 * contract; vendoring the constants avoids the eager-Proxy issue
 * where `LIFECYCLE_HOOKS = [HOOKS.WINDOW_OPENED, …]` evaluates
 * before `wp.desktop` is on the window.
 */
export const HOOKS = Object.freeze( {
	WINDOW_OPENED: 'wp-desktop.window.opened',
	WINDOW_REOPENED: 'wp-desktop.window.reopened',
	WINDOW_CLOSED: 'wp-desktop.window.closed',
	WINDOW_FOCUSED: 'wp-desktop.window.focused',
	WINDOW_BLURRED: 'wp-desktop.window.blurred',
	WINDOW_MINIMIZED: 'wp-desktop.window.minimized',
	WINDOW_RESTORED: 'wp-desktop.window.restored',
} as const );

interface WpHooksLike {
	addAction(
		hookName: string,
		namespace: string,
		callback: ( ...args: unknown[] ) => void,
		priority?: number,
	): void;
	removeAction( hookName: string, namespace: string ): number;
	applyFilters(
		hookName: string,
		value: unknown,
		...args: unknown[]
	): unknown;
}

function wpHooks(): WpHooksLike | undefined {
	return ( window.wp as unknown as { hooks?: WpHooksLike } | undefined )?.hooks;
}

export function addAction(
	hookName: string,
	namespace: string,
	callback: ( ...args: unknown[] ) => void,
	priority?: number,
): void {
	const h = wpHooks();
	if ( ! h ) {
		// `wp.hooks` is provided by core's `wp-hooks` script; if it
		// isn't there yet we're loading too early. Defer.
		whenDesktopReady( () => addAction( hookName, namespace, callback, priority ) );
		return;
	}
	h.addAction( hookName, namespace, callback, priority );
}

export function removeAction( hookName: string, namespace: string ): number {
	const h = wpHooks();
	return h ? h.removeAction( hookName, namespace ) : 0;
}

/* -------------------------- activity ------------------------- */

const ACTIVITY_PREFIX = 'wp-desktop.activity.';

export const activity = {
	publish( channel: string, payload: unknown ): void {
		// Framework's activity.publish is `applyFilters` + observer
		// ceremony; for a consumer plugin's purposes, the filter call
		// is the contract. Identical wire shape.
		const h = wpHooks();
		if ( h ) {
			h.applyFilters( ACTIVITY_PREFIX + channel, payload );
		}
	},
	subscribe( channel: string, cb: ( payload: unknown ) => void ): () => void {
		const ns = `wpdm-messages/activity-sub/${ Math.random().toString( 36 ).slice( 2 ) }`;
		addAction( ACTIVITY_PREFIX + channel, ns, ( payload: unknown ) => cb( payload ) );
		return () => {
			removeAction( ACTIVITY_PREFIX + channel, ns );
		};
	},
	filter< V >( channel: string, value: V, ...args: unknown[] ): V {
		const h = wpHooks();
		if ( ! h ) {
			return value;
		}
		return h.applyFilters( ACTIVITY_PREFIX + channel, value, ...args ) as V;
	},
};

/* -------------------------- presence ------------------------- */

type PresenceBatchEntry = {
	userId: number;
	status: 'online' | 'inactive' | 'offline';
	lastSeenMs?: number;
	lastActiveMs?: number;
};

export function applyPresenceBatch( updates: PresenceBatchEntry[] ): void {
	desktopMaybe()?.presence.applyBatch( updates );
}

export function getStatus(
	userId: number,
): 'online' | 'inactive' | 'offline' {
	return desktopMaybe()?.presence.getStatus( userId ) ?? 'offline';
}

/**
 * Module-init-eager — `state.ts` subscribes at top level. Defer
 * the actual `wp.desktop.presence.subscribe` call via
 * `whenDesktopReady` so we don't throw before the framework's
 * `init()` has wired the presence API.
 */
export function subscribePresence(
	cb: Parameters< WpDesktopPublicApi[ 'presence' ][ 'subscribe' ] >[ 0 ],
): () => void {
	let unsub: ( () => void ) | null = null;
	let cancelled = false;
	whenDesktopReady( ( d ) => {
		if ( cancelled ) return;
		unsub = d.presence.subscribe( cb );
	} );
	return () => {
		cancelled = true;
		unsub?.();
	};
}

/* --------------------------- toast --------------------------- */

export function showToast( opts: ToastOptions ): () => void {
	const d = desktopMaybe();
	if ( ! d ) {
		// Toast surface gone missing — log and return a no-op
		// dismiss handle so callers that store it don't crash.
		// eslint-disable-next-line no-console
		console.warn( '[wpdm-messages] showToast called before wp.desktop ready' );
		return () => undefined;
	}
	return d.showToast( opts );
}

/* ------------------------ keyed-list ------------------------- */

export const renderKeyedList: WpDesktopPublicApi[ 'renderKeyedList' ] = (
	...args
) => desktopReady().renderKeyedList( ...args );

export const clearKeyedList: WpDesktopPublicApi[ 'clearKeyedList' ] = ( host ) =>
	desktopReady().clearKeyedList( host );

export type { KeyedListOptions };

/* ------------------------- heartbeat ------------------------- */

/**
 * Heartbeat is genuinely closure-captured by the framework — the
 * suppliers/subscribers Maps live inside the framework bundle. We
 * lazy-resolve on each call. Used only from post-boot code paths.
 */
type Heartbeat = WpDesktopPublicApi[ 'heartbeat' ];
export const heartbeat: Heartbeat = new Proxy(
	{} as unknown as Heartbeat,
	{
		get( _t, prop, recv ) {
			const live = desktopMaybe()?.heartbeat;
			if ( ! live ) {
				// No-op stubs so a stray pre-boot call doesn't crash.
				if ( prop === 'contribute' || prop === 'subscribe' ) {
					return () => () => undefined;
				}
				return undefined;
			}
			return Reflect.get( live as object, prop, recv );
		},
	},
);
