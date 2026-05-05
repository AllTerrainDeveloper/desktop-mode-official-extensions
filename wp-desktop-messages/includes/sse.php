<?php
/**
 * Desktop Mode — Messages: SSE controller.
 *
 * Long-lived `text/event-stream` worker that the chat-window's
 * tab-elected leader holds open while the chat window is mounted.
 * Streams `message`, `typing`, `presence`, `nudge`, and `close`
 * events; reconnects every `_sse_reconnect_ms` (default 1000).
 *
 * Uses admin-ajax (not REST) because EventSource can't send headers
 * — the nonce travels in the query string. Same pattern as
 * `wp_ajax_desktop_mode_ai_search_stream` (see
 * `includes/ai-copilot/search.php`).
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Handle the EventSource connection.
 *
 * URL: `/wp-admin/admin-ajax.php?action=wpdm_messages_stream&nonce=…&last_event_id=…`
 *
 * @since 0.22.0
 */
function wpdm_messages_ajax_stream() {
	$nonce = isset( $_GET['nonce'] ) ? (string) $_GET['nonce'] : '';
	if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
		status_header( 403 );
		exit;
	}
	if ( ! is_user_logged_in() ) {
		status_header( 401 );
		exit;
	}
	$user_id = (int) get_current_user_id();
	if ( ! wpdm_messages_user_can_use( $user_id ) ) {
		status_header( 403 );
		exit;
	}

	// Non-blocking setup. session_write_close so concurrent requests
	// don't queue behind us; drain output buffers; ignore client
	// abort so we can detect it ourselves; remove the time limit.
	if ( PHP_SESSION_ACTIVE === session_status() ) {
		session_write_close();
	}
	while ( ob_get_level() > 0 ) {
		// phpcs:ignore Generic.PHP.NoSilencedErrors.Discouraged
		@ob_end_flush();
	}
	// phpcs:ignore Generic.PHP.NoSilencedErrors.Discouraged
	@ini_set( 'output_buffering', 'off' );
	// phpcs:ignore Generic.PHP.NoSilencedErrors.Discouraged
	@ini_set( 'zlib.output_compression', 'off' );
	ignore_user_abort( true );
	// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,Generic.PHP.NoSilencedErrors.Discouraged
	@set_time_limit( 0 );

	// SSE headers, including nginx-friendly disable of buffering.
	header( 'Content-Type: text/event-stream; charset=utf-8' );
	header( 'Cache-Control: no-cache, no-store, must-revalidate' );
	header( 'X-Accel-Buffering: no' );
	header( 'Connection: keep-alive' );

	// Inputs.
	$header_id     = isset( $_SERVER['HTTP_LAST_EVENT_ID'] ) ? (int) $_SERVER['HTTP_LAST_EVENT_ID'] : 0;
	$query_id      = isset( $_GET['last_event_id'] ) ? (int) $_GET['last_event_id'] : 0;
	$last_event_id = max( 0, max( $header_id, $query_id ) );

	$cap_seconds  = (int) apply_filters( 'wp_desktop_messages_sse_cap_seconds', 25 );
	$tick_ms      = (int) apply_filters( 'wp_desktop_messages_sse_tick_ms', 1000 );
	$reconnect_ms = (int) apply_filters( 'wp_desktop_messages_sse_reconnect_ms', 1000 );

	// Tell the browser to wait $reconnect_ms before reopening on close.
	echo "retry: " . (int) $reconnect_ms . "\n\n";
	// phpcs:ignore Generic.PHP.NoSilencedErrors.Discouraged
	@ob_flush();
	flush();

	$emit = function ( $event_type, $payload, $event_id = null ) {
		if ( null !== $event_id ) {
			echo 'id: ' . (int) $event_id . "\n";
		}
		echo 'event: ' . preg_replace( '/[^a-z0-9_-]/i', '', (string) $event_type ) . "\n";
		echo 'data: ' . wp_json_encode( $payload ) . "\n\n";
		// phpcs:ignore Generic.PHP.NoSilencedErrors.Discouraged
		@ob_flush();
		flush();
	};

	// Initial open ack — also sets the server clock so the client
	// can compute drift.
	$emit( 'open', array( 'serverTimeMs' => (int) round( microtime( true ) * 1000 ) ) );

	/**
	 * Fires when an SSE connection opens. Pair with `_sse_event_emitted`
	 * for full traffic visibility (sample-only — the action runs once
	 * per emitted event).
	 *
	 * @since 0.22.0
	 *
	 * @param int $user_id
	 * @param int $last_event_id
	 */
	do_action( 'wp_desktop_messages_sse_connection_opened', $user_id, $last_event_id );

	$cursor     = $last_event_id;
	$started_at = time();
	$last_pres  = 0;
	$tick_us    = max( 100, (int) $tick_ms ) * 1000;

	while ( ( time() - $started_at ) < $cap_seconds ) {
		if ( connection_aborted() ) {
			exit;
		}

		// 1. New messages since the cursor in any conversation $user_id participates in.
		$rows = wpdm_messages_query_messages_since_for_user( $user_id, $cursor );
		foreach ( $rows as $row ) {
			$cursor = (int) $row['id'];
			// Per-recipient payload filter — lets a plugin redact / mutate
			// before the event hits the wire (compliance, encryption-at-edge).
			$row = (array) apply_filters(
				'wp_desktop_messages_incoming_message_payload',
				$row,
				$user_id,
				(int) $row['conversationId']
			);
			$event_type = ( ( $row['kind'] ?? 'text' ) === 'nudge' ) ? 'nudge' : 'message';
			$emit( $event_type, $row, $cursor );

			/**
			 * Action mirror — useful for monitoring. Subscribe sparingly.
			 *
			 * @since 0.22.0
			 *
			 * @param string $event_type
			 * @param array  $payload
			 * @param int    $user_id
			 */
			do_action( 'wp_desktop_messages_sse_event_emitted', $event_type, $row, $user_id );
		}

		// 2. Typing — only emit when there's something to say.
		$typing = wpdm_messages_typing_snapshot_for_user( $user_id );
		if ( ! empty( $typing ) ) {
			$emit( 'typing', $typing );
		}

		// 3. Presence — every ~3 ticks.
		if ( ( time() - $last_pres ) >= 3 ) {
			$last_pres = time();
			$pres      = wpdm_messages_presence_snapshot_for_user( $user_id );
			if ( ! empty( $pres ) ) {
				$emit( 'presence', $pres );
			}
			// Bump our own presence — being on the SSE counts as "alive".
			wpdm_messages_record_presence( $user_id, true );
		}

		usleep( $tick_us );
	}

	$emit( 'close', array( 'reason' => 'cap', 'lastEventId' => (int) $cursor ) );
	exit;
}
add_action( 'wp_ajax_wpdm_messages_stream', 'wpdm_messages_ajax_stream' );
