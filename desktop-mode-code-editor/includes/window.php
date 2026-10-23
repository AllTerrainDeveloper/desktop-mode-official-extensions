<?php
/**
 * Code Editor window, icon, and asset registration.
 *
 * Registers the `wpdc-editor` native window + matching desktop icon.
 * The bundle is a static file; the Monaco loader URL, REST URLs and
 * nonce ride on the handle as a `before` inline script, which
 * OpenStation prints with the script whether it loads at boot or on
 * the window's first open.
 *
 * Window id (`wpdc-editor`), DOM selectors (`data-osc-editor-*`),
 * CSS classes (`wpdc-editor*`), and the JS-side config global
 * (`window.openStationCodeEditorConfig`) intentionally retain their
 * original spellings — third-party plugins deep-link by window id
 * (see README.md), and renaming would break public consumers.
 *
 * @package OpenStationCodeEditor
 */

defined( 'ABSPATH' ) || exit;

/**
 * URL the JS bundle hands to Monaco's AMD loader.
 *
 * @return string
 */
function openstation_code_editor_monaco_vendor_url() {
	return untrailingslashit(
		OPENSTATION_CODE_EDITOR_URL . 'assets/vendor/monaco-editor/min/vs'
	);
}

/**
 * Register the script + style handles backing the editor window.
 *
 * The bundle is the prebuilt file (min when not SCRIPT_DEBUG). The
 * editor config is attached as a `before` inline script, only for
 * users who may open the editor, since it carries a REST nonce.
 */
function openstation_code_editor_register_assets() {
	$css_path = OPENSTATION_CODE_EDITOR_DIR . 'assets/css/code-editor.css';
	wp_register_style(
		'desktop-mode-code-editor',
		OPENSTATION_CODE_EDITOR_URL . 'assets/css/code-editor.css',
		array( 'os-variables', 'dashicons' ),
		// CSS iterates faster than the bundle; cache-bust on mtime so a
		// fresh stylesheet always lands without a plugin version bump.
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : OPENSTATION_CODE_EDITOR_VERSION
	);

	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$file   = 'assets/js/code-editor' . $suffix . '.js';
	if ( ! file_exists( OPENSTATION_CODE_EDITOR_DIR . $file ) ) {
		$file = 'assets/js/code-editor.js';
	}
	$js_path = OPENSTATION_CODE_EDITOR_DIR . $file;

	wp_register_script(
		'desktop-mode-code-editor',
		OPENSTATION_CODE_EDITOR_URL . $file,
		array( 'wp-i18n' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : OPENSTATION_CODE_EDITOR_VERSION,
		true
	);
	wp_set_script_translations(
		'desktop-mode-code-editor',
		'desktop-mode-code-editor',
		OPENSTATION_CODE_EDITOR_DIR . 'languages'
	);

	if ( ! openstation_code_editor_user_can_use() ) {
		return;
	}

	$base = trailingslashit( rest_url( OPENSTATION_CODE_EDITOR_REST_NAMESPACE ) );

	$config = array(
		'monacoVendorUrl' => openstation_code_editor_monaco_vendor_url(),
		'pluginUrl'       => untrailingslashit( OPENSTATION_CODE_EDITOR_URL ),
		'restNonce'       => wp_create_nonce( 'wp_rest' ),
		'treeUrl'         => esc_url_raw( $base . 'tree' ),
		'fileUrl'         => esc_url_raw( $base . 'file' ),
		'phpSymbolsUrl'   => esc_url_raw( $base . 'php-symbols' ),
		'phpSymbolUrl'    => esc_url_raw( $base . 'php-symbols/' ),
	);

	wp_add_inline_script(
		'desktop-mode-code-editor',
		'window.openStationCodeEditorConfig = ' . wp_json_encode( $config ) . ';',
		'before'
	);
}

/**
 * Echoes the Code Editor window's static template.
 *
 * The shell wraps whatever we emit inside its own
 * `<template id="os-native-window-wpdc-editor">`, then on every
 * window open it clones that template into the window body BEFORE
 * invoking our JS render callback.
 */
function openstation_code_editor_render_template() {
	ob_start();
	?>
	<div class="wpdc-editor osc-editor--loading" data-osc-editor-root>
		<div class="osc-editor__loading" data-osc-editor-loading>
			<span class="dashicons dashicons-editor-code" aria-hidden="true"></span>
			<p><?php esc_html_e( 'Loading editor…', 'desktop-mode-code-editor' ); ?></p>
		</div>
		<div class="osc-editor__monaco" data-osc-editor-monaco></div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the editor window's template body before it's emitted.
	 *
	 * Keep the `data-osc-editor-monaco` hook (or rename via the
	 * `openstation_code_editor_mount_selector` filter) and you can
	 * restyle / restructure everything else.
	 *
	 * @param string $html Default template HTML.
	 */
	echo apply_filters( 'openstation_code_editor_template_html', $html ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

/**
 * Register the Code Editor window and desktop icon.
 *
 * Both registrations are no-ops on disallowed sites or for users
 * without `edit_plugins`. We hook on `init` (priority 20) so the
 * native-window registry has been bootstrapped by the framework.
 */
function openstation_code_editor_register_window() {
	if ( ! openstation_code_editor_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'          => __( 'Code', 'desktop-mode-code-editor' ),
		'icon'           => 'dashicons-editor-code',
		'template'       => 'openstation_code_editor_render_template',
		'script'         => 'desktop-mode-code-editor',
		'width'          => 960,
		'height'         => 640,
		'min_width'      => 480,
		'min_height'     => 320,
		'placement'      => 'dock',
		'capabilities'   => array( 'edit_plugins' ),
		// The bundle installs the Cmd/Ctrl+Shift+E shortcut and the
		// `os-code-open` listener when it loads, so it has to load at
		// boot rather than on the window's first open.
		'preload_script' => true,
	);

	/**
	 * Filter args used to register the Code Editor native window.
	 *
	 * @param array $window_args Args passed to `openstation_register_window()`.
	 */
	$window_args = (array) apply_filters( 'openstation_code_editor_window_args', $window_args );

	$registered = openstation_register_window( 'wpdc-editor', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode-code-editor] window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'        => __( 'Code', 'desktop-mode-code-editor' ),
		'icon'         => 'dashicons-editor-code',
		'window'       => 'wpdc-editor',
		'position'     => 50,
		'capabilities' => array( 'edit_plugins' ),
	);

	/**
	 * Filter args used to register the Code Editor desktop icon.
	 *
	 * @param array $icon_args Args passed to `openstation_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'openstation_code_editor_icon_args', $icon_args );

	openstation_register_icon( 'wpdc-editor', $icon_args );
}

/**
 * Enqueue the editor stylesheet for any openstation admin page.
 *
 * The CSS has to be in place BEFORE the template is cloned so the
 * loading state renders correctly. The bundle is pulled on demand
 * by the native-window sync; the CSS is cheap to ship to every
 * openstation page load.
 */
function openstation_code_editor_enqueue_style() {
	if ( ! openstation_code_editor_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-code-editor' );
}

/**
 * Wire the UI surface to OpenStation once we know it's loaded.
 *
 * No-ops cleanly when OpenStation is missing — REST routes still
 * register so any consumer that relies on them keeps working.
 */
function openstation_code_editor_maybe_init_ui() {
	if ( ! function_exists( 'openstation_register_window' ) ) {
		return;
	}

	add_action( 'init', 'openstation_code_editor_register_assets', 20 );
	add_action( 'init', 'openstation_code_editor_register_window', 20 );
	add_action( 'admin_enqueue_scripts', 'openstation_code_editor_enqueue_style', 30 );
}

add_action( 'plugins_loaded', 'openstation_code_editor_maybe_init_ui', 20 );
