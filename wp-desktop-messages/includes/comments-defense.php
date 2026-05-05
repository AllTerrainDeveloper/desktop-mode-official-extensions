<?php
/**
 * Desktop Mode — Messages: comments-table defensive filters.
 *
 * Messages are stored as WP comments with `comment_type =
 * 'wpdm_message'` and `comment_approved = 1`. Four filters keep
 * those rows invisible to every default WP surface:
 *
 *   1. `comments_clauses` — append `AND comment_type !=
 *      'wpdm_message'` unless the query explicitly asks for it.
 *      Bypassed via the internal-query flag our store helpers flip.
 *   2. `wp_count_comments` — subtract our type from total / approved
 *      / all counts (per-post + global).
 *   3. `rest_pre_dispatch` on `/wp/v2/comments` — block the public
 *      controller from returning our type. Direct `type=wpdm_message`
 *      requests on the public route → 403.
 *   4. `comment_feed_join` / `comment_feed_where` — exclude our type
 *      from comment feeds; exclude `wpdm_conversation` from post
 *      feeds.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Toggle / read the per-request "we're running an internal messages
 * query" flag. Store helpers flip this to bypass the defensive
 * comments_clauses filter while running their own queries.
 *
 * @since 0.22.0
 *
 * @param bool|null $set Pass `true` / `false` to set, `null` to read.
 * @return bool Current value.
 */
function wpdm_messages_internal_query( $set = null ) {
	static $active = false;
	if ( null !== $set ) {
		$active = (bool) $set;
	}
	return $active;
}

/**
 * Filter 1: `comments_clauses` — append a WHERE that excludes
 * `wpdm_message` rows when the caller didn't ask for them.
 *
 * @since 0.22.0
 *
 * @param array          $clauses Compiled SQL clauses.
 * @param WP_Comment_Query $query Active query (read-only).
 * @return array
 */
function wpdm_messages_filter_comments_clauses( $clauses, $query ) {
	if ( wpdm_messages_internal_query() ) {
		return $clauses;
	}

	$qv = is_object( $query ) && isset( $query->query_vars ) ? $query->query_vars : array();
	$type    = isset( $qv['type'] ) ? (string) $qv['type'] : '';
	$type_in = isset( $qv['type__in'] ) ? (array) $qv['type__in'] : array();

	if ( 'wpdm_message' === $type || in_array( 'wpdm_message', $type_in, true ) ) {
		return $clauses;
	}

	global $wpdb;
	$where = isset( $clauses['where'] ) ? (string) $clauses['where'] : '';
	if ( '' !== $where ) {
		$where .= ' ';
	}
	$where           .= "AND {$wpdb->comments}.comment_type != 'wpdm_message'";
	$clauses['where'] = $where;
	return $clauses;
}
add_filter( 'comments_clauses', 'wpdm_messages_filter_comments_clauses', 10, 2 );

/**
 * Filter 2: `wp_count_comments` — subtract `wpdm_message` rows from
 * the per-post and global comment counts so the moderation UI and
 * the dashboard widget don't report inflated numbers.
 *
 * Runs an internal `WP_Comment_Query` for our type with the flag
 * set, then subtracts. Keeps the math symmetric across both shapes
 * core returns (object + assoc-array compatible).
 *
 * @since 0.22.0
 *
 * @param object|array $stats   Pre-filtered stats.
 * @param int          $post_id Post ID, or 0 for site-wide.
 * @return object|array
 */
function wpdm_messages_filter_count_comments( $stats, $post_id ) {
	$post_id = (int) $post_id;
	$is_obj  = is_object( $stats );
	if ( ! $is_obj && ! is_array( $stats ) ) {
		return $stats;
	}

	$args = array(
		'count'   => true,
		'type'    => 'wpdm_message',
		'status'  => 'approve',
	);
	if ( $post_id > 0 ) {
		$args['post_id'] = $post_id;
	}

	wpdm_messages_internal_query( true );
	$ours = (int) get_comments( $args );
	wpdm_messages_internal_query( false );

	if ( $ours <= 0 ) {
		return $stats;
	}

	$adjust = function ( &$container, $key, $by ) {
		if ( is_object( $container ) ) {
			if ( isset( $container->$key ) ) {
				$container->$key = max( 0, (int) $container->$key - $by );
			}
		} elseif ( isset( $container[ $key ] ) ) {
			$container[ $key ] = max( 0, (int) $container[ $key ] - $by );
		}
	};

	$adjust( $stats, 'total_comments', $ours );
	$adjust( $stats, 'approved', $ours );
	$adjust( $stats, 'all', $ours );

	return $stats;
}
add_filter( 'wp_count_comments', 'wpdm_messages_filter_count_comments', 10, 2 );

/**
 * Filter 3: `rest_pre_dispatch` — block the public
 * `/wp/v2/comments` controller from returning our type.
 *
 * Strategy: detect requests against `/wp/v2/comments[/{id}]`, look
 * at the `type` arg. If the caller explicitly asked for our type,
 * return 403. Otherwise force `type__not_in[] = 'wpdm_message'` so
 * the default listing strips our rows even if a plugin extended
 * the query.
 *
 * @since 0.22.0
 *
 * @param mixed           $result  Pre-dispatch short-circuit value.
 * @param WP_REST_Server  $_server Server instance (unused).
 * @param WP_REST_Request $request Active request.
 * @return mixed
 */
function wpdm_messages_filter_rest_comments_route( $result, $_server, $request ) {
	if ( null !== $result ) {
		return $result;
	}
	$route = (string) $request->get_route();
	if ( 0 !== strpos( $route, '/wp/v2/comments' ) ) {
		return $result;
	}

	$type = (string) $request->get_param( 'type' );
	if ( 'wpdm_message' === $type ) {
		return new WP_Error(
			'wpdm_messages_forbidden_type',
			__( 'wpdm_message comments are not exposed via the public comments REST controller. Use /wp-desktop/v1/messages.', 'wp-desktop-messages' ),
			array( 'status' => 403 )
		);
	}

	$type_in = (array) $request->get_param( 'type__in' );
	if ( in_array( 'wpdm_message', $type_in, true ) ) {
		return new WP_Error(
			'wpdm_messages_forbidden_type',
			__( 'wpdm_message comments are not exposed via the public comments REST controller. Use /wp-desktop/v1/messages.', 'wp-desktop-messages' ),
			array( 'status' => 403 )
		);
	}

	$existing_not_in = (array) $request->get_param( 'type__not_in' );
	if ( ! in_array( 'wpdm_message', $existing_not_in, true ) ) {
		$existing_not_in[] = 'wpdm_message';
		$request->set_param( 'type__not_in', $existing_not_in );
	}
	return $result;
}
add_filter( 'rest_pre_dispatch', 'wpdm_messages_filter_rest_comments_route', 10, 3 );

/**
 * Filter 4a: `comment_feed_join` / `comment_feed_where` — exclude
 * our type from the comments feed. We rewrite the WHERE to add the
 * exclusion since core doesn't expose a dedicated filter for this.
 *
 * @since 0.22.0
 *
 * @param string $where Compiled WHERE clause.
 * @return string
 */
function wpdm_messages_filter_comment_feed_where( $where ) {
	if ( wpdm_messages_internal_query() ) {
		return $where;
	}
	global $wpdb;
	if ( '' !== $where ) {
		$where .= ' ';
	}
	$where .= "AND {$wpdb->comments}.comment_type != 'wpdm_message'";
	return $where;
}
add_filter( 'comment_feed_where', 'wpdm_messages_filter_comment_feed_where' );

/**
 * Filter 4b: also exclude `wpdm_conversation` posts from the
 * /feed comments-on-this-post listing — the ID can never appear in
 * a feed since the post type is private, but we double-defend in
 * case a plugin opts the type into REST or feeds without realising
 * the implications.
 *
 * @since 0.22.0
 *
 * @param string $where WHERE clause.
 * @return string
 */
function wpdm_messages_exclude_from_post_feed_where( $where ) {
	if ( wpdm_messages_internal_query() ) {
		return $where;
	}
	global $wpdb;
	if ( '' !== $where ) {
		$where .= ' ';
	}
	$where .= "AND ( {$wpdb->posts}.post_type IS NULL OR {$wpdb->posts}.post_type != 'wpdm_conversation' )";
	return $where;
}
add_filter( 'posts_where', 'wpdm_messages_exclude_from_post_feed_where_main_query', 10, 2 );

/**
 * Adapter — only run the post-type exclusion on feed queries.
 * `posts_where` runs for every WP_Query; we don't want to alter
 * non-feed admin / REST queries.
 *
 * @since 0.22.0
 *
 * @param string   $where WHERE clause.
 * @param WP_Query $query Active query.
 * @return string
 */
function wpdm_messages_exclude_from_post_feed_where_main_query( $where, $query ) {
	if ( ! is_object( $query ) || ! method_exists( $query, 'is_feed' ) ) {
		return $where;
	}
	if ( ! $query->is_feed() ) {
		return $where;
	}
	return wpdm_messages_exclude_from_post_feed_where( $where );
}
