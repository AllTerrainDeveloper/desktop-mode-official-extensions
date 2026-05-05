<?php
/**
 * Desktop Mode — Messages: storage layer.
 *
 * High-level read/write helpers wrapping the `wpdm_conversation`
 * post type and `wpdm_message` comment-type rows. Every helper
 * runs inside the internal-query flag so the comments-defense
 * filters bypass our own queries.
 *
 * Public surface:
 *
 *   - `wpdm_messages_get_or_create_conversation( $a, $b )`
 *   - `wpdm_messages_insert_message( $conv_id, $sender_id, $content, $kind )`
 *   - `wpdm_messages_query_messages( $conv_id, $args )`
 *   - `wpdm_messages_query_conversations_for_user( $user_id, $args )`
 *   - `wpdm_messages_mark_read( $conv_id, $reader_id, $last_read_id )`
 *   - `wpdm_messages_unread_counts_for_user( $user_id )`
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Generate a unique conversation slug. Retries up to 5 times on
 * collision (astronomically rare for 12 hex chars = 48 bits) then
 * fails closed with `wp_die` rather than allowing a degenerate slug.
 *
 * @since 0.22.0
 *
 * @return string Slug like `wpdm-conv-abcdef012345`.
 */
function wpdm_messages_generate_conversation_slug() {
	for ( $i = 0; $i < 5; $i++ ) {
		// `wp_generate_password` with `false` gives lower-case
		// alphanumerics. Matches the docs's stated `[a-z0-9]{12}`.
		$candidate = 'wpdm-conv-' . strtolower( wp_generate_password( 12, false, false ) );
		$exists    = get_page_by_path( $candidate, OBJECT, 'wpdm_conversation' );
		if ( ! $exists ) {
			return $candidate;
		}
	}
	wp_die(
		esc_html__( 'Could not generate a unique conversation slug after 5 retries.', 'wp-desktop-messages' )
	);
}

/**
 * Sort a list of user IDs ASC and ensure uniqueness — the
 * canonical participants representation. Drops zero / negative
 * values (non-users) defensively.
 *
 * @since 0.22.0
 *
 * @param int[] $user_ids
 * @return int[]
 */
function wpdm_messages_normalize_participants( $user_ids ) {
	$ints = array();
	foreach ( (array) $user_ids as $u ) {
		$id = (int) $u;
		if ( $id > 0 ) {
			$ints[] = $id;
		}
	}
	$ints = array_values( array_unique( $ints ) );
	sort( $ints, SORT_NUMERIC );
	return $ints;
}

/**
 * Find an existing 1-on-1 conversation between two users (in any
 * order) or create one. Always returns the post ID.
 *
 * @since 0.22.0
 *
 * @param int $user_a
 * @param int $user_b
 * @return int|WP_Error
 */
function wpdm_messages_get_or_create_conversation( $user_a, $user_b ) {
	$participants = wpdm_messages_normalize_participants( array( $user_a, $user_b ) );
	if ( count( $participants ) !== 2 ) {
		return new WP_Error(
			'wpdm_messages_invalid_participants',
			__( 'A 1-on-1 conversation requires two distinct user ids.', 'wp-desktop-messages' )
		);
	}

	// Look for an existing conversation with the same participants.
	$existing = get_posts(
		array(
			'post_type'      => 'wpdm_conversation',
			'post_status'    => 'publish',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'no_found_rows'  => true,
			'meta_query'     => array(
				array(
					'key'     => '_wpdm_conv_participants',
					'value'   => maybe_serialize( $participants ),
					'compare' => '=',
				),
			),
		)
	);
	if ( ! empty( $existing ) ) {
		return (int) $existing[0];
	}

	$slug = wpdm_messages_generate_conversation_slug();
	$post_id = wp_insert_post(
		array(
			'post_type'   => 'wpdm_conversation',
			'post_status' => 'publish',
			'post_title'  => $slug,
			'post_name'   => $slug,
			'post_author' => (int) get_current_user_id() ?: $participants[0],
		),
		true
	);
	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}

	update_post_meta( $post_id, '_wpdm_conv_participants', $participants );
	update_post_meta( $post_id, '_wpdm_conv_last_message_ts_ms', 0 );
	update_post_meta( $post_id, '_wpdm_conv_last_message_preview', '' );
	update_post_meta( $post_id, '_wpdm_conv_last_message_user_id', 0 );
	update_post_meta( $post_id, '_wpdm_conv_read_state', array() );
	update_post_meta( $post_id, '_wpdm_conv_typing_until_ms', array() );

	/**
	 * Fires after a new conversation post is created.
	 *
	 * @since 0.22.0
	 *
	 * @param int   $conversation_id Post ID.
	 * @param int[] $participants    Sorted participant user IDs.
	 * @param int   $creator_id      User who triggered the creation.
	 */
	do_action( 'wp_desktop_messages_conversation_created', (int) $post_id, $participants, (int) get_current_user_id() );

	return (int) $post_id;
}

/**
 * Insert a message into a conversation. Bypasses `wp_new_comment` —
 * we set `comment_approved = 1` directly so Akismet, moderation,
 * and notification emails never run.
 *
 * @since 0.22.0
 *
 * @param int    $conversation_id wpdm_conversation post ID.
 * @param int    $sender_id       Author of the message.
 * @param string $content         Message body (already sanitized by caller).
 * @param string $kind            'text' (default), 'nudge', or 'system'.
 * @param array  $payload         Optional kind-specific payload (encoded into _wpdm_msg_payload_json meta).
 * @return int|WP_Error           New comment ID or error.
 */
function wpdm_messages_insert_message( $conversation_id, $sender_id, $content, $kind = 'text', $payload = array() ) {
	$conversation_id = (int) $conversation_id;
	$sender_id       = (int) $sender_id;
	$kind            = (string) $kind;
	if ( $conversation_id <= 0 || $sender_id <= 0 ) {
		return new WP_Error( 'wpdm_messages_invalid_args', __( 'Conversation and sender are required.', 'wp-desktop-messages' ) );
	}
	if ( ! in_array( $kind, array( 'text', 'nudge', 'system' ), true ) ) {
		$kind = 'text';
	}

	$user = get_userdata( $sender_id );
	if ( ! $user instanceof WP_User ) {
		return new WP_Error( 'wpdm_messages_invalid_sender', __( 'Sender user not found.', 'wp-desktop-messages' ) );
	}

	$now      = current_time( 'mysql' );
	$now_gmt  = current_time( 'mysql', true );
	$now_ms   = (int) round( microtime( true ) * 1000 );

	$comment_id = wp_insert_comment(
		array(
			'comment_post_ID'      => $conversation_id,
			'comment_author'       => $user->display_name,
			'comment_author_email' => $user->user_email,
			'comment_author_url'   => '',
			'comment_author_IP'    => '',
			'comment_agent'        => '',
			'comment_content'      => (string) $content,
			'comment_type'         => 'wpdm_message',
			'comment_approved'     => 1,
			'user_id'              => $sender_id,
			'comment_parent'       => 0,
			'comment_date'         => $now,
			'comment_date_gmt'     => $now_gmt,
		)
	);
	if ( ! $comment_id ) {
		return new WP_Error( 'wpdm_messages_insert_failed', __( 'Failed to insert message.', 'wp-desktop-messages' ) );
	}

	add_comment_meta( $comment_id, '_wpdm_msg_kind', $kind );
	if ( ! empty( $payload ) ) {
		add_comment_meta( $comment_id, '_wpdm_msg_payload_json', wp_json_encode( $payload ) );
	}

	// Bump the conversation's last-message cursors for fast list-sort.
	update_post_meta( $conversation_id, '_wpdm_conv_last_message_ts_ms', $now_ms );
	update_post_meta(
		$conversation_id,
		'_wpdm_conv_last_message_preview',
		wpdm_messages_make_preview( (string) $content, $kind )
	);
	update_post_meta( $conversation_id, '_wpdm_conv_last_message_user_id', $sender_id );

	/**
	 * Fires after a message is successfully inserted.
	 *
	 * @since 0.22.0
	 *
	 * @param int    $message_id      New comment ID.
	 * @param int    $conversation_id Owning conversation post ID.
	 * @param int    $sender_id       Sender user ID.
	 * @param array  $payload         { kind, content }.
	 */
	do_action(
		'wp_desktop_messages_message_sent',
		(int) $comment_id,
		$conversation_id,
		$sender_id,
		array(
			'kind'    => $kind,
			'content' => (string) $content,
		)
	);

	// Per-recipient action — useful for plugins that want to forward
	// to email or sms. Skip the sender themselves.
	$participants = (array) get_post_meta( $conversation_id, '_wpdm_conv_participants', true );
	foreach ( $participants as $uid ) {
		$uid = (int) $uid;
		if ( $uid === $sender_id ) {
			continue;
		}
		/**
		 * Per-recipient delivery action.
		 *
		 * @since 0.22.0
		 *
		 * @param int $message_id      New comment ID.
		 * @param int $conversation_id Owning conversation post ID.
		 * @param int $recipient_id    Recipient user ID.
		 */
		do_action( 'wp_desktop_messages_message_received', (int) $comment_id, $conversation_id, $uid );
	}

	return (int) $comment_id;
}

/**
 * Build a sanitized 140-char preview from a message body.
 *
 * @since 0.22.0
 *
 * @param string $content Raw content.
 * @param string $kind    Message kind.
 * @return string
 */
function wpdm_messages_make_preview( $content, $kind = 'text' ) {
	if ( 'nudge' === $kind ) {
		return '👋 ' . __( 'sent a nudge', 'wp-desktop-messages' );
	}
	$plain = wp_strip_all_tags( (string) $content );
	$plain = trim( preg_replace( '/\s+/u', ' ', $plain ) );
	if ( function_exists( 'mb_substr' ) ) {
		return mb_substr( $plain, 0, 140 );
	}
	return substr( $plain, 0, 140 );
}

/**
 * Query messages in a conversation. Callers must check participation
 * first; this helper does NOT gate.
 *
 * @since 0.22.0
 *
 * @param int   $conversation_id wpdm_conversation post ID.
 * @param array $args            { before?: int comment_ID, limit?: int }.
 * @return array { messages: array, has_more: bool, oldest_id: int }
 */
function wpdm_messages_query_messages( $conversation_id, $args = array() ) {
	$conversation_id = (int) $conversation_id;
	$limit           = isset( $args['limit'] ) ? max( 1, min( 200, (int) $args['limit'] ) ) : 50;
	$before          = isset( $args['before'] ) ? (int) $args['before'] : 0;

	$query_args = array(
		'post_id' => $conversation_id,
		'type'    => 'wpdm_message',
		'status'  => 'approve',
		'orderby' => 'comment_ID',
		'order'   => 'DESC',
		'number'  => $limit + 1,
	);
	if ( $before > 0 ) {
		$query_args['comment__not_in'] = array( $before );
		// Use `<` semantics: select rows with smaller IDs (older).
		$query_args['date_query'] = array(); // unused but present for clarity
	}

	wpdm_messages_internal_query( true );
	$comments = get_comments( $query_args );
	wpdm_messages_internal_query( false );

	if ( $before > 0 ) {
		$comments = array_filter(
			$comments,
			function ( $c ) use ( $before ) {
				return (int) $c->comment_ID < $before;
			}
		);
	}
	$comments = array_values( $comments );

	$has_more = count( $comments ) > $limit;
	if ( $has_more ) {
		$comments = array_slice( $comments, 0, $limit );
	}

	// Reverse to chronological order before returning.
	$comments = array_reverse( $comments );
	$rows     = array();
	foreach ( $comments as $c ) {
		$rows[] = wpdm_messages_format_message_row( $c );
	}

	return array(
		'messages'  => $rows,
		'has_more'  => $has_more,
		'oldest_id' => empty( $rows ) ? 0 : (int) $rows[0]['id'],
	);
}

/**
 * Format a `WP_Comment` into the public message-row shape used by
 * REST + SSE. Read meta in one call to avoid N+1 queries.
 *
 * @since 0.22.0
 *
 * @param WP_Comment|object $c Raw comment row.
 * @return array
 */
function wpdm_messages_format_message_row( $c ) {
	$kind        = (string) get_comment_meta( $c->comment_ID, '_wpdm_msg_kind', true );
	$payload_raw = (string) get_comment_meta( $c->comment_ID, '_wpdm_msg_payload_json', true );
	$payload     = '' !== $payload_raw ? json_decode( $payload_raw, true ) : null;
	if ( ! is_array( $payload ) ) {
		$payload = null;
	}
	if ( '' === $kind ) {
		$kind = 'text';
	}
	$created_ms = strtotime( $c->comment_date_gmt . ' UTC' ) * 1000;
	return array(
		'id'              => (int) $c->comment_ID,
		'conversationId'  => (int) $c->comment_post_ID,
		'authorId'        => (int) $c->user_id,
		'kind'            => $kind,
		'content'         => (string) $c->comment_content,
		'payload'         => $payload,
		'createdAtMs'     => (int) $created_ms,
	);
}

/**
 * Query the conversation list for a user, sorted by most-recent
 * activity. Returns participant + last-message metadata so the
 * conversation list can render without N+1 lookups.
 *
 * @since 0.22.0
 *
 * @param int   $user_id
 * @param array $args { page?: int, per_page?: int }
 * @return array { conversations: array, total: int }
 */
function wpdm_messages_query_conversations_for_user( $user_id, $args = array() ) {
	$user_id  = (int) $user_id;
	$page     = max( 1, isset( $args['page'] ) ? (int) $args['page'] : 1 );
	$per_page = max( 1, min( 100, isset( $args['per_page'] ) ? (int) $args['per_page'] : 50 ) );

	$query = new WP_Query(
		array(
			'post_type'      => 'wpdm_conversation',
			'post_status'    => 'publish',
			'fields'         => 'ids',
			'meta_key'       => '_wpdm_conv_last_message_ts_ms',
			'orderby'        => 'meta_value_num',
			'order'          => 'DESC',
			'posts_per_page' => $per_page,
			'paged'          => $page,
			'no_found_rows'  => false,
			'meta_query'     => array(
				array(
					'key'     => '_wpdm_conv_participants',
					'value'   => sprintf( ';i:%d;', $user_id ),
					'compare' => 'LIKE',
				),
			),
		)
	);

	$out = array();
	foreach ( $query->posts as $pid ) {
		$pid          = (int) $pid;
		$participants = (array) get_post_meta( $pid, '_wpdm_conv_participants', true );
		// Defense in depth: confirm the user is actually in the participants list
		// (the LIKE meta_query catches false-positive substring matches).
		$participants_int = array_map( 'intval', $participants );
		if ( ! in_array( $user_id, $participants_int, true ) ) {
			continue;
		}
		$post = get_post( $pid );
		if ( ! $post instanceof WP_Post ) {
			continue;
		}
		$other = 0;
		foreach ( $participants_int as $p ) {
			if ( $p !== $user_id ) {
				$other = $p;
				break;
			}
		}
		$out[] = array(
			'id'             => $pid,
			'slug'           => (string) $post->post_name,
			'participants'   => $participants_int,
			'otherUserId'    => $other,
			'lastMessage'    => array(
				'preview'   => (string) get_post_meta( $pid, '_wpdm_conv_last_message_preview', true ),
				'authorId'  => (int) get_post_meta( $pid, '_wpdm_conv_last_message_user_id', true ),
				'createdAtMs' => (int) get_post_meta( $pid, '_wpdm_conv_last_message_ts_ms', true ),
			),
			'unreadCount'    => wpdm_messages_unread_count_for_conversation( $pid, $user_id ),
			'updatedAtMs'    => (int) get_post_meta( $pid, '_wpdm_conv_last_message_ts_ms', true ),
		);
	}

	return array(
		'conversations' => $out,
		'total'         => (int) $query->found_posts,
	);
}

/**
 * Mark messages in a conversation as read up to a given comment ID.
 *
 * @since 0.22.0
 *
 * @param int $conversation_id
 * @param int $reader_id
 * @param int $last_read_id Highest comment_ID the reader has acknowledged.
 * @return bool
 */
function wpdm_messages_mark_read( $conversation_id, $reader_id, $last_read_id ) {
	$conversation_id = (int) $conversation_id;
	$reader_id       = (int) $reader_id;
	$last_read_id    = max( 0, (int) $last_read_id );
	if ( $conversation_id <= 0 || $reader_id <= 0 ) {
		return false;
	}
	$state = get_post_meta( $conversation_id, '_wpdm_conv_read_state', true );
	if ( ! is_array( $state ) ) {
		$state = array();
	}
	$prev = isset( $state[ $reader_id ] ) ? (int) $state[ $reader_id ] : 0;
	if ( $last_read_id <= $prev ) {
		return true;
	}
	$state[ $reader_id ] = $last_read_id;
	update_post_meta( $conversation_id, '_wpdm_conv_read_state', $state );

	/**
	 * Fires when a reader marks messages up to `$last_read_id` as read.
	 *
	 * @since 0.22.0
	 *
	 * @param int $message_id      Highest read comment_ID.
	 * @param int $conversation_id Owning conversation post ID.
	 * @param int $reader_id       User who marked them read.
	 */
	do_action( 'wp_desktop_messages_message_marked_read', $last_read_id, $conversation_id, $reader_id );
	return true;
}

/**
 * Compute the number of unread messages a user has in a single
 * conversation. Cheap — one COUNT(*) bound by `comment_ID >
 * $last_read_id`.
 *
 * @since 0.22.0
 *
 * @param int $conversation_id
 * @param int $user_id
 * @return int
 */
function wpdm_messages_unread_count_for_conversation( $conversation_id, $user_id ) {
	$conversation_id = (int) $conversation_id;
	$user_id         = (int) $user_id;
	if ( $conversation_id <= 0 || $user_id <= 0 ) {
		return 0;
	}
	$state    = (array) get_post_meta( $conversation_id, '_wpdm_conv_read_state', true );
	$last_read = isset( $state[ $user_id ] ) ? (int) $state[ $user_id ] : 0;

	wpdm_messages_internal_query( true );
	$rows = get_comments(
		array(
			'count'        => true,
			'post_id'      => $conversation_id,
			'type'         => 'wpdm_message',
			'status'       => 'approve',
			'comment__not_in' => array(),
		)
	);
	wpdm_messages_internal_query( false );
	if ( ! is_numeric( $rows ) ) {
		return 0;
	}
	if ( 0 === $last_read ) {
		// Subtract messages authored by THIS user — they're always
		// "read" from their own perspective.
		wpdm_messages_internal_query( true );
		$own = (int) get_comments(
			array(
				'count'   => true,
				'post_id' => $conversation_id,
				'type'    => 'wpdm_message',
				'status'  => 'approve',
				'user_id' => $user_id,
			)
		);
		wpdm_messages_internal_query( false );
		return max( 0, (int) $rows - $own );
	}

	wpdm_messages_internal_query( true );
	$above = (int) get_comments(
		array(
			'count'   => true,
			'post_id' => $conversation_id,
			'type'    => 'wpdm_message',
			'status'  => 'approve',
			// Use a custom WHERE via the `comments_clauses` filter for
			// the "comment_ID >" predicate — but since this is the only
			// place we need it, use a raw query to keep the helper
			// surface small.
		)
	);
	wpdm_messages_internal_query( false );
	// Refine: subtract messages with comment_ID <= last_read AND messages authored by the user.
	global $wpdb;
	wpdm_messages_internal_query( true );
	$prepared = $wpdb->prepare(
		"SELECT COUNT(*) FROM {$wpdb->comments} WHERE comment_post_ID = %d AND comment_type = 'wpdm_message' AND comment_approved = 1 AND comment_ID > %d AND user_id != %d",
		$conversation_id,
		$last_read,
		$user_id
	);
	$count = (int) $wpdb->get_var( $prepared ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	wpdm_messages_internal_query( false );
	return $count;
}

/**
 * Total unread across every conversation a user participates in.
 * Used by Heartbeat to badge the chat dock icon.
 *
 * @since 0.22.0
 *
 * @param int $user_id
 * @return int
 */
function wpdm_messages_total_unread_for_user( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return 0;
	}
	$convos = wpdm_messages_query_conversations_for_user( $user_id, array( 'per_page' => 100 ) );
	$total  = 0;
	foreach ( $convos['conversations'] as $c ) {
		$total += (int) $c['unreadCount'];
	}
	return $total;
}

/**
 * Per-conversation unread counts for a user. Used by the Heartbeat
 * payload so the chat-window UI can update its badges without hitting
 * a separate REST endpoint per tick.
 *
 * @since 0.22.0
 *
 * @param int $user_id
 * @return array<int,int> Conversation ID → unread count.
 */
function wpdm_messages_unread_counts_for_user( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return array();
	}
	$convos = wpdm_messages_query_conversations_for_user( $user_id, array( 'per_page' => 100 ) );
	$out    = array();
	foreach ( $convos['conversations'] as $c ) {
		$out[ (string) (int) $c['id'] ] = (int) $c['unreadCount'];
	}
	return $out;
}

/**
 * Query rows for a user since a given comment ID watermark. Used by
 * the SSE worker on every tick + by `/messages/since` for catch-up
 * after reconnect.
 *
 * **LIMIT semantics.** Caps at 200 rows per call. With ASC ordering
 * that means the OLDEST 200 unseen messages are returned per tick;
 * a user with thousands of unseen messages catches up over multiple
 * ticks. The cursor returned alongside (see
 * {@see wpdm_messages_max_message_id_for_user}) is the absolute max
 * id, so callers that only care about the high-water mark
 * (bootstrap, the always-on shell) can advance their cursor past
 * the LIMIT cutoff in one round-trip even when the row payload
 * stops short.
 *
 * @since 0.22.0
 *
 * @param int $user_id
 * @param int $since_id
 * @return array Message rows.
 */
function wpdm_messages_query_messages_since_for_user( $user_id, $since_id ) {
	$user_id  = (int) $user_id;
	$since_id = max( 0, (int) $since_id );
	if ( $user_id <= 0 ) {
		return array();
	}
	global $wpdb;
	wpdm_messages_internal_query( true );
	// Find conversation IDs the user participates in.
	$convos = wpdm_messages_query_conversations_for_user( $user_id, array( 'per_page' => 100 ) );
	$ids    = array_map(
		function ( $c ) {
			return (int) $c['id'];
		},
		$convos['conversations']
	);
	if ( empty( $ids ) ) {
		wpdm_messages_internal_query( false );
		return array();
	}
	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$prepared     = $wpdb->prepare(
		"SELECT * FROM {$wpdb->comments} WHERE comment_post_ID IN ( $placeholders ) AND comment_type = 'wpdm_message' AND comment_approved = 1 AND comment_ID > %d ORDER BY comment_ID ASC LIMIT 200",
		array_merge( $ids, array( $since_id ) )
	);
	$rows = $wpdb->get_results( $prepared ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	wpdm_messages_internal_query( false );
	$out = array();
	foreach ( (array) $rows as $r ) {
		$out[] = wpdm_messages_format_message_row( $r );
	}
	return $out;
}

/**
 * Absolute max `comment_ID` across every conversation the user
 * participates in, restricted to messages newer than `$since_id`.
 *
 * **Why a separate query.** {@see wpdm_messages_query_messages_since_for_user}
 * returns AT MOST 200 rows per call. For a user with more than 200
 * unseen messages on first load, the highest id in the returned
 * payload is the 200th OLDEST unseen, NOT the absolute newest.
 * The shell's bootstrap step uses the cursor to advance its
 * "I've seen everything up to here" watermark; if the cursor
 * tracked the truncated payload max instead of the absolute max,
 * the next poll tick would deliver every message past the LIMIT
 * cutoff as if it were brand new — surfaced to the user as a
 * toast storm on every page reload. The fix is this dedicated
 * `MAX()` query, computed cheaply enough (one indexed lookup)
 * that we run it on every `/messages/since` call.
 *
 * @since 0.5.5
 *
 * @param int $user_id
 * @param int $since_id Lower bound (inclusive: only IDs > this).
 * @return int Max id, or `$since_id` when the user has no newer messages.
 */
function wpdm_messages_max_message_id_for_user( $user_id, $since_id ) {
	$user_id  = (int) $user_id;
	$since_id = max( 0, (int) $since_id );
	if ( $user_id <= 0 ) {
		return $since_id;
	}
	global $wpdb;
	wpdm_messages_internal_query( true );
	$convos = wpdm_messages_query_conversations_for_user(
		$user_id,
		array( 'per_page' => 100 )
	);
	$ids = array_map(
		function ( $c ) {
			return (int) $c['id'];
		},
		$convos['conversations']
	);
	if ( empty( $ids ) ) {
		wpdm_messages_internal_query( false );
		return $since_id;
	}
	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$prepared     = $wpdb->prepare(
		"SELECT MAX(comment_ID) FROM {$wpdb->comments} WHERE comment_post_ID IN ( $placeholders ) AND comment_type = 'wpdm_message' AND comment_approved = 1 AND comment_ID > %d",
		array_merge( $ids, array( $since_id ) )
	);
	$max = (int) $wpdb->get_var( $prepared ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	wpdm_messages_internal_query( false );
	return $max > 0 ? $max : $since_id;
}
