/**
 * Demo — Close All command.
 *
 * Registers the /close_all slash-command in the WP Desktop Mode Cmd+K
 * palette. When invoked it:
 *
 *   1. Asks for confirmation via ctx.confirm().
 *   2. Closes every open window via manager.closeAll() — fires the full
 *      before/filter/after hook chain so other plugins can protect windows.
 *   3. Collapses all extra virtual desktops down to the primary one.
 *   4. Switches to the primary desktop if the user was elsewhere.
 *   5. Persists the cleared session and reports a summary.
 *
 * Bootstrap: uses wp.desktop.isReady() + wp.desktop.whenReady(). Both are
 * safe for multi-plugin use since 0.14.0 (unique namespace per whenReady
 * call — no silent overwrites between plugins).
 */

function bootCloseAll() {
	const desktop = window.wp.desktop;
	const manager = desktop.windowManager;

	desktop.registerCommand( {
		slug:        'close_all',
		label:       'Close all windows',
		description: 'Close every open window and collapse to a single desktop.',
		icon:        'dashicons-no-alt',

		run: async ( _args, ctx ) => {
			const windows = manager.getAll();

			if ( windows.length === 0 ) {
				return 'No open windows.';
			}

			const ok = await ctx.confirm(
				`Close ${ windows.length } window${ windows.length === 1 ? '' : 's' }?`,
				'Any unsaved iframe state will be lost.'
			);
			if ( ! ok ) {
				return 'Cancelled.';
			}

			// Fires wp-desktop.windows.before-close-all, the close-all filter
			// (other plugins may protect specific windows), and after-close-all.
			// Returns the number of windows actually closed.
			const closed = manager.closeAll();

			// Collapse extra desktops to the primary.
			// getPrimaryDesktopId() honours the wp-desktop.primary-desktop-id
			// filter so any "home desktop" convention a plugin sets is respected.
			const primaryId = manager.getPrimaryDesktopId();
			const desktops  = manager.getDesktops();
			let closedDesktops = 0;
			for ( let i = desktops.length - 1; i >= 0; i-- ) {
				if ( desktops[ i ].id !== primaryId ) {
					manager.closeDesktop( desktops[ i ].id );
					closedDesktops++;
				}
			}

			if ( manager.getActiveDesktopId() !== primaryId ) {
				manager.switchDesktop( primaryId );
			}

			desktop.saveSession();
			ctx.close();

			const skipped      = windows.length - closed;
			const skippedNote  = skipped > 0
				? ` (${ skipped } protected by a plugin)`
				: '';
			const desktopsNote = closedDesktops > 0
				? ` Collapsed ${ closedDesktops } extra desktop${ closedDesktops === 1 ? '' : 's' }.`
				: '';

			return `Closed ${ closed } window${ closed === 1 ? '' : 's' }${ skippedNote }.${ desktopsNote } Desktop is now empty.`;
		},
	} );
}

// Two-path bootstrap (required since wp-desktop-mode 0.15.0):
//
//   Path A — isReady() is true: the shell is already running and this script
//            was injected mid-session by the command-sync module (triggered by
//            desktop_mode_register_command() including the script URL in the
//            plugins-changed payload on plugin install/activate). Call
//            bootCloseAll() immediately — window.wp.desktop is fully available.
//
//   Path B — isReady() is false: normal page-load case. window.wp.desktop
//            doesn't exist yet (it's set inside init() on DOMContentLoaded).
//            Listen for 'wp-desktop-init' and boot when init() completes.
if ( window.wp?.desktop?.isReady?.() ) {
	bootCloseAll();
} else {
	document.addEventListener( 'wp-desktop-init', function onInit() {
		document.removeEventListener( 'wp-desktop-init', onInit );
		bootCloseAll();
	} );
}
