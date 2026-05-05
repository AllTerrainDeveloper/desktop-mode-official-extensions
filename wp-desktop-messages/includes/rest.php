<?php
/**
 * Desktop Mode — Messages: REST routes.
 *
 * Every routine action (list, fetch, send, mark-read, typing, nudge,
 * settings, sounds, presence, catch-up) routes through
 * `wp-desktop/v1/messages/...`. The SSE stream is the lone exception
 * — it rides admin-ajax (`includes/messages/sse.php`) so it can
 * authenticate via nonce-in-query (EventSource can't send headers).
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Permission gate shared by every messages REST route.
 *
 * @since 0.22.0
 *
 * @return bool|WP_Error
 */
function wpdm_messages_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error( 'rest_forbidden', __( 'Authentication required.', 'wp-desktop-messages' ), array( 'status' => 401 ) );
	}
	if ( ! wpdm_messages_user_can_use() ) {
		return new WP_Error( 'rest_forbidden', __( 'Messages is not available for your account.', 'wp-desktop-messages' ), array( 'status' => 403 ) );
	}
	return true;
}

/**
 * Sanitize message content before insert. Tight `wp_kses` allow-list:
 * inline emphasis + code + paragraphs + line breaks. Filterable so
 * plugins can broaden / narrow.
 *
 * @since 0.22.0
 *
 * @param string $content
 * @param int    $sender_id
 * @return string
 */
function wpdm_messages_sanitize_content( $content, $sender_id ) {
	$allowed = array(
		'a'      => array(
			'href'  => array(),
			'title' => array(),
			'rel'   => array(),
		),
		'b'      => array(),
		'i'      => array(),
		'em'     => array(),
		'strong' => array(),
		'code'   => array(),
		'br'     => array(),
		'p'      => array(),
	);
	$content = wp_kses( (string) $content, $allowed );

	/**
	 * Filter the sanitized message content before insert.
	 *
	 * @since 0.22.0
	 *
	 * @param string $content   Sanitized content.
	 * @param int    $sender_id Author user ID.
	 */
	return (string) apply_filters( 'wp_desktop_messages_message_content', $content, (int) $sender_id );
}

/**
 * Cheap per-user send rate limiter. Bursty sends beyond the cap
 * yield 429 so a single tab can't flood the conversation.
 *
 * @since 0.22.0
 *
 * @param int $sender_id
 * @return bool|WP_Error True on accept, WP_Error 429 on cap.
 */
function wpdm_messages_rate_limit_send( $sender_id ) {
	$conf = (array) apply_filters(
		'wp_desktop_messages_send_rate_limit',
		array(
			'count'       => 30,
			'per_seconds' => 60,
		)
	);
	$count       = max( 1, (int) ( $conf['count'] ?? 30 ) );
	$per_seconds = max( 1, (int) ( $conf['per_seconds'] ?? 60 ) );

	$key   = 'wpdm_messages_rl_' . (int) $sender_id;
	$slot  = (array) get_transient( $key );
	$now   = time();
	$slot  = array_filter(
		$slot,
		function ( $ts ) use ( $now, $per_seconds ) {
			return ( $now - (int) $ts ) <= $per_seconds;
		}
	);
	if ( count( $slot ) >= $count ) {
		return new WP_Error(
			'wpdm_messages_rate_limited',
			__( 'You are sending messages too quickly.', 'wp-desktop-messages' ),
			array( 'status' => 429 )
		);
	}
	$slot[] = $now;
	set_transient( $key, array_values( $slot ), $per_seconds + 5 );
	return true;
}

/**
 * Format a participant user as a directory entry.
 *
 * @since 0.22.0
 *
 * @param WP_User $user
 * @return array
 */
function wpdm_messages_format_user_summary( $user ) {
	$avatar_url = '';
	if ( function_exists( 'get_avatar_url' ) ) {
		$avatar_url = (string) get_avatar_url( $user->ID, array( 'size' => 80 ) );
	}
	$role     = ! empty( $user->roles ) ? (string) $user->roles[0] : '';
	$presence = wpdm_messages_presence_status_for_user( (int) $user->ID );
	$record   = wpdm_messages_presence_get_all();
	$last_seen = isset( $record[ (int) $user->ID ]['last_seen_ms'] ) ? (int) $record[ (int) $user->ID ]['last_seen_ms'] : 0;
	$summary  = array(
		'id'           => (int) $user->ID,
		'displayName'  => (string) $user->display_name,
		'avatarUrl'    => $avatar_url,
		'role'         => $role,
		'presence'     => $presence,
		'lastSeenMs'   => $last_seen,
	);

	/**
	 * Filter a single user-summary entry. Useful for surfacing custom
	 * fields (status text, team, etc.).
	 *
	 * @since 0.22.0
	 *
	 * @param array   $summary
	 * @param WP_User $user
	 */
	return (array) apply_filters( 'wp_desktop_messages_messageable_user', $summary, $user );
}

/**
 * Register every messages REST route.
 *
 * @since 0.22.0
 */
function wpdm_messages_register_rest_routes() {
	$ns        = 'wp-desktop/v1';
	$gate      = 'wpdm_messages_rest_permission';

	register_rest_route(
		$ns,
		'/messages/users',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => $gate,
			'callback'            => 'wpdm_messages_rest_list_users',
			'args'                => array(
				'search'   => array( 'type' => 'string' ),
				'page'     => array( 'type' => 'integer', 'default' => 1 ),
				'per_page' => array( 'type' => 'integer', 'default' => 20 ),
			),
		)
	);

	register_rest_route(
		$ns,
		'/messages/conversations',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $gate,
				'callback'            => 'wpdm_messages_rest_list_conversations',
				'args'                => array(
					'page'     => array( 'type' => 'integer', 'default' => 1 ),
					'per_page' => array( 'type' => 'integer', 'default' => 50 ),
				),
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $gate,
				'callback'            => 'wpdm_messages_rest_create_conversation',
				'args'                => array(
					'recipientId' => array( 'type' => 'integer', 'required' => true ),
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/messages/conversations/(?P<id>\d+)/messages',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $gate,
				'callback'            => 'wpdm_messages_rest_list_messages',
				'args'                => array(
					'id'     => array( 'type' => 'integer' ),
					'before' => array( 'type' => 'integer', 'default' => 0 ),
					'limit'  => array( 'type' => 'integer', 'default' => 50 ),
				),
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $gate,
				'callback'            => 'wpdm_messages_rest_send_message',
				'args'                => array(
					'id'       => array( 'type' => 'integer' ),
					'content'  => array( 'type' => 'string', 'required' => true ),
					'kind'     => array( 'type' => 'string', 'default' => 'text' ),
					'clientId' => array( 'type' => 'string' ),
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/messages/conversations/(?P<id>\d+)/read',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => $gate,
			'callback'            => 'wpdm_messages_rest_mark_read',
			'args'                => array(
				'id'         => array( 'type' => 'integer' ),
				'lastReadId' => array( 'type' => 'integer', 'required' => true ),
			),
		)
	);

	register_rest_route(
		$ns,
		'/messages/conversations/(?P<id>\d+)/typing',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => $gate,
			'callback'            => 'wpdm_messages_rest_typing',
			'args'                => array(
				'id' => array( 'type' => 'integer' ),
			),
		)
	);

	register_rest_route(
		$ns,
		'/messages/conversations/(?P<id>\d+)/nudge',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => $gate,
			'callback'            => 'wpdm_messages_rest_nudge',
			'args'                => array(
				'id'      => array( 'type' => 'integer' ),
				'soundId' => array( 'type' => 'string' ),
			),
		)
	);

	register_rest_route(
		$ns,
		'/messages/since',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => $gate,
			'callback'            => 'wpdm_messages_rest_since',
			'args'                => array(
				'lastEventId' => array( 'type' => 'integer', 'required' => true ),
			),
		)
	);

	register_rest_route(
		$ns,
		'/messages/sounds',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => $gate,
			'callback'            => 'wpdm_messages_rest_sounds',
		)
	);

	register_rest_route(
		$ns,
		'/messages/settings',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $gate,
				'callback'            => 'wpdm_messages_rest_get_settings',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $gate,
				'callback'            => 'wpdm_messages_rest_save_settings',
				'args'                => array(
					'settings' => array( 'type' => 'object', 'required' => true ),
				),
			),
		)
	);

	register_rest_route(
		$ns,
		'/messages/presence',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => $gate,
			'callback'            => 'wpdm_messages_rest_presence',
			'args'                => array(
				'inactive' => array( 'type' => 'boolean' ),
			),
		)
	);

	// Site-level toggles (admins only) — owns the realtime-SSE opt-in
	// that used to live in the framework's `desktop_mode_extended_options`
	// blob before the messages module was extracted into its own plugin.
	$admin_gate = static function () {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'rest_forbidden', __( 'Authentication required.', 'wp-desktop-messages' ), array( 'status' => 401 ) );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error( 'rest_forbidden', __( 'Only administrators can change site-level messages settings.', 'wp-desktop-messages' ), array( 'status' => 403 ) );
		}
		return true;
	};

	register_rest_route(
		$ns,
		'/messages/site-settings',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'permission_callback' => $admin_gate,
				'callback'            => 'wpdm_messages_rest_get_site_settings',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'permission_callback' => $admin_gate,
				'callback'            => 'wpdm_messages_rest_save_site_settings',
				'args'                => array(
					'options' => array( 'type' => 'object', 'required' => true ),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'wpdm_messages_register_rest_routes' );

/**
 * GET /messages/site-settings — return the admin-only toggle blob.
 *
 * Shape matches `MessagesSiteSettings` in `src/types.ts`:
 *
 *   { realtime_sse_enabled: bool }
 *
 * @since 0.23.0
 *
 * @return array
 */
function wpdm_messages_rest_get_site_settings() {
	return array(
		'realtime_sse_enabled' => wpdm_messages_realtime_sse_enabled(),
	);
}

/**
 * POST /messages/site-settings — persist the admin-only toggle blob.
 *
 * @since 0.23.0
 *
 * @param WP_REST_Request $request
 * @return array Updated site-settings.
 */
function wpdm_messages_rest_save_site_settings( $request ) {
	$options = (array) $request->get_param( 'options' );

	if ( array_key_exists( 'realtime_sse_enabled', $options ) ) {
		update_option(
			'wpdm_messages_realtime_sse_enabled',
			! empty( $options['realtime_sse_enabled'] ) ? 1 : 0,
			false
		);
	}

	return wpdm_messages_rest_get_site_settings();
}

/* -------------------------------------------------------------------------
 * Route callbacks
 * ----------------------------------------------------------------------- */

/**
 * GET /messages/users — paginated directory of users the current
 * user can DM.
 */
function wpdm_messages_rest_list_users( WP_REST_Request $request ) {
	$current = get_current_user_id();
	$search  = (string) $request->get_param( 'search' );
	$page    = max( 1, (int) $request->get_param( 'page' ) ?: 1 );
	$per     = max( 1, min( 100, (int) $request->get_param( 'per_page' ) ?: 20 ) );

	$args = array(
		'role__in' => wpdm_messages_allowed_roles(),
		'exclude'  => array( $current ),
		'number'   => $per,
		'paged'    => $page,
		'orderby'  => 'display_name',
		'order'    => 'ASC',
	);
	if ( '' !== $search ) {
		$args['search']         = '*' . esc_attr( $search ) . '*';
		$args['search_columns'] = array( 'user_login', 'user_nicename', 'display_name' );
	}

	/**
	 * Filter the WP_User_Query args used to enumerate directory users.
	 *
	 * @since 0.22.0
	 *
	 * @param array $args
	 */
	$args = (array) apply_filters( 'wp_desktop_messages_messageable_users_query_args', $args );

	$query = new WP_User_Query( $args );
	$users = array();
	foreach ( $query->get_results() as $user ) {
		if ( ! $user instanceof WP_User ) {
			continue;
		}
		// Drop users the current user can't DM (per `_user_can_message`).
		if ( ! wpdm_messages_user_can_message( $current, $user->ID ) ) {
			continue;
		}
		$users[] = wpdm_messages_format_user_summary( $user );
	}
	return rest_ensure_response(
		array(
			'users' => $users,
			'total' => (int) $query->get_total(),
		)
	);
}

/** GET /messages/conversations */
function wpdm_messages_rest_list_conversations( WP_REST_Request $request ) {
	$page = max( 1, (int) $request->get_param( 'page' ) ?: 1 );
	$per  = max( 1, min( 100, (int) $request->get_param( 'per_page' ) ?: 50 ) );
	$out  = wpdm_messages_query_conversations_for_user(
		get_current_user_id(),
		array( 'page' => $page, 'per_page' => $per )
	);
	// Enrich each conversation with the other user's summary.
	foreach ( $out['conversations'] as &$c ) {
		$other = get_userdata( (int) $c['otherUserId'] );
		$c['otherUser'] = $other instanceof WP_User
			? wpdm_messages_format_user_summary( $other )
			: null;
	}
	return rest_ensure_response( $out );
}

/** POST /messages/conversations */
function wpdm_messages_rest_create_conversation( WP_REST_Request $request ) {
	$current   = get_current_user_id();
	$recipient = (int) $request->get_param( 'recipientId' );
	if ( ! wpdm_messages_user_can_message( $current, $recipient ) ) {
		return new WP_Error( 'wpdm_messages_forbidden', __( 'Cannot message this user.', 'wp-desktop-messages' ), array( 'status' => 403 ) );
	}
	$id = wpdm_messages_get_or_create_conversation( $current, $recipient );
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	$out = wpdm_messages_query_conversations_for_user( $current, array( 'per_page' => 100 ) );
	foreach ( $out['conversations'] as $c ) {
		if ( (int) $c['id'] === (int) $id ) {
			$other = get_userdata( (int) $c['otherUserId'] );
			$c['otherUser'] = $other instanceof WP_User
				? wpdm_messages_format_user_summary( $other )
				: null;
			return rest_ensure_response( array( 'conversation' => $c ) );
		}
	}
	return new WP_Error( 'wpdm_messages_unexpected', __( 'Conversation created but could not be located.', 'wp-desktop-messages' ), array( 'status' => 500 ) );
}

/** GET /messages/conversations/{id}/messages */
function wpdm_messages_rest_list_messages( WP_REST_Request $request ) {
	$conv_id = (int) $request['id'];
	$before  = (int) $request->get_param( 'before' );
	$limit   = (int) $request->get_param( 'limit' );
	if ( ! wpdm_messages_is_participant( $conv_id, get_current_user_id() ) ) {
		return new WP_Error( 'wpdm_messages_forbidden', __( 'Not a participant.', 'wp-desktop-messages' ), array( 'status' => 403 ) );
	}
	$out = wpdm_messages_query_messages( $conv_id, array( 'before' => $before, 'limit' => $limit ?: 50 ) );
	return rest_ensure_response(
		array(
			'messages'  => $out['messages'],
			'hasMore'   => (bool) $out['has_more'],
			'oldestId'  => (int) $out['oldest_id'],
		)
	);
}

/** POST /messages/conversations/{id}/messages */
function wpdm_messages_rest_send_message( WP_REST_Request $request ) {
	$conv_id  = (int) $request['id'];
	$current  = get_current_user_id();
	if ( ! wpdm_messages_is_participant( $conv_id, $current ) ) {
		return new WP_Error( 'wpdm_messages_forbidden', __( 'Not a participant.', 'wp-desktop-messages' ), array( 'status' => 403 ) );
	}
	$rl = wpdm_messages_rate_limit_send( $current );
	if ( is_wp_error( $rl ) ) {
		return $rl;
	}
	$content = (string) $request->get_param( 'content' );
	$kind    = (string) $request->get_param( 'kind' );
	if ( '' === $kind ) {
		$kind = 'text';
	}
	if ( ! in_array( $kind, array( 'text', 'nudge' ), true ) ) {
		return new WP_Error( 'wpdm_messages_invalid_kind', __( 'Invalid message kind.', 'wp-desktop-messages' ), array( 'status' => 400 ) );
	}

	$max_len = (int) apply_filters( 'wp_desktop_messages_max_message_length', 4000 );
	if ( strlen( $content ) > $max_len ) {
		return new WP_Error( 'wpdm_messages_too_long', __( 'Message too long.', 'wp-desktop-messages' ), array( 'status' => 400 ) );
	}

	if ( 'nudge' === $kind ) {
		$id = wpdm_messages_send_nudge( $conv_id, $current, $content );
		if ( is_wp_error( $id ) ) {
			return $id;
		}
	} else {
		$content = wpdm_messages_sanitize_content( $content, $current );
		if ( '' === trim( wp_strip_all_tags( $content ) ) ) {
			return new WP_Error( 'wpdm_messages_empty', __( 'Message cannot be empty.', 'wp-desktop-messages' ), array( 'status' => 400 ) );
		}
		// Outgoing-payload filter: lets plugins inspect / mutate.
		$payload = (array) apply_filters(
			'wp_desktop_messages_outgoing_message_payload',
			array( 'content' => $content ),
			$current,
			$conv_id
		);
		$content = isset( $payload['content'] ) ? (string) $payload['content'] : $content;
		$id      = wpdm_messages_insert_message( $conv_id, $current, $content, 'text' );
		if ( is_wp_error( $id ) ) {
			return $id;
		}
	}

	$comment = get_comment( $id );
	return rest_ensure_response( array( 'message' => $comment ? wpdm_messages_format_message_row( $comment ) : null ) );
}

/** POST /messages/conversations/{id}/read */
function wpdm_messages_rest_mark_read( WP_REST_Request $request ) {
	$conv_id      = (int) $request['id'];
	$last_read_id = (int) $request->get_param( 'lastReadId' );
	$current      = get_current_user_id();
	if ( ! wpdm_messages_is_participant( $conv_id, $current ) ) {
		return new WP_Error( 'wpdm_messages_forbidden', __( 'Not a participant.', 'wp-desktop-messages' ), array( 'status' => 403 ) );
	}
	wpdm_messages_mark_read( $conv_id, $current, $last_read_id );
	return rest_ensure_response( array( 'ok' => true, 'unreadCount' => 0 ) );
}

/** POST /messages/conversations/{id}/typing */
function wpdm_messages_rest_typing( WP_REST_Request $request ) {
	$conv_id = (int) $request['id'];
	$current = get_current_user_id();
	if ( ! wpdm_messages_is_participant( $conv_id, $current ) ) {
		return new WP_Error( 'wpdm_messages_forbidden', __( 'Not a participant.', 'wp-desktop-messages' ), array( 'status' => 403 ) );
	}
	$until_ms = wpdm_messages_record_typing( $conv_id, $current );
	return rest_ensure_response( array( 'ok' => true, 'untilMs' => (int) ( $until_ms ?: 0 ) ) );
}

/** POST /messages/conversations/{id}/nudge */
function wpdm_messages_rest_nudge( WP_REST_Request $request ) {
	$conv_id  = (int) $request['id'];
	$sound_id = (string) $request->get_param( 'soundId' );
	$current  = get_current_user_id();
	$id       = wpdm_messages_send_nudge( $conv_id, $current, $sound_id );
	if ( is_wp_error( $id ) ) {
		return $id;
	}
	$comment = get_comment( $id );
	return rest_ensure_response( array( 'ok' => true, 'message' => $comment ? wpdm_messages_format_message_row( $comment ) : null ) );
}

/**
 * GET /messages/since
 *
 * **Cursor contract.** `cursor` returned in the body is the
 * ABSOLUTE max comment_ID across the user's full inbox, NOT just
 * the max of the (LIMIT-200-truncated) row payload. This lets a
 * client receiving an incomplete batch still advance its
 * "I've seen up to here" watermark in one round-trip. Without
 * this distinction, a user with >200 historical messages would
 * see a toast storm on every reload — bootstrap caps at the
 * 200th oldest, the next poll tick treats messages 201+ as
 * brand-new, and `handleIncomingMessage` fires a toast for each.
 */
function wpdm_messages_rest_since( WP_REST_Request $request ) {
	$since   = (int) $request->get_param( 'lastEventId' );
	$current = get_current_user_id();
	$rows    = wpdm_messages_query_messages_since_for_user( $current, $since );
	$cursor  = wpdm_messages_max_message_id_for_user( $current, $since );
	if ( $cursor < $since ) {
		$cursor = $since;
	}
	return rest_ensure_response( array( 'messages' => $rows, 'cursor' => (int) $cursor ) );
}

/** GET /messages/sounds */
function wpdm_messages_rest_sounds() {
	return rest_ensure_response(
		array(
			'sounds'         => wpdm_messages_get_registered_sounds(),
			'defaultSoundId' => wpdm_messages_default_sound_id(),
		)
	);
}

/** GET /messages/settings */
function wpdm_messages_rest_get_settings() {
	return rest_ensure_response( wpdm_messages_get_user_settings( get_current_user_id() ) );
}

/** POST /messages/settings */
function wpdm_messages_rest_save_settings( WP_REST_Request $request ) {
	$payload = $request->get_param( 'settings' );
	wpdm_messages_save_user_settings( get_current_user_id(), $payload );
	return rest_ensure_response( wpdm_messages_get_user_settings( get_current_user_id() ) );
}

/** POST /messages/presence — explicit user-set inactive (e.g., a "set inactive" toggle). */
function wpdm_messages_rest_presence( WP_REST_Request $request ) {
	$inactive = (bool) $request->get_param( 'inactive' );
	$current  = get_current_user_id();
	if ( $inactive ) {
		// Bump last_seen but NOT last_active so the status calc lands
		// on `inactive` immediately.
		$all  = wpdm_messages_presence_get_all();
		$rec  = isset( $all[ $current ] ) && is_array( $all[ $current ] ) ? $all[ $current ] : array(
			'last_seen_ms'   => 0,
			'last_active_ms' => 0,
		);
		$rec['last_seen_ms']    = (int) round( microtime( true ) * 1000 );
		$rec['last_active_ms']  = 0;
		$all[ $current ]        = $rec;
		update_option( WPDM_MESSAGES_PRESENCE_OPTION, $all, false );
	} else {
		wpdm_messages_record_presence( $current, true );
	}
	return rest_ensure_response( array( 'ok' => true ) );
}
