/**
 * Shell bundle entry. Boots the always-on messages plumbing once
 * the desktop shell is ready (so the public API surface is in
 * place when we hook in).
 *
 * @since 0.22.0
 */

import { bootShell } from './shell';

const tryBoot = (): void => {
	bootShell();
};

const ready = ( window as unknown as {
	wp?: { desktop?: { ready?: ( cb: () => void ) => void } };
} ).wp?.desktop?.ready;
if ( typeof ready === 'function' ) {
	ready( tryBoot );
} else if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', tryBoot, { once: true } );
} else {
	// Run async so the desktop bundle's `wp.desktop` assignment can
	// finish first if both bundles run in the same tick.
	queueMicrotask( tryBoot );
}
