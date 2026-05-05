<?php
/**
 * WP Desktop Messages — bootstrap.
 *
 * Built-in 1-on-1 instant messaging between admins and editors,
 * served as a native desktop window via the `wp-desktop-mode`
 * framework. Conversations are a private custom post type
 * (`wpdm_conversation`); messages are stored as comments with
 * `comment_type = 'wpdm_message'` (defensively filtered so they
 * never leak into the rest of WP). Real-time delivery uses an
 * SSE-while-active + Heartbeat-fallback hybrid.
 *
 * Public PHP surface (full table in framework `docs/messaging.md`
 * + this plugin's hooks header comments):
 *
 *   - filters: `wp_desktop_messages_enabled`, `_allowed_roles`,
 *              `_user_can_use`, `_user_can_message`,
 *              `_messageable_users_query_args`, `_message_content`,
 *              `_outgoing_message_payload`, `_incoming_message_payload`,
 *              `_nudge_sounds`, `_default_sound_id`,
 *              `_presence_inactive_after`, `_presence_offline_after`,
 *              `_typing_throttle_ms`, `_typing_visible_for_ms`,
 *              `_sse_cap_seconds`, `_sse_tick_ms`,
 *              `_sse_reconnect_ms`, `_heartbeat_interval`,
 *              `_max_message_length`, `_send_rate_limit`,
 *              `_window_args`, `_settings_tab_args`.
 *   - actions: `_conversation_created`, `_message_sent`,
 *              `_message_received`, `_message_marked_read`,
 *              `_typing_started`, `_nudge_sent`,
 *              `_presence_changed`.
 *
 * @package WPDesktopMessages
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

require_once WPDM_MESSAGES_PATH . 'includes/caps.php';
require_once WPDM_MESSAGES_PATH . 'includes/post-type.php';
require_once WPDM_MESSAGES_PATH . 'includes/comments-defense.php';
require_once WPDM_MESSAGES_PATH . 'includes/store.php';
require_once WPDM_MESSAGES_PATH . 'includes/presence.php';
require_once WPDM_MESSAGES_PATH . 'includes/typing.php';
require_once WPDM_MESSAGES_PATH . 'includes/sounds.php';
require_once WPDM_MESSAGES_PATH . 'includes/nudge.php';
require_once WPDM_MESSAGES_PATH . 'includes/user-settings.php';
require_once WPDM_MESSAGES_PATH . 'includes/rest.php';
require_once WPDM_MESSAGES_PATH . 'includes/sse.php';
require_once WPDM_MESSAGES_PATH . 'includes/heartbeat.php';
require_once WPDM_MESSAGES_PATH . 'includes/window.php';
require_once WPDM_MESSAGES_PATH . 'includes/settings.php';
require_once WPDM_MESSAGES_PATH . 'includes/assets.php';
require_once WPDM_MESSAGES_PATH . 'includes/cron.php';

/**
 * Plugin-owned realtime-SSE option. Replaces the
 * `desktop_mode_extended_options['messages_realtime_sse_enabled']`
 * key the framework retired in 0.23.0.
 *
 * Stored as a discrete option for cheap reads and so the framework
 * has zero knowledge of it.
 *
 * @since 0.23.0
 *
 * @return bool
 */
function wpdm_messages_realtime_sse_enabled() {
	$enabled = (bool) get_option( 'wpdm_messages_realtime_sse_enabled', false );

	/**
	 * Filter whether SSE is enabled for messages delivery.
	 *
	 * @since 0.23.0
	 *
	 * @param bool $enabled
	 */
	return (bool) apply_filters( 'wp_desktop_messages_realtime_sse_enabled', $enabled );
}
