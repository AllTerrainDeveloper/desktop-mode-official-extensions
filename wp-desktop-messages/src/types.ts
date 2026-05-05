/**
 * Internal types for the messages module. Public types live on
 * `wp.desktop.messages.*`; this file is the implementation-side
 * contract between window.ts, shell.ts, transport/, views/, etc.
 *
 * @since 0.22.0
 */

export type PresenceStatus = 'online' | 'inactive' | 'offline';

export interface MessageRow {
	id: number;
	conversationId: number;
	authorId: number;
	kind: 'text' | 'nudge' | 'system';
	content: string;
	payload: Record< string, unknown > | null;
	createdAtMs: number;
}

export interface UserSummary {
	id: number;
	displayName: string;
	avatarUrl: string;
	role: string;
	presence: PresenceStatus;
	lastSeenMs: number;
}

export interface ConversationSummary {
	id: number;
	slug: string;
	participants: number[];
	otherUserId: number;
	otherUser: UserSummary | null;
	lastMessage: {
		preview: string;
		authorId: number;
		createdAtMs: number;
	};
	unreadCount: number;
	updatedAtMs: number;
}

export interface SoundDef {
	id: string;
	label: string;
	url: string;
	volume: number;
}

export interface UserSettings {
	nudgeSoundId: string;
	volume: number;
	showToast: boolean;
	soundWhileFocused: boolean;
	inactiveAfterSeconds: number;
	acceptFrom: 'everyone' | 'admins-only';
}

/**
 * Site-level messages settings — owned by the messages module
 * (admin-only). `null` for non-admin users; the settings tab hides
 * the admin block in that case.
 *
 * @since 0.23.0
 */
export interface MessagesSiteSettings {
	realtime_sse_enabled: boolean;
}

/**
 * Localized PHP → JS config blob (`wpDesktopMessagesConfig` global).
 */
export interface MessagesConfig {
	currentUserId: number;
	restNonce: string;
	restRoot: string;
	/** REST endpoint for site-level messages settings (admin only). */
	siteSettingsUrl: string;
	streamUrl: string;
	allowedRoles: string[];
	sounds: SoundDef[];
	defaultSoundId: string;
	userSettings: UserSettings;
	/**
	 * Admin-only: full site-settings blob. `null` for non-admin
	 * users so the messages settings tab can hide the admin block
	 * without a follow-up REST call.
	 *
	 * @since 0.23.0
	 */
	siteSettings: MessagesSiteSettings | null;
	/**
	 * `true` when the admin has opted into the SSE real-time path.
	 * False = polling-only (default; cheap-host friendly).
	 */
	realtimeSseEnabled: boolean;
	/** Poll cadence (ms) when the chat window is mounted AND focused. */
	pollIntervalActiveMs: number;
	/** Poll cadence (ms) when the chat window is closed / minimized but the tab is visible. */
	pollIntervalIdleMs: number;
	/** Poll cadence (ms) when the browser tab is hidden. */
	pollIntervalHiddenMs: number;
	sseReconnectMs: number;
	inactiveAfterSeconds: number;
}

/* ------------------------------------------------------------------------- *
 * SSE event payloads
 * ------------------------------------------------------------------------- */

export type SseEventName =
	| 'open'
	| 'message'
	| 'nudge'
	| 'typing'
	| 'presence'
	| 'close';

export interface SseTypingEntry {
	conversationId: number;
	userId: number;
	untilMs: number;
}

export type SseTypingPayload = Record< string, SseTypingEntry[] >;

export type SsePresencePayload = Record<
	string,
	{ status: PresenceStatus; lastSeenMs: number }
>;

/* ------------------------------------------------------------------------- *
 * Public API surface — exposed on `wp.desktop.messages`
 * ------------------------------------------------------------------------- */

export interface MessagesApi {
	openWindow( opts?: { conversationId?: number; userId?: number } ): void;
	closeWindow(): void;
	startConversationWith( userId: number ): Promise< ConversationSummary >;
	send(
		conversationId: number,
		content: string,
		opts?: { kind?: 'text'; clientId?: string },
	): Promise< MessageRow >;
	markRead( conversationId: number, lastReadId?: number ): Promise< void >;
	nudge( conversationId: number, soundId?: string ): Promise< void >;
	listConversations(): Promise< ConversationSummary[] >;
	fetchMessages(
		conversationId: number,
		opts?: { before?: number; limit?: number },
	): Promise< MessageRow[] >;
	getPresence( userId: number ): PresenceStatus;
	getUnreadCount( conversationId?: number ): number;
	subscribe(
		event: string,
		cb: ( detail: unknown ) => void,
	): () => void;
}

declare global {
	interface Window {
		wpDesktopMessagesConfig?: MessagesConfig;
	}
}

export {};
