/**
 * OS Settings tab — "Messages". Built form using `<wpd-*>`
 * primitives; persists via the `/wp-desktop/v1/messages/settings`
 * REST round-trip.
 *
 * Loaded from the always-on shell bundle so the tab is available
 * even when the chat window has never been opened in this session.
 *
 * @since 0.22.0
 */

import { __ } from './wp';
import { getSettings, saveSettings } from './transport/rest';
import { setSettings } from './state';
import type { MessagesSiteSettings, SoundDef, UserSettings } from './types';

interface RegisterSettingsTabFn {
	( tab: {
		id: string;
		label: string;
		owner?: string;
		order?: number;
		render( body: HTMLElement ): void;
	} ): void;
}

export function registerMessagesSettingsTab(): void {
	try {
		const wp = ( window as unknown as {
			wp?: { desktop?: { registerSettingsTab?: RegisterSettingsTabFn } };
		} ).wp;
		const register = wp?.desktop?.registerSettingsTab;
		if ( typeof register !== 'function' ) {
			// Shell not ready — defer if `ready` is available; otherwise
			// retry on the next tick. Either way we MUST NOT throw —
			// other tab-registration paths (server-sync, third-party
			// scripts) may run after us and a thrown error here cancels
			// their callbacks too.
			const ready = ( window as unknown as {
				wp?: { desktop?: { ready?: ( cb: () => void ) => void } };
			} ).wp?.desktop?.ready;
			if ( typeof ready === 'function' ) {
				ready( () => registerMessagesSettingsTab() );
			} else {
				window.setTimeout( () => registerMessagesSettingsTab(), 100 );
			}
			return;
		}

		register( {
			id: 'messages',
			label: __( 'Messages' ),
			owner: 'wp-desktop-messages-shell',
			order: 25,
			render( body ) {
				void renderForm( body );
			},
		} );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( '[wpdm-messages] settings-tab registration failed', err );
	}
}

async function renderForm( body: HTMLElement ): Promise< void > {
	body.innerHTML = '';
	const cfg = window.wpDesktopMessagesConfig;
	const sounds = cfg?.sounds ?? [];

	let current: UserSettings;
	try {
		current = await getSettings();
	} catch ( _err ) {
		current = cfg?.userSettings ?? {
			nudgeSoundId: '',
			volume: 0.7,
			showToast: true,
			soundWhileFocused: false,
			inactiveAfterSeconds: 300,
			acceptFrom: 'everyone',
		};
	}

	const root = document.createElement( 'div' );
	root.className = 'wpdm-messages-settings';

	const stack = document.createElement( 'wpd-stack' );
	stack.setAttribute( 'gap', '16' );

	stack.appendChild( buildSoundField( sounds, current ) );
	stack.appendChild( buildVolumeField( current ) );
	stack.appendChild( buildShowToastField( current ) );
	stack.appendChild( buildSoundFocusedField( current ) );
	stack.appendChild( buildInactiveField( current ) );
	stack.appendChild( buildAcceptFromField( current ) );

	// Admin-only: site-level toggles. Only painted when the PHP enqueue
	// determined the user has `manage_options` and shipped down the
	// `siteSettings` blob — non-admins never see this row, so an
	// over-eager browser inspect can't surface the toggle.
	if ( cfg?.siteSettings && cfg?.siteSettingsUrl ) {
		stack.appendChild(
			buildSiteAdminBlock( cfg.siteSettings, cfg.siteSettingsUrl, cfg.restNonce ),
		);
	}

	root.appendChild( stack );
	body.appendChild( root );

	// Persist on every change. Optimistic — show the new state
	// immediately, roll back if the server rejects.
	root.addEventListener( 'wpdm-messages-settings-change', async ( ev ) => {
		const detail = ( ev as CustomEvent< Partial< UserSettings > > ).detail;
		const next = { ...current, ...detail };
		current = next;
		setSettings( next );
		try {
			const saved = await saveSettings( detail );
			current = saved;
			setSettings( saved );
		} catch ( _err ) {
			// silent — UI stays optimistic.
		}
	} );
}

function emitChange(
	host: HTMLElement,
	detail: Partial< UserSettings >,
): void {
	host.dispatchEvent(
		new CustomEvent( 'wpdm-messages-settings-change', {
			detail,
			bubbles: true,
		} ),
	);
}

function buildSoundField( sounds: SoundDef[], current: UserSettings ): HTMLElement {
	const select = document.createElement( 'wpd-select' );
	select.setAttribute( 'label', __( 'Nudge sound' ) );
	select.setAttribute( 'value', current.nudgeSoundId || '' );

	const optDefault = document.createElement( 'wpd-option' );
	optDefault.setAttribute( 'value', '' );
	optDefault.textContent = __( 'Default' );
	select.appendChild( optDefault );

	for ( const s of sounds ) {
		const opt = document.createElement( 'wpd-option' );
		opt.setAttribute( 'value', s.id );
		opt.textContent = s.label;
		select.appendChild( opt );
	}

	const optSilent = document.createElement( 'wpd-option' );
	optSilent.setAttribute( 'value', 'silent' );
	optSilent.textContent = __( '(silent)' );
	select.appendChild( optSilent );

	select.addEventListener( 'wpd-pick', ( ev ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail?.value ?? '';
		emitChange( select, { nudgeSoundId: value } );
	} );

	return select;
}

function buildVolumeField( current: UserSettings ): HTMLElement {
	const range = document.createElement( 'wpd-range-field' );
	range.setAttribute( 'label', __( 'Volume' ) );
	range.setAttribute( 'min', '0' );
	range.setAttribute( 'max', '100' );
	range.setAttribute( 'step', '5' );
	range.setAttribute( 'value', String( Math.round( current.volume * 100 ) ) );
	range.setAttribute( 'suffix', '%' );
	range.addEventListener( 'wpd-range-change', ( ev ) => {
		const v = ( ev as CustomEvent< { value: number } > ).detail?.value ?? 0;
		emitChange( range, { volume: Math.max( 0, Math.min( 1, v / 100 ) ) } );
	} );
	return range;
}

function buildShowToastField( current: UserSettings ): HTMLElement {
	// `<wpd-checkbox-label>` reads its visible text from the `label`
	// attribute, NOT from its child text — `textContent` produces an
	// invisible label.
	const cb = document.createElement( 'wpd-checkbox-label' );
	cb.setAttribute( 'label', __( 'Show toast on incoming message' ) );
	if ( current.showToast ) {
		cb.setAttribute( 'checked', '' );
	}
	cb.addEventListener( 'wpd-checkbox-change', ( ev ) => {
		const checked = !! ( ev as CustomEvent< { checked: boolean } > ).detail?.checked;
		emitChange( cb, { showToast: checked } );
	} );
	return cb;
}

function buildSoundFocusedField( current: UserSettings ): HTMLElement {
	const cb = document.createElement( 'wpd-checkbox-label' );
	cb.setAttribute( 'label', __( 'Play sound even when chat window is focused' ) );
	if ( current.soundWhileFocused ) {
		cb.setAttribute( 'checked', '' );
	}
	cb.addEventListener( 'wpd-checkbox-change', ( ev ) => {
		const checked = !! ( ev as CustomEvent< { checked: boolean } > ).detail?.checked;
		emitChange( cb, { soundWhileFocused: checked } );
	} );
	return cb;
}

function buildInactiveField( current: UserSettings ): HTMLElement {
	const wrap = document.createElement( 'div' );
	const number = document.createElement( 'wpd-number-field' );
	number.setAttribute( 'label', __( 'Mark me inactive after (minutes)' ) );
	number.setAttribute( 'min', '1' );
	number.setAttribute( 'max', '60' );
	number.setAttribute( 'step', '1' );
	number.setAttribute( 'suffix', __( 'min' ) );
	number.setAttribute(
		'value',
		String( Math.round( current.inactiveAfterSeconds / 60 ) ),
	);
	number.addEventListener( 'wpd-input-commit', ( ev ) => {
		const v = ( ev as CustomEvent< { value: number } > ).detail?.value ?? 5;
		emitChange( wrap, {
			inactiveAfterSeconds: Math.max( 60, Math.min( 3600, v * 60 ) ),
		} );
	} );
	wrap.appendChild( number );
	return wrap;
}

/**
 * Admin-only block: site-level messages toggles. Today this is
 * just the SSE real-time delivery opt-in. Lives in the messages
 * tab (not the framework's "Extended Options") because it's
 * messages-owned config — when this feature ships as a standalone
 * plugin the option moves with it.
 *
 * @since 0.23.0
 */
function buildSiteAdminBlock(
	initial: MessagesSiteSettings,
	url: string,
	nonce: string,
): HTMLElement {
	const wrap = document.createElement( 'wpd-section' );
	wrap.setAttribute(
		'heading',
		__( 'Site-level (administrators only)' ),
	);
	wrap.setAttribute(
		'description',
		__(
			'These toggles affect every user on the site. Only administrators can change them.',
		),
	);

	let saving = false;
	let error = '';
	let state = { ...initial };

	const cb = document.createElement( 'wpd-checkbox-label' );
	cb.setAttribute( 'label', __( 'Enable real-time chat updates (SSE)' ) );
	if ( state.realtime_sse_enabled ) {
		cb.setAttribute( 'checked', '' );
	}

	const hint = document.createElement( 'p' );
	hint.className = 'wp-desktop-ext__hint';
	hint.textContent = __(
		'Off by default. With this off, the Messages window polls the server every few seconds for new messages — the safe default that works on every host. Turn it on only on capable hosting: real-time delivery uses Server-Sent Events, which holds a long-lived PHP-FPM worker per logged-in admin tab and can exhaust workers on shared / cheap hosting.',
	);

	const status = document.createElement( 'p' );
	status.className = 'wp-desktop-ext__saving';
	status.style.minHeight = '1em';

	const repaintStatus = (): void => {
		if ( error ) {
			status.className = 'wp-desktop-ext__error';
			status.textContent = error;
		} else if ( saving ) {
			status.className = 'wp-desktop-ext__saving';
			status.textContent = __( 'Saving…' );
		} else {
			status.textContent = '';
		}
	};

	const save = async ( next: MessagesSiteSettings ): Promise< void > => {
		saving = true;
		error = '';
		repaintStatus();
		try {
			const res = await fetch( url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': nonce,
				},
				body: JSON.stringify( { options: next } ),
			} );
			if ( ! res.ok ) {
				const body2 = await res.json().catch( () => ( {} ) ) as { message?: string };
				error = body2.message ?? `Error ${ res.status }`;
			} else {
				const saved = await res.json().catch( () => null );
				if ( saved && typeof saved === 'object' ) {
					state = saved as MessagesSiteSettings;
				}
			}
		} catch {
			error = __( 'Network error — check your connection.' );
		} finally {
			saving = false;
			repaintStatus();
		}
	};

	cb.addEventListener( 'wpd-checkbox-change', ( ev ) => {
		const checked = !! ( ev as CustomEvent< { checked: boolean } > ).detail?.checked;
		state = { ...state, realtime_sse_enabled: checked };
		void save( state );
	} );

	wrap.appendChild( cb );
	wrap.appendChild( hint );
	wrap.appendChild( status );
	return wrap;
}

function buildAcceptFromField( current: UserSettings ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'wpdm-messages-settings__accept-row';
	const label = document.createElement( 'label' );
	label.className = 'wpd-text-field__label';
	label.textContent = __( 'Accept messages from' );
	const seg = document.createElement( 'wpd-segmented' );
	seg.setAttribute( 'value', current.acceptFrom );
	const everyone = document.createElement( 'wpd-segment' );
	everyone.setAttribute( 'value', 'everyone' );
	everyone.textContent = __( 'Everyone' );
	const adminsOnly = document.createElement( 'wpd-segment' );
	adminsOnly.setAttribute( 'value', 'admins-only' );
	adminsOnly.textContent = __( 'Admins only' );
	seg.appendChild( everyone );
	seg.appendChild( adminsOnly );
	seg.addEventListener( 'wpd-pick', ( ev ) => {
		const value = ( ev as CustomEvent< { value: string } > ).detail?.value ?? 'everyone';
		emitChange( wrap, {
			acceptFrom: value === 'admins-only' ? 'admins-only' : 'everyone',
		} );
	} );
	wrap.appendChild( label );
	wrap.appendChild( seg );
	return wrap;
}
