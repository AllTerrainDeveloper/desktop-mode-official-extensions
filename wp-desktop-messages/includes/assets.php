<?php
/**
 * WP Desktop Messages — asset registration.
 *
 * Two JS bundles + one CSS file:
 *
 *   - `wp-desktop-messages` — chat window UI. Lazy: enqueued only
 *     when the native window opens (script-handle on the window
 *     registration handles this).
 *   - `wp-desktop-messages-shell` — always-loaded module. Owns
 *     Heartbeat probe, sound preload, toast / dock-attention on
 *     incoming-while-window-not-mounted, leader-elector boot, and
 *     the `wp.desktop.messages.*` API surface. Enqueued on every
 *     desktop-mode page so the user gets toasts + sounds even when
 *     the chat window is closed.
 *
 * @package WPDesktopMessages
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register both bundles. Hooked at `init` so the script handles are
 * available when the window-registration code runs (priority 20)
 * and the OS Settings tab registration (priority 25).
 *
 * @since 0.23.0
 */
function wpdm_messages_register_assets() {
	$ver      = WPDM_MESSAGES_VERSION;
	$debug_js = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '.js' : '.min.js';

	wp_register_script(
		'wp-desktop-messages',
		WPDM_MESSAGES_URL . 'assets/js/messages' . $debug_js,
		// `desktop-mode` is the framework's main shell bundle; the
		// messages chat window depends on `wp.desktop.*` being
		// available, so list it as a dep to guarantee load order.
		array( 'desktop-mode', 'wp-hooks', 'wp-i18n', 'jquery', 'heartbeat' ),
		$ver,
		true
	);
	wp_register_script(
		'wp-desktop-messages-shell',
		WPDM_MESSAGES_URL . 'assets/js/messages-shell' . $debug_js,
		array( 'desktop-mode', 'wp-hooks', 'wp-i18n', 'jquery', 'heartbeat' ),
		$ver,
		true
	);

	wp_register_style(
		'wp-desktop-messages',
		WPDM_MESSAGES_URL . 'assets/css/messages.css',
		array(),
		$ver
	);
}
add_action( 'init', 'wpdm_messages_register_assets', 5 );

/**
 * Localize config + enqueue the always-loaded shell module on
 * desktop-mode pages.
 *
 * @since 0.23.0
 */
function wpdm_messages_enqueue_shell() {
	if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
		return;
	}
	// The chromeless iframe runs the same admin bootstrap, but its
	// `window.wp.desktop` is the iframe-bridge stub — `createSharedStore`
	// and the rest of the public API live on the PARENT shell only.
	// Loading the messages bundles in chromeless context throws
	// `desktop().createSharedStore is not a function` at module init.
	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		return;
	}
	if ( ! wpdm_messages_user_can_use() ) {
		return;
	}

	$config = wpdm_messages_build_config( true );

	// `wp_localize_script()` would cast every scalar value to STRING
	// (legacy translation-string contract: see core's
	// `wp_localize_script()` which calls `(string)` on every scalar
	// before json_encode). That breaks `cfg.currentUserId === row.authorId`
	// (string vs number) and any boolean check (`""` vs `false`).
	// Use `wp_add_inline_script` + `wp_json_encode` to preserve types.
	wp_add_inline_script(
		'wp-desktop-messages-shell',
		'window.wpDesktopMessagesConfig = ' . wp_json_encode( $config ) . ';',
		'before'
	);

	wp_enqueue_script( 'wp-desktop-messages-shell' );
	// Also enqueue the chat-window bundle globally. It's small
	// (~17KB gzipped) and registers `wpDesktopNativeWindows[
	// 'wpdm-messages' ]` — without it, the FIRST `wp.desktop.openWindow(
	// 'wpdm-messages' )` (e.g., from an inbound nudge) hits the
	// native-windows-sync's lazy-script load AFTER the synchronous
	// open path captures `render = undefined`. Result: the window
	// opens with just the PHP template (placeholder visible) and
	// the chat UI never mounts. Eager enqueue avoids that race.
	wp_enqueue_script( 'wp-desktop-messages' );
	wp_enqueue_style( 'wp-desktop-messages' );
}
add_action( 'admin_enqueue_scripts', 'wpdm_messages_enqueue_shell', 30 );

/**
 * Inject the messages config into the chat-window bundle when the
 * native window's `script` handle resolves. The chat-window bundle
 * reuses the same `wpDesktopMessagesConfig` global the shell sets
 * up — same config, two consumers. We only re-localize if the
 * shell didn't already (e.g., chromeless context).
 *
 * @since 0.23.0
 */
function wpdm_messages_localize_window_script() {
	if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
		return;
	}
	// The chromeless iframe runs the same admin bootstrap, but its
	// `window.wp.desktop` is the iframe-bridge stub — `createSharedStore`
	// and the rest of the public API live on the PARENT shell only.
	// Loading the messages bundles in chromeless context throws
	// `desktop().createSharedStore is not a function` at module init.
	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		return;
	}
	if ( ! wpdm_messages_user_can_use() ) {
		return;
	}
	$config = wpdm_messages_build_config( false );
	// Same `wp_localize_script` type-coercion bug as above — go via
	// `wp_add_inline_script` so `currentUserId` stays a number.
	wp_add_inline_script(
		'wp-desktop-messages',
		'window.wpDesktopMessagesConfig = ' . wp_json_encode( $config ) . ';',
		'before'
	);
}
add_action( 'admin_enqueue_scripts', 'wpdm_messages_localize_window_script', 35 );

/**
 * Build the `wpDesktopMessagesConfig` blob shared by the shell and
 * window bundles. The shell needs the full config (poll cadences,
 * SSE toggles, admin-only site settings); the window only needs
 * the per-conversation REST surface.
 *
 * @since 0.23.0
 *
 * @param bool $is_shell `true` for the always-on shell bundle,
 *                       `false` for the lazy chat-window bundle.
 * @return array
 */
function wpdm_messages_build_config( $is_shell ) {
	$user_id  = (int) get_current_user_id();
	$settings = wpdm_messages_get_user_settings( $user_id );
	$sounds   = wpdm_messages_get_registered_sounds();
	$default  = wpdm_messages_default_sound_id();
	$is_admin = current_user_can( 'manage_options' );

	$config = array(
		'currentUserId'        => $user_id,
		'restNonce'            => wp_create_nonce( 'wp_rest' ),
		'restRoot'             => esc_url_raw( rest_url( 'wp-desktop/v1/messages' ) ),
		'streamUrl'            => esc_url_raw( admin_url( 'admin-ajax.php' ) ) . '?action=wpdm_messages_stream',
		'allowedRoles'         => wpdm_messages_allowed_roles(),
		'sounds'               => $sounds,
		'defaultSoundId'       => $default,
		'userSettings'         => $settings,
		'sseReconnectMs'       => (int) apply_filters( 'wp_desktop_messages_sse_reconnect_ms', 1000 ),
		'inactiveAfterSeconds' => (int) apply_filters( 'wp_desktop_messages_presence_inactive_after', 300 ),
	);

	if ( $is_shell ) {
		$config['realtimeSseEnabled']   = wpdm_messages_realtime_sse_enabled();
		$config['siteSettings']         = $is_admin
			? array( 'realtime_sse_enabled' => wpdm_messages_realtime_sse_enabled() )
			: null;
		$config['siteSettingsUrl']      = $is_admin
			? esc_url_raw( rest_url( 'wp-desktop/v1/messages/site-settings' ) )
			: '';
		$config['pollIntervalActiveMs'] = (int) apply_filters( 'wp_desktop_messages_poll_active_ms', 3000 );
		$config['pollIntervalIdleMs']   = (int) apply_filters( 'wp_desktop_messages_poll_idle_ms', 20000 );
		$config['pollIntervalHiddenMs'] = (int) apply_filters( 'wp_desktop_messages_poll_hidden_ms', 60000 );
	}

	return $config;
}
