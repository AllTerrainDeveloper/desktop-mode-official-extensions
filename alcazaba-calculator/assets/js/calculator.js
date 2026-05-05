/**
 * Alcazaba Calculator — native desktop window render callback.
 *
 * Two tabs, registered independently in PHP via
 * `desktop_mode_register_window()` (main) and
 * `desktop_mode_register_window_tab()` (convert). The shell wraps
 * each tab's template in a `<wpd-tabpanel>` and owns pane
 * visibility; this file never touches `hidden`, `data-pane`, or a
 * tab-change listener.
 *
 *   Calc    — four-function calculator. `<wpd-key>` events from a
 *             grid keypad feed a state machine; result renders in
 *             a `<wpd-display>`.
 *
 *   Convert — unit converter across Length / Temp / Mass. A
 *             `<wpd-segmented>` picks the category; two
 *             `<wpd-select>`s pick from/to units (populated via the
 *             declarative `.items = [...]` setter); a
 *             `<wpd-number-field>` takes the value; the result
 *             renders in a `<wpd-display>`. No keypad sharing, no
 *             tab-scoped dispatcher.
 *
 * Selectors scope to the relevant tabpanel so the calculator's
 * `[data-role="display"]` can't collide with any future tab that
 * reuses a data-role name.
 *
 * @since 0.1.0
 */
( function () {
	'use strict';

	/** Window id matches the `desktop_mode_register_window()` call in PHP. */
	var WINDOW_ID = 'alcazaba-calculator';

	// ─────────────────────────────────────────────────────────
	// Calculator state machine. Unchanged from the single-pane
	// version — moving the Convert tab out of this tree let the
	// calculator go back to being a plain state-in / display-out
	// module.
	// ─────────────────────────────────────────────────────────

	function createCalcState() {
		return {
			entry: '0',
			acc: null,
			op: null,
			justOp: false,
			justEq: false,
		};
	}

	function toNumber( entry ) {
		var n = parseFloat( entry );
		return isFinite( n ) ? n : 0;
	}

	function format( n ) {
		if ( ! isFinite( n ) ) {
			return 'Error';
		}
		if ( Math.abs( n ) >= 1e12 || ( Math.abs( n ) > 0 && Math.abs( n ) < 1e-6 ) ) {
			return n.toExponential( 6 );
		}
		return String( + n.toFixed( 10 ) );
	}

	function apply( a, b, op ) {
		switch ( op ) {
			case 'add':      return a + b;
			case 'subtract': return a - b;
			case 'multiply': return a * b;
			case 'divide':   return 0 === b ? NaN : a / b;
			default:         return b;
		}
	}

	function inputDigit( state, digit ) {
		if ( state.justOp || state.justEq ) {
			state.entry = '.' === digit ? '0.' : digit;
			state.justOp = false;
			state.justEq = false;
			return;
		}
		if ( '.' === digit ) {
			if ( -1 === state.entry.indexOf( '.' ) ) {
				state.entry += '.';
			}
			return;
		}
		if ( '0' === state.entry ) {
			state.entry = digit;
			return;
		}
		if ( state.entry.replace( /[^0-9]/g, '' ).length < 12 ) {
			state.entry += digit;
		}
	}

	function inputOp( state, op ) {
		if ( null !== state.op && ! state.justOp && ! state.justEq ) {
			state.acc = apply( state.acc, toNumber( state.entry ), state.op );
			state.entry = format( state.acc );
		} else if ( null === state.acc || state.justEq ) {
			state.acc = toNumber( state.entry );
		}
		state.op = op;
		state.justOp = true;
		state.justEq = false;
	}

	function inputAction( state, action ) {
		switch ( action ) {
			case 'clear':
				state.entry = '0';
				state.acc = null;
				state.op = null;
				state.justOp = false;
				state.justEq = false;
				return;
			case 'sign':
				if ( '0' !== state.entry ) {
					state.entry = '-' === state.entry.charAt( 0 )
						? state.entry.slice( 1 )
						: '-' + state.entry;
				}
				return;
			case 'percent':
				state.entry = format( toNumber( state.entry ) / 100 );
				return;
			case 'equals':
				if ( null !== state.op && null !== state.acc ) {
					var result = apply( state.acc, toNumber( state.entry ), state.op );
					state.entry = format( result );
					state.acc = result;
					state.op = null;
					state.justOp = false;
					state.justEq = true;
				}
				return;
		}
	}

	// ─────────────────────────────────────────────────────────
	// Unit converter. Linear categories use a factor pair;
	// temperature needs real formulas since °C = 0 ≠ 0 °F ≠ 0 K.
	// ─────────────────────────────────────────────────────────

	var CATEGORIES = {
		length: {
			units: [
				{ value: 'm',  label: 'Metres',     toBase: function ( v ) { return v; },            fromBase: function ( v ) { return v; } },
				{ value: 'km', label: 'Kilometres', toBase: function ( v ) { return v * 1000; },     fromBase: function ( v ) { return v / 1000; } },
				{ value: 'mi', label: 'Miles',      toBase: function ( v ) { return v * 1609.344; }, fromBase: function ( v ) { return v / 1609.344; } },
				{ value: 'ft', label: 'Feet',       toBase: function ( v ) { return v * 0.3048; },   fromBase: function ( v ) { return v / 0.3048; } },
				{ value: 'in', label: 'Inches',     toBase: function ( v ) { return v * 0.0254; },   fromBase: function ( v ) { return v / 0.0254; } },
			],
		},
		temp: {
			units: [
				{ value: 'c', label: 'Celsius (\u00B0C)',    toBase: function ( v ) { return v; },                  fromBase: function ( v ) { return v; } },
				{ value: 'f', label: 'Fahrenheit (\u00B0F)', toBase: function ( v ) { return ( v - 32 ) * 5 / 9; }, fromBase: function ( v ) { return v * 9 / 5 + 32; } },
				{ value: 'k', label: 'Kelvin (K)',           toBase: function ( v ) { return v - 273.15; },         fromBase: function ( v ) { return v + 273.15; } },
			],
		},
		mass: {
			units: [
				{ value: 'kg', label: 'Kilograms', toBase: function ( v ) { return v; },                 fromBase: function ( v ) { return v; } },
				{ value: 'g',  label: 'Grams',     toBase: function ( v ) { return v / 1000; },          fromBase: function ( v ) { return v * 1000; } },
				{ value: 'lb', label: 'Pounds',    toBase: function ( v ) { return v * 0.45359237; },    fromBase: function ( v ) { return v / 0.45359237; } },
				{ value: 'oz', label: 'Ounces',    toBase: function ( v ) { return v * 0.028349523125; }, fromBase: function ( v ) { return v / 0.028349523125; } },
			],
		},
	};

	function optionsFor( category ) {
		return CATEGORIES[ category ].units.map( function ( u ) {
			return { value: u.value, label: u.label };
		} );
	}

	function convert( category, from, to, value ) {
		var units = CATEGORIES[ category ].units;
		var src = null;
		var dst = null;
		for ( var i = 0; i < units.length; i++ ) {
			if ( units[ i ].value === from ) { src = units[ i ]; }
			if ( units[ i ].value === to )   { dst = units[ i ]; }
		}
		if ( ! src || ! dst ) { return 0; }
		return dst.fromBase( src.toBase( value ) );
	}

	// ─────────────────────────────────────────────────────────
	// Calc tab wiring. Scope to `wpd-tabpanel[for="main"]` so the
	// Convert tab's own `[data-role="display"]` (if it ever gained
	// one) couldn't collide.
	// ─────────────────────────────────────────────────────────

	function wireCalcTab( pane ) {
		var display = pane.querySelector( '[data-role="display"]' );
		var keypad  = pane.querySelector( '[data-role="keypad"]' );
		if ( ! display || ! keypad ) {
			return;
		}

		var state = createCalcState();
		function repaint() { display.textContent = state.entry; }

		// `<wpd-key>` fires on click AND on matching keydown while
		// the focused window has focus — one listener covers mouse,
		// touch, and physical keyboard.
		keypad.addEventListener( 'wpd-key', function ( event ) {
			var el = event.target;
			if ( el.hasAttribute( 'data-digit' ) ) {
				inputDigit( state, el.getAttribute( 'data-digit' ) );
			} else if ( el.hasAttribute( 'data-op' ) ) {
				inputOp( state, el.getAttribute( 'data-op' ) );
			} else if ( el.hasAttribute( 'data-action' ) ) {
				inputAction( state, el.getAttribute( 'data-action' ) );
			} else {
				return;
			}
			repaint();
		} );
	}

	// ─────────────────────────────────────────────────────────
	// Convert tab wiring. Each control owns its slice of state; the
	// result display recomputes on any change.
	// ─────────────────────────────────────────────────────────

	function wireConvertTab( pane ) {
		var category = pane.querySelector( '[data-role="category"]' );
		var from     = pane.querySelector( '[data-role="from"]' );
		var to       = pane.querySelector( '[data-role="to"]' );
		var field    = pane.querySelector( '[data-role="value"]' );
		var output   = pane.querySelector( '[data-role="convert-output"]' );

		if ( ! category || ! from || ! to || ! field || ! output ) {
			return;
		}

		var state = {
			category: 'length',
			from: 'm',
			to: 'km',
			value: 1,
		};

		function populate() {
			// `.items = [...]` is the declarative setter the shell
			// ships on `<wpd-select>` — it diffs children, preserves
			// `value` when still valid, clears otherwise. Same shape
			// will work on `<wpd-segmented>` too.
			var opts = optionsFor( state.category );
			from.items = opts;
			to.items   = opts;

			// Reseed defaults on category change so `.value` always
			// points at a real option.
			state.from = opts[ 0 ].value;
			state.to   = opts[ 1 ] ? opts[ 1 ].value : opts[ 0 ].value;
			from.setAttribute( 'value', state.from );
			to.setAttribute( 'value', state.to );
		}

		function repaint() {
			var result = convert( state.category, state.from, state.to, state.value );
			output.textContent = format( result );
		}

		populate();
		repaint();

		category.addEventListener( 'wpd-pick', function ( event ) {
			var next = event.detail && event.detail.value;
			if ( ! next || ! CATEGORIES[ next ] || next === state.category ) {
				return;
			}
			state.category = next;
			populate();
			repaint();
		} );

		from.addEventListener( 'wpd-pick', function ( event ) {
			if ( event.detail && event.detail.value ) {
				state.from = event.detail.value;
				repaint();
			}
		} );

		to.addEventListener( 'wpd-pick', function ( event ) {
			if ( event.detail && event.detail.value ) {
				state.to = event.detail.value;
				repaint();
			}
		} );

		// `wpd-input-change` fires on every keystroke while the
		// entry parses as a finite number; `wpd-input-commit` fires
		// on blur/Enter with the clamped value. Repaint on both so
		// the result tracks live typing but snaps to clamped ranges
		// on commit if we ever add `min`/`max` to the field.
		field.addEventListener( 'wpd-input-change', function ( event ) {
			state.value = event.detail.value;
			repaint();
		} );
		field.addEventListener( 'wpd-input-commit', function ( event ) {
			state.value = event.detail.value;
			repaint();
		} );
	}

	// ─────────────────────────────────────────────────────────
	// Render callback. Shell calls this once per window open with
	// a body that already contains the `<wpd-tabs>` +
	// `<wpd-tabpanel>` tree the auto-tab pipeline built.
	// ─────────────────────────────────────────────────────────

	function renderCalculator( body ) {
		// Under the current wp-desktop-mode contract, the shell
		// pre-populates `body` with the cloned `<template>` BEFORE
		// invoking this render callback (see
		// `native-windows.ts:openFromEntry` — the shell does
		// `body.appendChild( cloneTemplate( entry.templateId ) )`
		// then hands us `body`). Our job is to query the live DOM
		// and wire interactions — never to clone or append the
		// template ourselves, or the body ends up with duplicate
		// subtrees and only the first one gets wired.
		var mainPane    = body.querySelector( 'wpd-tabpanel[for="main"]' );
		var convertPane = body.querySelector( 'wpd-tabpanel[for="convert"]' );
		if ( mainPane )    { wireCalcTab( mainPane ); }
		if ( convertPane ) { wireConvertTab( convertPane ); }
	}

	window.wpDesktopNativeWindows = window.wpDesktopNativeWindows || {};
	window.wpDesktopNativeWindows[ WINDOW_ID ] = renderCalculator;
}() );
