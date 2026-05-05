<?php
/**
 * Desktop Mode — Messages: cron (legacy stub).
 *
 * Pre-0.5.5 this file scheduled a daily prune of stale presence
 * entries from `_wpdm_messages_presence`. Storage moved to
 * `_wp_desktop_presence` at framework level when presence was
 * promoted, and the framework's `wp_desktop_presence_daily_prune`
 * cron handles the same job. The hook + handler below remain so
 * a `wp_unschedule_event()` from a deactivation routine doesn't
 * fatally error and so any plugin that scheduled additional work
 * against `wp_desktop_messages_daily_prune` keeps firing.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

const WPDM_MESSAGES_CRON_HOOK = 'wp_desktop_messages_daily_prune';

/**
 * Schedule the daily cron on activation. Idempotent.
 *
 * @since 0.22.0
 */
function wpdm_messages_schedule_cron() {
	if ( ! wp_next_scheduled( WPDM_MESSAGES_CRON_HOOK ) ) {
		wp_schedule_event( time() + DAY_IN_SECONDS, 'daily', WPDM_MESSAGES_CRON_HOOK );
	}
}
add_action( 'init', 'wpdm_messages_schedule_cron', 50 );

/**
 * Cron handler — delegates to the framework prune.
 *
 * @since 0.22.0
 */
function wpdm_messages_cron_run() {
	if ( function_exists( 'desktop_mode_presence_cron_prune' ) ) {
		desktop_mode_presence_cron_prune();
	}
}
add_action( WPDM_MESSAGES_CRON_HOOK, 'wpdm_messages_cron_run' );
