<?php
/**
 * Desktop Mode — Messages: Heartbeat fallback.
 *
 * When the chat window is closed, the always-loaded shell module
 * piggy-backs on the WordPress Heartbeat ticks (interval lowered to
 * `_heartbeat_interval`, default 5s) to deliver new-message
 * signals + presence + unread counts.
 *
 * Pattern mirrors `includes/recycle-bin/realtime.php` — opt-in
 * client flag (`wpdm_messages_active`) so users without the chat
 * loaded pay zero per tick.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Lower the Heartbeat interval to make message delivery bearable
 * when SSE isn't open. Filterable per-environment so a busy host
 * can dial it back.
 *
 * @since 0.22.0
 *
 * @param array $settings
 * @return array
 */
function wpdm_messages_heartbeat_settings( $settings ) {
	if ( ! function_exists( 'desktop_mode_is_enabled' ) || ! desktop_mode_is_enabled() ) {
		return $settings;
	}
	if ( ! wpdm_messages_user_can_use() ) {
		return $settings;
	}
	$interval = max(
		3,
		min(
			60,
			(int) apply_filters( 'wp_desktop_messages_heartbeat_interval', 5 )
		)
	);
	$settings['interval'] = $interval;
	return $settings;
}
add_filter( 'heartbeat_settings', 'wpdm_messages_heartbeat_settings' );

/**
 * Heartbeat handler. Only runs work when the client opts in via
 * `wpdm_messages_active: true`.
 *
 * Presence recording is OWNED by the framework as of 0.5.5 — this
 * handler relies on `desktop_mode_presence_heartbeat_received`
 * (priority 5, registered in `includes/presence.php`) to bump the
 * user's last-seen / last-active before this handler runs at
 * priority 10. We just attach the messages-specific payload (unread
 * counts, since-cursor delivery) and the conversation-scoped
 * presence subset.
 *
 * @since 0.22.0
 *
 * @param array $response Pre-filtered response.
 * @param array $data     Client-sent payload.
 * @return array
 */
function wpdm_messages_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( ! isset( $data['wpdm_messages_active'] ) ) {
		return $response;
	}
	if ( ! wpdm_messages_user_can_use() ) {
		return $response;
	}
	$user_id       = (int) get_current_user_id();
	$last_event_id = isset( $data['wpdm_messages_seen_id'] ) ? (int) $data['wpdm_messages_seen_id'] : 0;

	$response['wpdm_messages'] = array(
		'unreadByConversation' => wpdm_messages_unread_counts_for_user( $user_id ),
		'totalUnread'          => wpdm_messages_total_unread_for_user( $user_id ),
		'newSinceLastSeen'     => wpdm_messages_query_messages_since_for_user( $user_id, $last_event_id ),
		'presence'             => wpdm_messages_presence_snapshot_for_user( $user_id ),
		'serverTimeMs'         => (int) round( microtime( true ) * 1000 ),
	);
	return $response;
}
add_filter( 'heartbeat_received', 'wpdm_messages_heartbeat_received', 10, 2 );
