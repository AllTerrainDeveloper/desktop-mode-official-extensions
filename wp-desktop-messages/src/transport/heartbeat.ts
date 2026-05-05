/**
 * Messages Heartbeat client. Routes through the framework's
 * shared Heartbeat bus (`wp.desktop.heartbeat`) so the jQuery
 * boilerplate is wired ONCE (in `src/heartbeat.ts`). This module
 * just contributes the per-feature fields and subscribes to the
 * messages-specific block on the response.
 *
 * @since 0.22.0
 */

import { heartbeat } from '../wp';
import type {
	MessageRow,
	PresenceStatus,
	UserSettings,
} from '../types';

interface HeartbeatBlock {
	unreadByConversation?: Record< string, number >;
	totalUnread?: number;
	newSinceLastSeen?: MessageRow[];
	presence?: Record< string, { status: PresenceStatus; lastSeenMs: number } >;
	serverTimeMs?: number;
}

export interface HeartbeatHandlers {
	getActiveFlag: () => boolean;
	getUserActiveFlag: () => boolean;
	getLastSeenId: () => number;
	onMessages?: ( rows: MessageRow[] ) => void;
	onPresence?: (
		batch: Array< { userId: number; status: PresenceStatus } >,
	) => void;
	onUnread?: (
		total: number,
		byConversation: Record< string, number >,
	) => void;
}

const HEARTBEAT_FIELD_ACTIVE = 'wpdm_messages_active';
const HEARTBEAT_FIELD_USER_ACTIVE = 'wpdm_messages_user_active';
const HEARTBEAT_FIELD_SEEN_ID = 'wpdm_messages_seen_id';

export function startHeartbeatProbe( handlers: HeartbeatHandlers ): void {
	// Only contribute when the messages feature wants to be served.
	// The legacy `getActiveFlag` always returns `true` once the
	// shell boots, but plugins overriding behaviour may flip it.
	heartbeat.contribute( HEARTBEAT_FIELD_ACTIVE, () =>
		handlers.getActiveFlag() ? true : undefined,
	);
	heartbeat.contribute( HEARTBEAT_FIELD_USER_ACTIVE, () =>
		handlers.getActiveFlag() ? handlers.getUserActiveFlag() : undefined,
	);
	heartbeat.contribute( HEARTBEAT_FIELD_SEEN_ID, () =>
		handlers.getActiveFlag() ? handlers.getLastSeenId() : undefined,
	);

	heartbeat.subscribe< HeartbeatBlock >( 'wpdm_messages', ( block ) => {
		if ( ! block ) {
			return;
		}
		if (
			typeof block.totalUnread === 'number' &&
			block.unreadByConversation &&
			typeof block.unreadByConversation === 'object'
		) {
			handlers.onUnread?.(
				block.totalUnread,
				block.unreadByConversation as Record< string, number >,
			);
		}
		if (
			Array.isArray( block.newSinceLastSeen ) &&
			block.newSinceLastSeen.length > 0
		) {
			handlers.onMessages?.( block.newSinceLastSeen );
		}
		if ( block.presence && typeof block.presence === 'object' ) {
			const batch: Array< { userId: number; status: PresenceStatus } > = [];
			for ( const [ k, v ] of Object.entries( block.presence ) ) {
				if ( v && typeof v === 'object' && 'status' in v ) {
					batch.push( { userId: Number( k ), status: v.status } );
				}
			}
			handlers.onPresence?.( batch );
		}
	} );
}

/**
 * Compute "user active" flag from the last user-input timestamp.
 *
 * @param lastInputMs Latest pointerdown / keydown timestamp.
 * @param settings    Per-user settings (provides inactiveAfterSeconds).
 * @return True if the user has interacted within the inactive threshold.
 */
export function computeUserActive(
	lastInputMs: number,
	settings: UserSettings,
): boolean {
	const threshold = settings.inactiveAfterSeconds * 1000;
	return Date.now() - lastInputMs < threshold;
}
