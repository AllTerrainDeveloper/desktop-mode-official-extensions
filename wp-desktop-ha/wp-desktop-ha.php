<?php
/**
 * Plugin Name: WP Desktop — Home Assistant
 * Plugin URI:  https://github.com/Automattic/wp-desktop-mode
 * Description: Control the office Shelly switch via Home Assistant from the WP Desktop ⌘K command palette. Settings window in the taskbar; <code>/turn_light on|off</code> command.
 * Version:     0.2.0
 * Author:      WP Desktop Mode contributors
 * License:     GPL-2.0-or-later
 * Requires Plugins:  desktop-mode
 * Text Domain: wp-desktop-ha
 */

defined( 'ABSPATH' ) || exit;

define( 'WPDM_HA_VERSION', '0.3.0' );

// Option keys — site-wide.
const WPDM_HA_OPT_URL   = 'wpdm_ha_url';
const WPDM_HA_OPT_TOKEN = 'wpdm_ha_token';

// Entity is hardcoded — single switch, single installation.
const WPDM_HA_ENTITY = 'switch.releluzoficina_switch_0';

// ── Registration ──────────────────────────────────────────────────────────────

add_action( 'init', 'wpdm_ha_register' );

/**
 * Register the script handle and native window in one go.
 *
 * Following the calculator pattern:
 *   1. wp_register_script()           — registers the handle.
 *   2. wp_add_inline_script() 'before' — attaches the PHP-side config blob;
 *      outputs when the shell enqueues the handle on admin_enqueue_scripts.
 *   3. desktop_mode_register_window()   — the shell owns everything else:
 *      <template> injection, script enqueue, taskbar tile, lifecycle.
 */
function wpdm_ha_register(): void {
	if ( ! function_exists( 'desktop_mode_register_window' ) ) {
		return;
	}

	wp_register_script(
		'wp-desktop-ha',
		plugin_dir_url( __FILE__ ) . 'wp-desktop-ha.js',
		array( 'desktop-mode' ),
		WPDM_HA_VERSION,
		true
	);

	// REST config — nonce valid because wp_get_current_user() has run by init.
	wp_add_inline_script(
		'wp-desktop-ha',
		sprintf(
			'window.wpDesktopHAConfig = %s;',
			wp_json_encode( array(
				'nonce'       => wp_create_nonce( 'wp_rest' ),
				'settingsUrl' => rest_url( 'wp-desktop-ha/v1/settings' ),
				'switchUrl'   => rest_url( 'wp-desktop-ha/v1/switch' ),
				'entity'      => WPDM_HA_ENTITY,
			) )
		),
		'before'
	);

	desktop_mode_register_window(
		'wp-desktop-ha',
		array(
			'title'        => __( 'Home Assistant', 'wp-desktop-ha' ),
			'icon'         => 'dashicons-admin-home',
			'script'       => 'wp-desktop-ha',
			'template'     => 'wpdm_ha_render_template',
			'width'        => 440,
			'height'       => 300,
			'min_width'    => 360,
			'min_height'   => 260,
			'placement'    => 'taskbar',
			'capabilities' => array( 'manage_options' ),
		)
	);

	// Register the /turn_light command server-side (since 0.15.0).
	// desktop_mode_register_command() implicitly calls
	// desktop_mode_register_command_script(), which includes the script URL in
	// the plugins-changed payload so the shell injects it mid-session when
	// this plugin is installed or activated without a full page reload.
	if ( function_exists( 'desktop_mode_register_command' ) ) {
		desktop_mode_register_command( array(
			'slug'        => 'turn_light',
			'label'       => __( 'Turn light', 'wp-desktop-ha' ),
			'description' => __( 'Toggle the office Shelly switch via Home Assistant.', 'wp-desktop-ha' ),
			'icon'        => 'dashicons-lightbulb',
			'hint'        => '[on|off]',
			'script'      => 'wp-desktop-ha',
		) );
	}
}

// ── Template ──────────────────────────────────────────────────────────────────

/**
 * Settings form markup — injected into <template id="wpdm-native-window-wp-desktop-ha">
 * by the shell. The JS render callback clones this and appends it to the
 * window body, then fetches current values and wires up submit.
 */
function wpdm_ha_render_template(): void {
	if ( function_exists( 'desktop_mode_component' ) ) {
		wpdm_ha_render_template_components();
	} else {
		wpdm_ha_render_template_fallback();
	}
}

function wpdm_ha_render_template_components(): void {
	ob_start();
	?>
	<style>
		.wpdm-ha { display: flex; flex-direction: column; gap: 12px; }
		.wpdm-ha__row { display: flex; flex-direction: column; gap: 4px; }
		.wpdm-ha__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--wp-desktop-text-muted, #888); }
		.wpdm-ha__input { width: 100%; padding: 6px 9px; border: 1px solid var(--wp-desktop-border, #c3c4c7); border-radius: 3px; font-size: 13px; box-sizing: border-box; background: var(--wp-desktop-surface, #fff); color: inherit; }
		.wpdm-ha__input:focus { border-color: #2271b1; box-shadow: 0 0 0 1px #2271b1; outline: none; }
		.wpdm-ha__hint { font-size: 11px; color: var(--wp-desktop-text-muted, #999); margin: 2px 0 0; }
		.wpdm-ha__footer { display: flex; align-items: center; gap: 12px; padding-block-start: 4px; }
		.wpdm-ha__status--ok    { font-size: 12px; color: #46b450; }
		.wpdm-ha__status--error { font-size: 12px; color: #dc3232; }
	</style>

	<form class="wpdm-ha" novalidate>
		<div class="wpdm-ha__row">
			<label class="wpdm-ha__label" for="wpdm-ha-url">
				<?php esc_html_e( 'Home Assistant URL', 'wp-desktop-ha' ); ?>
			</label>
			<input class="wpdm-ha__input" id="wpdm-ha-url"
			       type="url" placeholder="http://homeassistant.local:8123" autocomplete="off" />
		</div>

		<div class="wpdm-ha__row">
			<label class="wpdm-ha__label" for="wpdm-ha-token">
				<?php esc_html_e( 'Long-Lived Access Token', 'wp-desktop-ha' ); ?>
			</label>
			<input class="wpdm-ha__input" id="wpdm-ha-token"
			       type="password"
			       placeholder="<?php esc_attr_e( 'Leave blank to keep existing', 'wp-desktop-ha' ); ?>"
			       autocomplete="new-password" />
			<p class="wpdm-ha__hint" id="wpdm-ha-token-hint" aria-live="polite"></p>
		</div>

		<div class="wpdm-ha__footer">
			<button class="button button-primary" type="submit">
				<?php esc_html_e( 'Save', 'wp-desktop-ha' ); ?>
			</button>
			<span id="wpdm-ha-status" aria-live="polite"></span>
		</div>
	</form>
	<?php
	$inner = ob_get_clean();

	desktop_mode_component(
		'wpd-panel',
		array( 'padding' => '20', 'gap' => '0' ),
		$inner
	);
}

function wpdm_ha_render_template_fallback(): void {
	// Safety fallback when desktop_mode_component() isn't yet available.
	?>
	<div style="padding:20px">
		<p><?php esc_html_e( 'Please update WP Desktop Mode to use this window.', 'wp-desktop-ha' ); ?></p>
	</div>
	<?php
}

// ── REST API ──────────────────────────────────────────────────────────────────

add_action( 'rest_api_init', 'wpdm_ha_register_routes' );

function wpdm_ha_register_routes(): void {
	register_rest_route(
		'wp-desktop-ha/v1',
		'/settings',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'wpdm_ha_get_settings',
				'permission_callback' => fn() => current_user_can( 'manage_options' ),
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'wpdm_ha_save_settings',
				'permission_callback' => fn() => current_user_can( 'manage_options' ),
			),
		)
	);

	register_rest_route(
		'wp-desktop-ha/v1',
		'/switch',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'wpdm_ha_toggle_switch',
			'permission_callback' => fn() => is_user_logged_in(),
			'args'                => array(
				'state' => array(
					'required'          => true,
					'type'              => 'string',
					'enum'              => array( 'on', 'off' ),
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		)
	);
}

function wpdm_ha_get_settings(): WP_REST_Response {
	$token = (string) get_option( WPDM_HA_OPT_TOKEN, '' );
	return rest_ensure_response( array(
		'url'        => (string) get_option( WPDM_HA_OPT_URL, '' ),
		'token_set'  => '' !== $token,
		'token_hint' => '' !== $token ? '••••' . substr( $token, -4 ) : '',
	) );
}

function wpdm_ha_save_settings( WP_REST_Request $request ): WP_REST_Response {
	$url   = $request->get_param( 'url' );
	$token = $request->get_param( 'token' );

	if ( null !== $url ) {
		update_option( WPDM_HA_OPT_URL, esc_url_raw( $url ) );
	}
	if ( ! empty( $token ) ) {
		update_option( WPDM_HA_OPT_TOKEN, sanitize_text_field( $token ) );
	}

	return wpdm_ha_get_settings();
}

function wpdm_ha_toggle_switch( WP_REST_Request $request ): WP_REST_Response|WP_Error {
	$ha_url = (string) get_option( WPDM_HA_OPT_URL, '' );
	$token  = (string) get_option( WPDM_HA_OPT_TOKEN, '' );

	if ( '' === $ha_url || '' === $token ) {
		return new WP_Error(
			'ha_not_configured',
			__( 'Home Assistant is not configured. Open the Home Assistant settings window first.', 'wp-desktop-ha' ),
			array( 'status' => 400 )
		);
	}

	$state   = $request->get_param( 'state' );
	$service = 'on' === $state ? 'turn_on' : 'turn_off';
	$url     = trailingslashit( $ha_url ) . 'api/services/switch/' . $service;

	$response = wp_remote_post( $url, array(
		'headers' => array(
			'Authorization' => 'Bearer ' . $token,
			'Content-Type'  => 'application/json',
		),
		'body'    => wp_json_encode( array( 'entity_id' => WPDM_HA_ENTITY ) ),
		'timeout' => 10,
	) );

	if ( is_wp_error( $response ) ) {
		return new WP_Error( 'ha_unreachable', $response->get_error_message(), array( 'status' => 502 ) );
	}

	$code = wp_remote_retrieve_response_code( $response );
	if ( $code < 200 || $code >= 300 ) {
		return new WP_Error(
			'ha_api_error',
			/* translators: %d: HTTP status code from Home Assistant */
			sprintf( __( 'Home Assistant returned HTTP %d.', 'wp-desktop-ha' ), $code ),
			array( 'status' => 502 )
		);
	}

	return rest_ensure_response( array( 'ok' => true, 'state' => $state ) );
}
