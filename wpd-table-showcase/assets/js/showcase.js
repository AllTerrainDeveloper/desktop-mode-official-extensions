/**
 * WPD Table Showcase — render callback.
 *
 * One IIFE, one render entry on `window.wpDesktopNativeWindows[<id>]`.
 * Each tab is a small `init<Scene>()` that takes its `<wpd-tabpanel>`
 * root and the dataset, wires its `<wpd-table>`, and returns an
 * optional teardown. The outer callback aggregates teardowns and
 * returns one closer to the shell.
 *
 * No `html` template literal here on purpose — the doc supports
 * string and HTMLElement returns from `column.render`, and using
 * createElement keeps the showcase runnable without a build step.
 */
( function () {
	const WINDOW_ID = 'wpd-table-showcase';

	/* ---------- helpers ---------- */

	const formatMoney = ( value, currency ) => {
		try {
			return new Intl.NumberFormat( undefined, {
				style: 'currency',
				currency: currency || 'EUR',
			} ).format( value );
		} catch ( e ) {
			return String( value );
		}
	};

	const formatDate = ( iso ) => {
		const d = new Date( iso );
		return Number.isNaN( d.getTime() ) ? String( iso ) : d.toLocaleString();
	};

	const gravatarUrl = ( email ) => {
		// Cheap initials avatar — no network: deterministic SVG data URL.
		const letter = ( email || '?' ).trim().charAt( 0 ).toUpperCase();
		const hue = ( email || '' ).split( '' )
			.reduce( ( h, c ) => ( h + c.charCodeAt( 0 ) ) % 360, 0 );
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
				'<rect width="24" height="24" rx="12" fill="hsl(' + hue + ',60%,55%)"/>' +
				'<text x="12" y="16" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#fff">' + letter + '</text>' +
			'</svg>';
		return 'data:image/svg+xml;utf8,' + encodeURIComponent( svg );
	};

	const sparkline = ( values ) => {
		const max = Math.max.apply( null, values );
		const min = Math.min.apply( null, values );
		const range = Math.max( 1, max - min );
		const w = 80;
		const h = 22;
		const points = values.map( ( v, i ) => {
			const x = ( i / ( values.length - 1 ) ) * w;
			const y = h - ( ( v - min ) / range ) * h;
			return x.toFixed( 1 ) + ',' + y.toFixed( 1 );
		} ).join( ' ' );

		const svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
		svg.setAttribute( 'viewBox', '0 0 ' + w + ' ' + h );
		svg.setAttribute( 'width',  w );
		svg.setAttribute( 'height', h );
		svg.setAttribute( 'role', 'img' );
		svg.setAttribute( 'aria-label', 'trend: ' + values.join( ', ' ) );

		const poly = document.createElementNS( 'http://www.w3.org/2000/svg', 'polyline' );
		poly.setAttribute( 'points', points );
		poly.setAttribute( 'fill', 'none' );
		poly.setAttribute( 'stroke', 'currentColor' );
		poly.setAttribute( 'stroke-width', '1.5' );
		poly.setAttribute( 'stroke-linejoin', 'round' );
		poly.setAttribute( 'stroke-linecap',  'round' );
		svg.appendChild( poly );
		return svg;
	};

	const badge = ( status ) => {
		const tone = ( {
			pending:  'warning',
			paid:     'success',
			shipped:  'info',
			refunded: 'danger',
		} )[ status ] || 'neutral';
		const el = document.createElement( 'wpd-badge' );
		el.setAttribute( 'tone', tone );
		el.textContent = status;
		return el;
	};

	const actionButton = ( label, onClick ) => {
		const b = document.createElement( 'button' );
		b.type = 'button';
		b.textContent = label;
		b.dataset.noclick = '';
		b.className = 'wpd-table-showcase__action';
		b.addEventListener( 'click', onClick );
		return b;
	};

	const onPanelButton = ( panel, role, handler ) => {
		const btn = panel.querySelector( '[data-role="' + role + '"]' );
		if ( ! btn ) return;
		btn.addEventListener( 'click', handler );
	};

	/* ---------- column descriptors (reused across scenes) ---------- */

	const baseColumns = () => ( [
		{ key: 'id',       label: 'Order' },
		{ key: 'customer', label: 'Customer' },
		{ key: 'email',    label: 'Email' },
		{ key: 'country',  label: 'Country' },
		{ key: 'status',   label: 'Status' },
		{ key: 'total',    label: 'Total', align: 'end',
		  render: ( v, row ) => formatMoney( v, row.currency ) },
		{ key: 'created',  label: 'Created' },
	] );

	/* ---------- scenes ---------- */

	function initBasics( panel, data ) {
		const table = panel.querySelector( 'wpd-table[data-scene="basics"]' );
		table.columns = baseColumns();
		table.data = data;
	}

	function initFilters( panel, data ) {
		const table = panel.querySelector( 'wpd-table[data-scene="filters"]' );
		const counter = panel.querySelector( '[data-role="counter"]' );

		table.columns = [
			{ key: 'id',       label: 'Order',    filter: 'text' },
			{ key: 'customer', label: 'Customer', filter: 'text' },
			{ key: 'email',    label: 'Email',    filter: 'text' },
			{ key: 'country',  label: 'Country',  filter: 'select' },
			{ key: 'status',   label: 'Status',   filter: 'select' },
			{ key: 'payment',  label: 'Payment',  filter: 'select' },
			{ key: 'total',    label: 'Total',    align: 'end',
			  render: ( v, row ) => formatMoney( v, row.currency ) },
		];
		table.data = data;

		const updateCounter = () => {
			// Filtered rows are not exposed directly, so recompute from
			// `filters` against `data` for the chip. Cheap for ~40 rows.
			const f = table.filters || {};
			let matched = data.length;
			const keys = Object.keys( f ).filter( ( k ) => f[ k ] );
			if ( keys.length ) {
				matched = data.filter( ( row ) =>
					keys.every( ( k ) => {
						const v = String( row[ k ] || '' ).toLowerCase();
						return v.indexOf( String( f[ k ] ).toLowerCase() ) !== -1;
					} )
				).length;
			}
			counter.textContent = 'Showing ' + matched + ' of ' + data.length;
		};
		updateCounter();

		const onFilter = () => updateCounter();
		table.addEventListener( 'wpd-table-filter-change', onFilter );

		onPanelButton( panel, 'clear', () => table.clearFilters() );
		onPanelButton( panel, 'seed', () => {
			table.filters = { status: 'paid' };
		} );

		return () => table.removeEventListener( 'wpd-table-filter-change', onFilter );
	}

	function initSort( panel, data ) {
		const table = panel.querySelector( 'wpd-table[data-scene="sort"]' );
		const out = panel.querySelector( '[data-role="active-sort"]' );

		table.columns = [
			{ key: 'id',       label: 'Order',    sortable: true },
			{ key: 'customer', label: 'Customer', sortable: true },
			{ key: 'country',  label: 'Country',  sortable: true },
			{ key: 'status',   label: 'Status',   sortable: true,
			  // Custom rank rather than alphabetical.
			  sortValue: ( row ) => ( {
				  pending: 0, paid: 1, shipped: 2, refunded: 3,
			  } )[ row.status ] },
			{ key: 'total',    label: 'Total', align: 'end', sortable: true,
			  render: ( v, row ) => formatMoney( v, row.currency ) },
			{ key: 'created',  label: 'Created', sortable: true,
			  sortValue: ( row ) => Date.parse( row.created ) },
		];
		table.data = data;

		const onSort = ( e ) => {
			const s = e.detail.sort;
			out.textContent = s
				? 'Sorted by ' + s.key + ' (' + s.direction + ')'
				: 'No active sort';
		};
		onSort( { detail: { sort: table.sort } } );
		table.addEventListener( 'wpd-table-sort-change', onSort );

		onPanelButton( panel, 'clear-sort', () => table.clearSort() );
		return () => table.removeEventListener( 'wpd-table-sort-change', onSort );
	}

	function initSelection( panel, data ) {
		const table = panel.querySelector( 'wpd-table[data-scene="selection"]' );
		const count = panel.querySelector( '[data-role="count"]' );

		table.columns = baseColumns();
		table.getRowId = ( row ) => row.id;            // stable across data refreshes
		table.data = data;

		const onSel = ( e ) => {
			const n = e.detail.selection.length;
			count.textContent = n + ( 1 === n ? ' row selected' : ' rows selected' );
		};
		count.textContent = '0 rows selected';
		table.addEventListener( 'wpd-table-selection-change', onSel );

		onPanelButton( panel, 'select-all', () => table.selectAll() );
		onPanelButton( panel, 'clear', () => table.clearSelection() );
		onPanelButton( panel, 'bulk', () => {
			const rows = table.selectedRows || [];
			window.alert(
				rows.length
					? 'Bulk action on ' + rows.length + ' orders:\n' + rows.map( ( r ) => r.id ).join( ', ' )
					: 'Nothing selected.'
			);
		} );

		return () => table.removeEventListener( 'wpd-table-selection-change', onSel );
	}

	function initSticky( panel, data ) {
		const table = panel.querySelector( 'wpd-table[data-scene="sticky"]' );
		const wrap  = panel.querySelector( '[data-role="rtl-wrap"]' );

		// Wider column set so horizontal scroll engages.
		table.columns = [
			{ key: 'id',       label: 'Order' },
			{ key: 'customer', label: 'Customer' },
			{ key: 'email',    label: 'Email' },
			{ key: 'country',  label: 'Country' },
			{ key: 'status',   label: 'Status' },
			{ key: 'payment',  label: 'Payment' },
			{ key: 'total',    label: 'Total', align: 'end',
			  render: ( v, row ) => formatMoney( v, row.currency ) },
			{ key: 'currency', label: 'Currency' },
			{ key: 'tracking', label: 'Tracking', width: '180px' },
			{ key: 'created',  label: 'Created' },
		];
		table.data = data;

		const rtl = panel.querySelector( '[data-role="rtl"]' );
		rtl.addEventListener( 'wpd-checkbox-change', ( e ) => {
			wrap.dir = e.detail.checked ? 'rtl' : '';
		} );

		const bordered = panel.querySelector( '[data-role="bordered"]' );
		bordered.addEventListener( 'wpd-checkbox-change', ( e ) => {
			table.toggleAttribute( 'bordered', !! e.detail.checked );
		} );

		const compact = panel.querySelector( '[data-role="compact"]' );
		compact.addEventListener( 'wpd-checkbox-change', ( e ) => {
			table.toggleAttribute( 'compact', !! e.detail.checked );
		} );
	}

	function initCells( panel, data ) {
		const table = panel.querySelector( 'wpd-table[data-scene="cells"]' );

		table.columns = [
			{ key: 'email', label: '', width: '40px',
			  // HTMLElement return.
			  render: ( v ) => {
				  const img = document.createElement( 'img' );
				  img.src = gravatarUrl( v );
				  img.width = 24;
				  img.height = 24;
				  img.alt = '';
				  return img;
			  } },
			{ key: 'customer', label: 'Customer' },
			{ key: 'status',   label: 'Status',
			  // HTMLElement (custom element) return.
			  render: ( v ) => badge( v ) },
			{ key: 'total',    label: 'Total', align: 'end',
			  // String return — picks up text-align via column.align.
			  render: ( v, row ) => formatMoney( v, row.currency ) },
			{ key: 'history', label: 'Trend', width: '90px',
			  // HTMLElement return — inline SVG.
			  render: ( v ) => sparkline( v ) },
			{ key: 'id', label: '', width: '110px',
			  render: ( _v, row ) =>
				  actionButton( 'Refund', () => {
					  window.alert( 'Refund ' + row.id + '? (demo)' );
				  } ) },
		];
		table.data = data;
	}

	function initSubtables( panel, data ) {
		const table = panel.querySelector( 'wpd-table[data-scene="subtables"]' );
		const openCount = panel.querySelector( '[data-role="open-count"]' );

		table.columns = baseColumns();
		table.data = data;

		// Order → items → movements (3 levels).
		table.subTable = ( order ) => {
			if ( ! order.items || ! order.items.length ) return null;
			return {
				columns: [
					{ key: 'sku',   label: 'SKU' },
					{ key: 'name',  label: 'Item' },
					{ key: 'qty',   label: 'Qty', align: 'end' },
					{ key: 'price', label: 'Price', align: 'end',
					  render: ( v, row ) => formatMoney( v, order.currency ) },
				],
				data: order.items,
				subTable: ( item ) => {
					if ( ! item.movements || ! item.movements.length ) return null;
					return {
						columns: [
							{ key: 'id',       label: 'Movement' },
							{ key: 'type',     label: 'Type',
							  render: ( v ) => badge( v === 'in' ? 'paid' : 'shipped' ) },
							{ key: 'qty',      label: 'Qty', align: 'end' },
							{ key: 'location', label: 'Location' },
							{ key: 'at',       label: 'At',
							  render: ( v ) => formatDate( v ) },
						],
						data: item.movements,
					};
				},
			};
		};

		// Persist expanded set across this session.
		const KEY = 'wpd-table-showcase.subtables.expanded';
		try {
			const saved = JSON.parse( localStorage.getItem( KEY ) || '[]' );
			if ( Array.isArray( saved ) && saved.length ) {
				table.expanded = saved;
			}
		} catch ( e ) { /* ignore */ }

		const updateCount = () => {
			const open = Array.from( table.expanded || [] );
			openCount.textContent = open.length + ' expanded';
			try { localStorage.setItem( KEY, JSON.stringify( open ) ); } catch ( e ) {}
		};
		updateCount();

		const onExpand = () => updateCount();
		table.addEventListener( 'wpd-table-expand-change', onExpand );

		onPanelButton( panel, 'expand-all', () => { table.expandAll(); updateCount(); } );
		onPanelButton( panel, 'collapse-all', () => { table.collapseAll(); updateCount(); } );

		return () => table.removeEventListener( 'wpd-table-expand-change', onExpand );
	}

	function initStates( panel, data ) {
		// --- loading panel ---
		const loadingTable = panel.querySelector( 'wpd-table[data-scene="loading"]' );
		loadingTable.columns = baseColumns();
		loadingTable.data = data.slice( 0, 8 );

		const skeletonInput = panel.querySelector( '[data-role="skeleton-rows"]' );
		skeletonInput.addEventListener( 'wpd-input-change', ( e ) => {
			loadingTable.setAttribute( 'loading-rows', String( e.detail.value || 5 ) );
		} );

		onPanelButton( panel, 'reload', () => {
			loadingTable.toggleAttribute( 'loading', true );
			window.setTimeout( () => {
				loadingTable.toggleAttribute( 'loading', false );
			}, 1200 );
		} );

		// --- empty-slot panel ---
		const emptyTable = panel.querySelector( 'wpd-table[data-scene="empty"]' );
		emptyTable.columns = baseColumns();
		emptyTable.data = data.slice( 0, 6 );

		const filterToNothing = () => {
			emptyTable.filters = { customer: 'zzz-no-match' };
		};
		const reset = () => emptyTable.clearFilters();

		onPanelButton( panel, 'filter-empty', filterToNothing );
		onPanelButton( panel, 'reset-data',   reset );

		// Slot button — discovered after slot becomes visible, but the
		// element is light DOM and exists on parse, so the listener wires
		// up immediately.
		const slotBtn = panel.querySelector( '[data-role="reset-from-slot"]' );
		if ( slotBtn ) slotBtn.addEventListener( 'click', reset );
	}

	function initTheming( panel, data ) {
		const table = panel.querySelector( 'wpd-table[data-scene="theming"]' );
		table.columns = baseColumns();
		table.data = data;

		const apply = () => {
			const fs   = panel.querySelector( '[data-role="font-size"]' );
			const py   = panel.querySelector( '[data-role="pad-y"]' );
			const px   = panel.querySelector( '[data-role="pad-x"]' );
			const acc  = panel.querySelector( '[data-role="accent"]' );
			const fontSize = Number( fs.getAttribute( 'value' ) || '13' );
			const padY     = Number( py.getAttribute( 'value' ) || '8' );
			const padX     = Number( px.getAttribute( 'value' ) || '12' );
			const accent   = acc.getAttribute( 'value' ) || 'default';

			table.style.setProperty( '--wpd-table-font-size',    fontSize + 'px' );
			table.style.setProperty( '--wpd-table-cell-padding', padY + 'px ' + padX + 'px' );

			const palette = ( {
				default: { hover: 'rgba(0,0,0,0.04)',     stripe: 'rgba(0,0,0,0.02)' },
				rose:    { hover: 'rgba(244,63,94,0.10)', stripe: 'rgba(244,63,94,0.04)' },
				indigo:  { hover: 'rgba(79,70,229,0.10)', stripe: 'rgba(79,70,229,0.04)' },
				forest:  { hover: 'rgba(22,163,74,0.10)', stripe: 'rgba(22,163,74,0.04)' },
			} )[ accent ];
			table.style.setProperty( '--wpd-table-row-hover', palette.hover );
			table.style.setProperty( '--wpd-table-stripe',    palette.stripe );
		};

		[ 'font-size', 'pad-y', 'pad-x' ].forEach( ( role ) => {
			panel.querySelector( '[data-role="' + role + '"]' )
				.addEventListener( 'wpd-input-change', apply );
		} );
		panel.querySelector( '[data-role="accent"]' )
			.addEventListener( 'wpd-pick', apply );

		apply();
	}

	function initAll( panel, data ) {
		const table = panel.querySelector( 'wpd-table[data-scene="all"]' );
		const status = panel.querySelector( '[data-role="status"]' );

		table.columns = [
			{ key: 'id',       label: 'Order',    filter: 'text',  sortable: true },
			{ key: 'customer', label: 'Customer', filter: 'text',  sortable: true },
			{ key: 'email',    label: 'Email',    filter: 'text' },
			{ key: 'country',  label: 'Country',  filter: 'select', sortable: true },
			{ key: 'status',   label: 'Status',   filter: 'select',
			  render: ( v ) => badge( v ) },
			{ key: 'payment',  label: 'Payment',  filter: 'select' },
			{ key: 'total',    label: 'Total', align: 'end', sortable: true,
			  render: ( v, row ) => formatMoney( v, row.currency ) },
			{ key: 'created',  label: 'Created', sortable: true,
			  sortValue: ( row ) => Date.parse( row.created ) },
			{ key: 'tracking', label: 'Tracking', width: '180px' },
		];
		table.getRowId = ( row ) => row.id;
		table.data = data;

		table.subTable = ( order ) => order.items?.length
			? {
				columns: [
					{ key: 'sku',   label: 'SKU' },
					{ key: 'name',  label: 'Item' },
					{ key: 'qty',   label: 'Qty', align: 'end' },
					{ key: 'price', label: 'Price', align: 'end',
					  render: ( v ) => formatMoney( v, order.currency ) },
				],
				data: order.items,
			}
			: null;

		const updateStatus = () => {
			const sel  = table.selection ? table.selection.size || 0 : 0;
			const sort = table.sort
				? ' / sorted by ' + table.sort.key + ' (' + table.sort.direction + ')'
				: '';
			status.textContent = sel + ' selected' + sort;
		};
		updateStatus();
		table.addEventListener( 'wpd-table-selection-change', updateStatus );
		table.addEventListener( 'wpd-table-sort-change',      updateStatus );

		onPanelButton( panel, 'scroll', () => {
			const i = Number(
				panel.querySelector( '[data-role="scroll-index"]' ).getAttribute( 'value' ) || '0'
			);
			table.scrollToRow( i );
		} );

		return () => {
			table.removeEventListener( 'wpd-table-selection-change', updateStatus );
			table.removeEventListener( 'wpd-table-sort-change',      updateStatus );
		};
	}

	/* ---------- entry ---------- */

	const SCENES = {
		main:      initBasics,
		filters:   initFilters,
		sort:      initSort,
		selection: initSelection,
		sticky:    initSticky,
		cells:     initCells,
		subtables: initSubtables,
		states:    initStates,
		theming:   initTheming,
		all:       initAll,
	};

	window.wpDesktopNativeWindows = window.wpDesktopNativeWindows || {};
	window.wpDesktopNativeWindows[ WINDOW_ID ] = function ( body ) {
		const data = ( window.wpdTableShowcase && window.wpdTableShowcase.orders ) || [];
		const teardowns = [];
		const initialized = new Set();

		// Lazy-init: a scene only wires up the first time its tab is
		// visible. Initializing a `<wpd-table>` inside a hidden
		// `<wpd-tabpanel>` makes its layout reads return 0, which
		// breaks `sticky-columns` offsets (every sticky cell ends up
		// at inset-inline-start: 0). Deferring fixes that without
		// reaching into the component.
		const initScene = ( key ) => {
			if ( initialized.has( key ) ) return;
			const init = SCENES[ key ];
			const root = body.querySelector( 'wpd-tabpanel[for="' + key + '"]' );
			if ( ! init || ! root ) return;
			initialized.add( key );
			try {
				const cleanup = init( root, data );
				if ( 'function' === typeof cleanup ) teardowns.push( cleanup );
			} catch ( e ) {
				if ( window.console && console.error ) {
					console.error( '[wpd-table-showcase] scene "' + key + '" failed:', e );
				}
			}
		};

		const tabs = body.querySelector( 'wpd-tabs' );
		const initial = ( tabs && tabs.getAttribute( 'value' ) ) || 'main';
		initScene( initial );

		const onTabChange = ( e ) => initScene( e && e.detail && e.detail.value );
		if ( tabs ) {
			tabs.addEventListener( 'wpd-tab-change', onTabChange );
			teardowns.push( () => tabs.removeEventListener( 'wpd-tab-change', onTabChange ) );
		}

		return () => teardowns.forEach( ( fn ) => {
			try { fn(); } catch ( e ) {}
		} );
	};
}() );
