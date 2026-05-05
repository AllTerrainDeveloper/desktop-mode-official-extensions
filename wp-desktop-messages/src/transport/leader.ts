/**
 * Multi-tab leader election over `BroadcastChannel`.
 *
 * Exactly one tab per browser session holds the SSE connection;
 * other tabs receive events via the channel. Without this, every
 * open tab would hold its own SSE worker, multiplying PHP-FPM load
 * by N. The leader can change at any time (tab close, reload, OS
 * tab discard) so the protocol must be robust to disappearance.
 *
 * Protocol:
 *
 *   - `who-leader`  — followers ask "who's leader right now?".
 *                     The current leader replies with a heartbeat.
 *   - `claim`       — a tab asserts itself as leader. Higher
 *                     epoch wins; tiebreak on lex tabId.
 *   - `heartbeat`   — current leader pings every HEARTBEAT_MS.
 *   - `event`       — leader rebroadcasts SSE events to followers.
 *   - `resign`      — leader voluntarily steps down (e.g.,
 *                     `beforeunload`); triggers fresh election.
 *
 * Election timing: a fresh tab broadcasts `who-leader`, waits
 * ELECTION_TIMEOUT_MS for a heartbeat. If none arrives, it claims.
 * Two tabs claiming simultaneously break ties via random jitter
 * (10–150 ms) on the claim broadcast PLUS the epoch / lex tabId
 * comparison.
 *
 * @since 0.22.0
 */

const CHANNEL_NAME = 'wpdm-messages-coord';
const HEARTBEAT_MS = 1500;
const ELECTION_TIMEOUT_MS = 800;
const STALE_LEADER_MS = 3000;

interface CoordMessage {
	type: 'claim' | 'heartbeat' | 'event' | 'resign' | 'who-leader';
	tabId: string;
	epoch: number;
	timestamp: number;
	payload?: unknown;
}

export interface LeaderHandlers {
	onBecameLeader?: () => void;
	onLostLeadership?: () => void;
	/** Fired on every event the LEADER receives — locally + rebroadcast over the channel. */
	onEvent?: ( payload: unknown ) => void;
}

export class MessagesLeader {
	private chan: BroadcastChannel | null = null;
	private readonly tabId: string;
	private epoch = 0;
	private isLeader = false;
	private currentLeaderId: string | null = null;
	private currentLeaderLastSeen = 0;
	private heartbeatTimer: number | null = null;
	private staleCheckTimer: number | null = null;
	private claimTimer: number | null = null;
	private readonly handlers: LeaderHandlers;
	private started = false;

	constructor( handlers: LeaderHandlers = {} ) {
		this.handlers = handlers;
		this.tabId = generateTabId();
	}

	start(): void {
		if ( this.started ) {
			return;
		}
		this.started = true;
		try {
			this.chan = new BroadcastChannel( CHANNEL_NAME );
		} catch ( _err ) {
			// Ancient browser without BroadcastChannel — every tab
			// becomes its own leader. Suboptimal but not broken.
			this.becomeLeader();
			return;
		}
		this.chan.addEventListener( 'message', this.onMessage );
		// Ask first; if no answer in election window, claim.
		this.broadcast( 'who-leader' );
		this.claimTimer = window.setTimeout( () => this.claim(), ELECTION_TIMEOUT_MS );
		this.staleCheckTimer = window.setInterval(
			() => this.detectStaleLeader(),
			HEARTBEAT_MS,
		);
		window.addEventListener( 'beforeunload', this.onBeforeUnload );
	}

	stop(): void {
		this.started = false;
		// Send the resign FIRST while the channel is still open, then
		// tear down. (Closing the channel first silently drops the
		// resign and a follower never hears it.)
		if ( this.isLeader ) {
			this.broadcast( 'resign' );
			this.isLeader = false;
		}
		if ( this.chan ) {
			this.chan.removeEventListener( 'message', this.onMessage );
			this.chan.close();
			this.chan = null;
		}
		if ( this.heartbeatTimer !== null ) {
			window.clearInterval( this.heartbeatTimer );
			this.heartbeatTimer = null;
		}
		if ( this.staleCheckTimer !== null ) {
			window.clearInterval( this.staleCheckTimer );
			this.staleCheckTimer = null;
		}
		if ( this.claimTimer !== null ) {
			window.clearTimeout( this.claimTimer );
			this.claimTimer = null;
		}
		window.removeEventListener( 'beforeunload', this.onBeforeUnload );
	}

	getLeaderState(): { isLeader: boolean; tabId: string } {
		return { isLeader: this.isLeader, tabId: this.tabId };
	}

	/** Leader publishes an event to every other tab. No-op when not leader. */
	publishEvent( payload: unknown ): void {
		if ( ! this.isLeader ) {
			return;
		}
		this.broadcast( 'event', payload );
	}

	private onBeforeUnload = (): void => {
		if ( this.isLeader && this.chan ) {
			this.broadcast( 'resign' );
		}
	};

	private claim(): void {
		// Random jitter to break two-tab simultaneous claims. The first
		// claim to land on the channel wins; the loser sees it and
		// demotes via the lex tabId tiebreak.
		const jitter = 10 + Math.random() * 140;
		this.claimTimer = window.setTimeout( () => {
			if ( this.currentLeaderId && this.currentLeaderId !== this.tabId ) {
				return;
			}
			this.epoch += 1;
			this.broadcast( 'claim' );
			this.becomeLeader();
		}, jitter );
	}

	private becomeLeader(): void {
		if ( this.isLeader ) {
			return;
		}
		this.isLeader = true;
		this.currentLeaderId = this.tabId;
		this.heartbeatTimer = window.setInterval(
			() => this.broadcast( 'heartbeat' ),
			HEARTBEAT_MS,
		);
		this.handlers.onBecameLeader?.();
	}

	private demote(): void {
		if ( ! this.isLeader ) {
			return;
		}
		this.isLeader = false;
		if ( this.heartbeatTimer !== null ) {
			window.clearInterval( this.heartbeatTimer );
			this.heartbeatTimer = null;
		}
		this.handlers.onLostLeadership?.();
	}

	private detectStaleLeader(): void {
		if ( this.isLeader ) {
			return;
		}
		if ( ! this.currentLeaderId ) {
			return;
		}
		if ( Date.now() - this.currentLeaderLastSeen > STALE_LEADER_MS ) {
			this.currentLeaderId = null;
			this.claim();
		}
	}

	private onMessage = ( ev: MessageEvent< CoordMessage > ): void => {
		const msg = ev.data;
		if ( ! msg || msg.tabId === this.tabId ) {
			return;
		}

		if ( msg.type === 'claim' ) {
			const challengerWins =
				msg.epoch > this.epoch ||
				( msg.epoch === this.epoch && msg.tabId > this.tabId );
			if ( challengerWins && this.isLeader ) {
				this.demote();
			}
			if ( challengerWins ) {
				this.currentLeaderId = msg.tabId;
				this.currentLeaderLastSeen = msg.timestamp;
				this.epoch = Math.max( this.epoch, msg.epoch );
				if ( this.claimTimer !== null ) {
					window.clearTimeout( this.claimTimer );
					this.claimTimer = null;
				}
			}
			return;
		}
		if ( msg.type === 'heartbeat' ) {
			this.currentLeaderId = msg.tabId;
			this.currentLeaderLastSeen = msg.timestamp;
			this.epoch = Math.max( this.epoch, msg.epoch );
			if ( this.claimTimer !== null ) {
				window.clearTimeout( this.claimTimer );
				this.claimTimer = null;
			}
			return;
		}
		if ( msg.type === 'event' ) {
			this.handlers.onEvent?.( msg.payload );
			return;
		}
		if ( msg.type === 'resign' && msg.tabId === this.currentLeaderId ) {
			this.currentLeaderId = null;
			if ( this.claimTimer !== null ) {
				window.clearTimeout( this.claimTimer );
			}
			this.claimTimer = window.setTimeout(
				() => this.claim(),
				ELECTION_TIMEOUT_MS,
			);
			return;
		}
		if ( msg.type === 'who-leader' && this.isLeader ) {
			this.broadcast( 'heartbeat' );
		}
	};

	private broadcast(
		type: CoordMessage[ 'type' ],
		payload?: unknown,
	): void {
		if ( ! this.chan ) {
			return;
		}
		const msg: CoordMessage = {
			type,
			tabId: this.tabId,
			epoch: this.epoch,
			timestamp: Date.now(),
			payload,
		};
		try {
			this.chan.postMessage( msg );
		} catch ( _err ) {
			// Channel torn down — happens during unload. Swallow.
		}
	}
}

function generateTabId(): string {
	const cryptoApi = ( window as unknown as {
		crypto?: { randomUUID?: () => string };
	} ).crypto;
	if ( cryptoApi?.randomUUID ) {
		return cryptoApi.randomUUID();
	}
	return `tab-${ Date.now() }-${ Math.random().toString( 36 ).slice( 2 ) }`;
}
