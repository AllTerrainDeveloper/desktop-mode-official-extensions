/**
 * WP Desktop — Home Assistant
 *
 * Pattern mirrors the calculator plugin:
 *
 *   1. Attach the render callback to window.wpDesktopNativeWindows immediately
 *      (runs before wp-desktop-init — the shell reads it at window-open time).
 *
 *   2. Inside the render callback, clone the PHP <template> into the window
 *      body via wp.desktop.cloneTemplate(), then wire up fetch + submit.
 *
 *   3. Register /turn_light after wp-desktop-init via the CustomEvent,
 *      the only reliable timing that doesn't require window.wp.desktop
 *      to exist at script-evaluation time.
 */

( function () {
	'use strict';

	var WINDOW_ID = 'wp-desktop-ha';

	/**
	 * Template id localised by the shell into
	 * window.wpDesktopNativeWindow_wp_desktop_ha.templateId
	 * (hyphens in the window id become underscores in the JS property name).
	 * Falls back to the shell's deterministic naming scheme.
	 */
	var TEMPLATE_ID = (
		window.wpDesktopNativeWindow_wp_desktop_ha &&
		window.wpDesktopNativeWindow_wp_desktop_ha.templateId
	) || ( 'wpdm-native-window-' + WINDOW_ID );

	// ── Native window render callback ─────────────────────────────────────────

	function renderHASettings( body ) {
		var desktop  = window.wp && window.wp.desktop;
		var fragment = desktop && typeof desktop.cloneTemplate === 'function'
			? desktop.cloneTemplate( TEMPLATE_ID )
			: null;

		if ( ! fragment ) {
			// Shell hasn't registered the template — show a recovery hint.
			var err = document.createElement( 'p' );
			err.style.cssText = 'padding:20px;color:#dc3232;';
			err.textContent   = 'Template not found — reload the page.';
			body.appendChild( err );
			return;
		}

		body.appendChild( fragment );

		var cfg        = window.wpDesktopHAConfig;
		var form       = body.querySelector( '.wpdm-ha' );
		var urlInput   = body.querySelector( '#wpdm-ha-url' );
		var tokenInput = body.querySelector( '#wpdm-ha-token' );
		var tokenHint  = body.querySelector( '#wpdm-ha-token-hint' );
		var saveBtn    = form.querySelector( '[type="submit"]' );
		var statusEl   = body.querySelector( '#wpdm-ha-status' );

		function setStatus( msg, isError ) {
			statusEl.textContent = msg;
			statusEl.className   = isError ? 'wpdm-ha__status--error' : 'wpdm-ha__status--ok';
		}

		// Pre-fill with current saved settings.
		fetch( cfg.settingsUrl, { headers: { 'X-WP-Nonce': cfg.nonce } } )
			.then( function ( r ) { return r.json(); } )
			.then( function ( data ) {
				urlInput.value = data.url || '';
				if ( data.token_set ) {
					tokenHint.textContent = 'Token on file: ' + data.token_hint;
				}
			} )
			.catch( function () {
				setStatus( 'Could not load settings.', true );
			} );

		form.addEventListener( 'submit', function ( e ) {
			e.preventDefault();
			saveBtn.disabled = true;
			setStatus( 'Saving…', false );

			fetch( cfg.settingsUrl, {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
				body:    JSON.stringify( { url: urlInput.value.trim(), token: tokenInput.value } ),
			} )
				.then( function ( r ) {
					if ( ! r.ok ) { throw new Error( 'HTTP ' + r.status ); }
					return r.json();
				} )
				.then( function ( saved ) {
					tokenInput.value = '';
					if ( saved.token_set ) {
						tokenHint.textContent = 'Token on file: ' + saved.token_hint;
					}
					setStatus( 'Saved.', false );
				} )
				.catch( function ( err ) {
					setStatus( 'Save failed: ' + err.message, true );
				} )
				.finally( function () {
					saveBtn.disabled = false;
				} );
		} );
	}

	window.wpDesktopNativeWindows = window.wpDesktopNativeWindows || {};
	window.wpDesktopNativeWindows[ WINDOW_ID ] = renderHASettings;

	// ── /turn_light command ───────────────────────────────────────────────────
	//
	// Two-path bootstrap required since 0.15.0:
	//
	//   Path A — isReady() is true: shell already running, script was injected
	//     mid-session by the command-sync module (plugin was activated without
	//     a full page reload). window.wp.desktop exists; call boot() directly.
	//
	//   Path B — isReady() is false: normal page-load case. window.wp.desktop
	//     doesn't exist yet (set inside init() on DOMContentLoaded). Listen for
	//     the 'wp-desktop-init' CustomEvent which fires after init() completes.
	//
	// getCfg() provides a nonce fallback from window.wpDesktopConfig.restNonce
	// for path A — the wp_add_inline_script config blob only runs at page load,
	// not when the script is dynamically injected mid-session.

	function getCfg() {
		var c   = window.wpDesktopHAConfig;
		var wdc = window.wpDesktopConfig || {};
		// REST URL base: prefer the inline config; fall back to constructing
		// from the current origin. Subdirectory WP installs that don't set
		// wpDesktopHAConfig won't reach this fallback in practice (the inline
		// script runs at page load), but it's here as a safety net.
		var base = c && c.settingsUrl
			? ''
			: window.location.origin + '/wp-json';
		return {
			nonce:       ( c && c.nonce )       || wdc.restNonce || '',
			settingsUrl: ( c && c.settingsUrl ) || ( base + '/wp-desktop-ha/v1/settings' ),
			switchUrl:   ( c && c.switchUrl )   || ( base + '/wp-desktop-ha/v1/switch'   ),
		};
	}

	function bootCommand() {
		window.wp.desktop.registerCommand( {
			slug:        'turn_light',
			label:       'Turn light',
			description: 'Toggle the office Shelly switch (switch.releluzoficina_switch_0) via Home Assistant. Accepts "on" or "off" and reports success.',
			hint:        '[on|off]',
			icon:        'dashicons-lightbulb',
			aiCallable:  true,
			owner:       'wp-desktop-ha',

			suggest: function ( args ) {
				var q = args.trim().toLowerCase();
				var opts = [
					{ value: 'on',  label: 'Turn ON',  description: 'Switch the office light on',  icon: 'dashicons-lightbulb' },
					{ value: 'off', label: 'Turn OFF', description: 'Switch the office light off', icon: 'dashicons-no'        },
				];
				return q ? opts.filter( function ( o ) { return o.value.startsWith( q ); } ) : opts;
			},

			run: async function ( args, ctx ) {
				var state = args.trim().toLowerCase();

				if ( 'on' !== state && 'off' !== state ) {
					return 'Usage: /turn_light on   or   /turn_light off';
				}

				var cfg = getCfg();
				var res;

				// ctx.notify() is a no-op in the current shell — see developer report.
				// Uncomment when implemented: ctx.notify('Connecting to Home Assistant…');

				try {
					res = await fetch( cfg.switchUrl, {
						method:  'POST',
						headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
						body:    JSON.stringify( { state: state } ),
					} );
				} catch ( _ ) {
					return 'Network error — could not reach WordPress.';
				}

				if ( 400 === res.status ) {
					return 'Home Assistant is not configured. Click the Home Assistant tile in the taskbar to set up the URL and token.';
				}
				if ( ! res.ok ) {
					var data;
					try { data = await res.json(); } catch ( _ ) { data = {}; }
					return 'Failed: ' + ( data.message || 'Home Assistant did not respond.' );
				}

				ctx.close();
				return 'on' === state ? 'Light turned ON 💡' : 'Light turned OFF.';
			},
		} );
	}

	// Two-path bootstrap — see comment above bootCommand().
	if ( window.wp && window.wp.desktop && window.wp.desktop.isReady && window.wp.desktop.isReady() ) {
		bootCommand(); // mid-session injection: shell already up
	} else {
		document.addEventListener( 'wp-desktop-init', function onInit() {
			document.removeEventListener( 'wp-desktop-init', onInit );
			bootCommand(); // normal page-load path
		} );
	}

}() );
