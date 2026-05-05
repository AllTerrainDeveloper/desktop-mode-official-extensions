<?php
/**
 * Desktop Mode — Messages: native-window registration.
 *
 * Native window with id `wpdm-messages` pinned to the taskbar.
 * Template echoes a static skeleton (split-pane: conversation list
 * on the left, thread on the right). The JS bundle hydrates against
 * `data-wpdm-messages-*` selectors — same pattern as the recycle bin.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echo the messages window template. Cloned into the window body
 * before the JS render callback fires.
 *
 * @since 0.22.0
 */
function wpdm_messages_render_template() {
	ob_start();
	?>
	<div class="wpdm-messages" data-wpdm-messages-root>
		<aside class="wpdm-messages__sidebar" data-wpdm-messages-sidebar>
			<header class="wpdm-messages__sidebar-header">
				<h2 class="wpdm-messages__sidebar-title"><?php esc_html_e( 'Chats', 'wp-desktop-messages' ); ?></h2>
				<wpd-button variant="ghost" data-wpdm-messages-new title="<?php esc_attr_e( 'Start a new chat', 'wp-desktop-messages' ); ?>">
					<span class="dashicons dashicons-plus-alt2" aria-hidden="true"></span>
				</wpd-button>
			</header>
			<div class="wpdm-messages__list" data-wpdm-messages-list>
				<wpd-empty-state
					icon="dashicons-format-chat"
					heading="<?php esc_attr_e( 'No conversations yet', 'wp-desktop-messages' ); ?>"
					description="<?php esc_attr_e( 'Start a chat with another administrator or editor.', 'wp-desktop-messages' ); ?>"
				></wpd-empty-state>
			</div>
		</aside>
		<section class="wpdm-messages__main" data-wpdm-messages-main>
			<div class="wpdm-messages__placeholder" data-wpdm-messages-placeholder>
				<wpd-empty-state
					icon="dashicons-format-chat"
					heading="<?php esc_attr_e( 'Pick a conversation', 'wp-desktop-messages' ); ?>"
					description="<?php esc_attr_e( 'Or start a new chat from the toolbar above.', 'wp-desktop-messages' ); ?>"
				></wpd-empty-state>
			</div>
			<div class="wpdm-messages__thread" data-wpdm-messages-thread hidden></div>
			<footer class="wpdm-messages__composer" data-wpdm-messages-composer hidden></footer>
		</section>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the messages window template HTML.
	 *
	 * @since 0.22.0
	 *
	 * @param string $html Default template HTML.
	 */
	echo apply_filters( 'wp_desktop_messages_template_html', $html ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}

/**
 * Register the messages native window. Hooked at `init` priority 20
 * — after `components.php` has bootstrapped the registry.
 *
 * @since 0.22.0
 */
function wpdm_messages_register_window() {
	if ( ! wpdm_messages_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'      => __( 'Messages', 'wp-desktop-messages' ),
		'icon'       => 'dashicons-format-chat',
		'template'   => 'wpdm_messages_render_template',
		'script'     => 'wp-desktop-messages',
		'width'      => 880,
		'height'     => 580,
		'min_width'  => 540,
		'min_height' => 380,
		'placement'  => 'taskbar',
		'autofocus'  => true,
	);

	/**
	 * Filter the args passed to `desktop_mode_register_window` for the
	 * messages window.
	 *
	 * @since 0.22.0
	 *
	 * @param array $window_args
	 */
	$window_args = (array) apply_filters( 'wp_desktop_messages_window_args', $window_args );

	$registered = desktop_mode_register_window( 'wpdm-messages', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] Messages window: ' . $registered->get_error_message() );
		return;
	}

	if ( function_exists( 'desktop_mode_register_icon' ) ) {
		desktop_mode_register_icon(
			'wpdm-messages',
			array(
				'title'    => __( 'Messages', 'wp-desktop-messages' ),
				'icon'     => 'dashicons-format-chat',
				'window'   => 'wpdm-messages',
				'position' => 70,
			)
		);
	}
}
add_action( 'init', 'wpdm_messages_register_window', 20 );
