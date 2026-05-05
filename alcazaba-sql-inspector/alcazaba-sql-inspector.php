<?php
/**
 * Plugin Name:       Alcazaba SQL Inspector
 * Description:       Adds a bug-icon dropdown to every desktop window's title bar. Selecting "Attach SQL Inspector" opens a native window streaming every SQL query the target window's iframe triggers, with Query-Monitor-level detail (component attribution, rows affected, caller backtrace, expandable details panel). Backed by the wp-desktop-mode 0.20+ devtools instrumentation surface.
 * Version:           0.2.2
 * Requires at least: 6.5
 * Requires PHP:      7.4
 * Requires Plugins:  desktop-mode
 * Author:            Alcazaba
 * License:           GPL-2.0-or-later
 *
 * @package AlcazabaSqlInspector
 */

defined( 'ABSPATH' ) || exit;

const ALCAZABA_SQL_INSPECTOR_VERSION = '0.2.2';

/**
 * Register the title-bar button script and tell wp-desktop-mode
 * it's a title-bar-button-script provider.
 */
add_action(
	'init',
	function () {
		wp_register_script(
			'alcazaba-sql-inspector',
			plugins_url( 'assets/devtools.js', __FILE__ ),
			array( 'wp-api-fetch' ),
			ALCAZABA_SQL_INSPECTOR_VERSION,
			true
		);

		if ( function_exists( 'desktop_mode_register_titlebar_button_script' ) ) {
			desktop_mode_register_titlebar_button_script( 'alcazaba-sql-inspector' );
		}
	}
);

/**
 * Declare the `query` channel on the framework's debug-channels
 * filter so the REST drain knows where to look.
 */
add_filter(
	'desktop_mode_debug_channels',
	function ( $channels ) {
		if ( ! is_array( $channels ) ) {
			$channels = array();
		}
		if ( ! in_array( 'query', $channels, true ) ) {
			$channels[] = 'query';
		}
		return $channels;
	}
);

/**
 * Resolve the active debug-session id for this request, with a
 * query-arg fallback for iframe document loads.
 *
 * @return string Sanitised session id, or '' when absent.
 */
function alcazaba_sql_inspector_session_for_request() {
	if ( function_exists( 'desktop_mode_debug_session_for_request' ) ) {
		$from_header = desktop_mode_debug_session_for_request();
		if ( '' !== $from_header ) {
			return $from_header;
		}
	}
	// `wp_debug_session` is the canonical query-arg name produced
	// by `wp.desktop.devtools.reloadWithDebugSession` for iframe
	// document loads. The framework's PHP-side resolver only reads
	// the header today, so we keep the query-arg fallback here.
	if ( empty( $_GET['wp_debug_session'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return '';
	}
	$raw       = (string) wp_unslash( $_GET['wp_debug_session'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$sanitised = preg_replace( '/[^A-Za-z0-9\-]/', '', $raw );
	if ( ! is_string( $sanitised ) || '' === $sanitised || strlen( $sanitised ) > 64 ) {
		return '';
	}
	return $sanitised;
}

/**
 * Derive a human-friendly component label for a query's caller
 * backtrace. Walks the trace looking for the first entry under
 * `wp-content/plugins/<slug>/` or `wp-content/themes/<slug>/`;
 * falls back to "core" for queries fired by WordPress itself.
 *
 * @param string $caller Comma-separated callstack from $wpdb->queries[$i][2].
 * @return string Label like "plugin: jetpack" / "theme: twentytwentyfive" / "core".
 */
function alcazaba_sql_inspector_component_from_caller( $caller ) {
	if ( '' === $caller ) {
		return 'core';
	}
	if ( preg_match( '#wp-content/plugins/([^/]+)/#', $caller, $m ) ) {
		return 'plugin: ' . $m[1];
	}
	if ( preg_match( '#wp-content/themes/([^/]+)/#', $caller, $m ) ) {
		return 'theme: ' . $m[1];
	}
	if ( preg_match( '#wp-content/mu-plugins/([^/]+)/#', $caller, $m ) ) {
		return 'mu-plugin: ' . $m[1];
	}
	return 'core';
}

/**
 * Extract the leading SQL verb (SELECT / UPDATE / INSERT / …) for
 * coarse aggregation and badge coloring on the client. Anything
 * that doesn't match a known verb collapses to "OTHER".
 *
 * @param string $sql
 * @return string
 */
function alcazaba_sql_inspector_query_type( $sql ) {
	if ( ! preg_match( '/^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|SHOW|DESCRIBE|EXPLAIN|CREATE|ALTER|DROP|SET|START|COMMIT|ROLLBACK|BEGIN|TRUNCATE)\b/i', $sql, $m ) ) {
		return 'OTHER';
	}
	return strtoupper( $m[1] );
}

/**
 * On every WP request that carries an active debug session AND is
 * authored by an admin, define `SAVEQUERIES`, attach the
 * `log_query_custom_data` filter to capture rows-affected /
 * num-rows per query, and register a `shutdown` callback that
 * publishes every captured query with full detail to the
 * session's `query` channel.
 */
add_action(
	'init',
	function () {
		$session_id = alcazaba_sql_inspector_session_for_request();
		if ( '' === $session_id ) {
			return;
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		if ( ! defined( 'SAVEQUERIES' ) ) {
			define( 'SAVEQUERIES', true );
		}

		// Capture per-query row counts. WP fires this filter from
		// inside `$wpdb::log_query()` immediately AFTER the query
		// executes, so `$wpdb->num_rows` and `$wpdb->rows_affected`
		// reflect THIS query — they'd be overwritten by the next
		// one before our `shutdown` callback runs. Stash them as
		// custom data on the query entry so we can read them
		// later.
		add_filter(
			'log_query_custom_data',
			function ( $custom, $query, $query_time, $query_callstack, $query_start ) {
				global $wpdb;
				if ( ! is_array( $custom ) ) {
					$custom = array();
				}
				$custom['alcazaba_num_rows']      = isset( $wpdb->num_rows ) ? (int) $wpdb->num_rows : 0;
				$custom['alcazaba_rows_affected'] = isset( $wpdb->rows_affected ) ? (int) $wpdb->rows_affected : 0;
				$custom['alcazaba_insert_id']     = isset( $wpdb->insert_id ) ? (int) $wpdb->insert_id : 0;
				return $custom;
			},
			10,
			5
		);

		add_action(
			'shutdown',
			function () use ( $session_id ) {
				global $wpdb;
				if ( empty( $wpdb->queries ) || ! function_exists( 'desktop_mode_debug_publish' ) ) {
					return;
				}
				$req_method = isset( $_SERVER['REQUEST_METHOD'] ) ? sanitize_key( $_SERVER['REQUEST_METHOD'] ) : '';
				$req_uri    = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
				foreach ( $wpdb->queries as $q ) {
					$sql      = isset( $q[0] ) ? (string) $q[0] : '';
					$caller   = isset( $q[2] ) ? (string) $q[2] : '';
					$custom   = isset( $q[4] ) && is_array( $q[4] ) ? $q[4] : array();
					$type     = alcazaba_sql_inspector_query_type( $sql );
					// Rows: SELECT-shaped queries report num_rows;
					// write-shaped report rows_affected. Some WP
					// utility paths (`SHOW`, `DESCRIBE`) report 0
					// and that's fine.
					$is_read  = in_array( $type, array( 'SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN' ), true );
					$rows     = $is_read
						? (int) ( $custom['alcazaba_num_rows'] ?? 0 )
						: (int) ( $custom['alcazaba_rows_affected'] ?? 0 );

					desktop_mode_debug_publish(
						$session_id,
						'query',
						array(
							'sql'         => $sql,
							'time'        => isset( $q[1] ) ? (float) $q[1] : 0.0,
							'caller'      => $caller,
							'method'      => $req_method,
							'uri'         => $req_uri,
							'type'        => $type,
							'component'   => alcazaba_sql_inspector_component_from_caller( $caller ),
							'rows'        => $rows,
							'insert_id'   => (int) ( $custom['alcazaba_insert_id'] ?? 0 ),
							'is_read'     => $is_read,
						)
					);
				}
			}
		);
	},
	1
);
