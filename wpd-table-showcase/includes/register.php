<?php
/**
 * Native window + desktop icon registration for the showcase.
 *
 * One window, nine tabs (one per `<wpd-table>` feature). Each tab's
 * template is a small placeholder shell — the JS render callback queries
 * `wpd-tabpanel[for="..."]` and lights it up. Templates avoid heavy
 * markup so the showcase reads as "API surface", not "ad-hoc HTML".
 *
 * @package WpdTableShowcase
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'init',
	function () {
		if ( ! function_exists( 'desktop_mode_register_window' ) ) {
			return;
		}

		desktop_mode_register_window(
			WPD_TABLE_SHOWCASE_WINDOW_ID,
			array(
				'title'          => __( 'Table Showcase', 'wpd-table-showcase' ),
				'main_tab_label' => __( 'Basics', 'wpd-table-showcase' ),
				'icon'           => 'dashicons-list-view',
				'width'          => 1100,
				'height'         => 720,
				'script'         => WPD_TABLE_SHOWCASE_SCRIPT_HANDLE,
				'template'       => 'wpd_table_showcase_tab_basics',
			)
		);

		$tabs = array(
			array( 'filters',   __( 'Filters',      'wpd-table-showcase' ), 'wpd_table_showcase_tab_filters'   ),
			array( 'sort',      __( 'Sort',         'wpd-table-showcase' ), 'wpd_table_showcase_tab_sort'      ),
			array( 'selection', __( 'Selection',    'wpd-table-showcase' ), 'wpd_table_showcase_tab_selection' ),
			array( 'sticky',    __( 'Sticky',       'wpd-table-showcase' ), 'wpd_table_showcase_tab_sticky'    ),
			array( 'cells',     __( 'Custom cells', 'wpd-table-showcase' ), 'wpd_table_showcase_tab_cells'     ),
			array( 'subtables', __( 'Sub-tables',   'wpd-table-showcase' ), 'wpd_table_showcase_tab_subtables' ),
			array( 'states',    __( 'States',       'wpd-table-showcase' ), 'wpd_table_showcase_tab_states'    ),
			array( 'theming',   __( 'Theming',      'wpd-table-showcase' ), 'wpd_table_showcase_tab_theming'   ),
			array( 'all',       __( 'All-in-one',   'wpd-table-showcase' ), 'wpd_table_showcase_tab_all'       ),
		);

		$position = 10;
		foreach ( $tabs as $tab ) {
			desktop_mode_register_window_tab(
				WPD_TABLE_SHOWCASE_WINDOW_ID,
				array(
					'value'    => $tab[0],
					'label'    => $tab[1],
					'position' => $position,
					'template' => $tab[2],
				)
			);
			$position += 10;
		}

		if ( function_exists( 'desktop_mode_register_icon' ) ) {
			desktop_mode_register_icon(
				WPD_TABLE_SHOWCASE_WINDOW_ID,
				array(
					'title'    => __( 'Table Showcase', 'wpd-table-showcase' ),
					'icon'     => 'dashicons-list-view',
					'window'   => WPD_TABLE_SHOWCASE_WINDOW_ID,
					'position' => 50,
				)
			);
		}
	}
);

/**
 * Tab template: Basics — the two-property happy path.
 */
function wpd_table_showcase_tab_basics() {
	?>
	<wpd-stack gap="8">
		<p class="wpd-table-showcase__hint">
			<?php esc_html_e( 'The minimum viable table — `columns` and `data`, nothing else.', 'wpd-table-showcase' ); ?>
		</p>
		<wpd-table data-scene="basics"></wpd-table>
	</wpd-stack>
	<?php
}

/**
 * Tab template: Filters — text + select filters and clearFilters().
 */
function wpd_table_showcase_tab_filters() {
	?>
	<wpd-stack gap="8">
		<wpd-row gap="8">
			<wpd-display col="6" data-role="counter">—</wpd-display>
			<wpd-button col="3" data-role="clear" data-noclick><?php esc_html_e( 'Clear filters', 'wpd-table-showcase' ); ?></wpd-button>
			<wpd-button col="3" data-role="seed" data-noclick><?php esc_html_e( 'Pre-seed (status=paid)', 'wpd-table-showcase' ); ?></wpd-button>
		</wpd-row>
		<wpd-table data-scene="filters"></wpd-table>
	</wpd-stack>
	<?php
}

/**
 * Tab template: Sort — sortable + sortValue.
 */
function wpd_table_showcase_tab_sort() {
	?>
	<wpd-stack gap="8">
		<wpd-row gap="8">
			<wpd-display col="9" data-role="active-sort">—</wpd-display>
			<wpd-button col="3" data-role="clear-sort" data-noclick><?php esc_html_e( 'Clear sort', 'wpd-table-showcase' ); ?></wpd-button>
		</wpd-row>
		<wpd-table data-scene="sort"></wpd-table>
	</wpd-stack>
	<?php
}

/**
 * Tab template: Selection — selectable=multi + getRowId.
 */
function wpd_table_showcase_tab_selection() {
	?>
	<wpd-stack gap="8">
		<wpd-row gap="8">
			<wpd-display col="6" data-role="count">0 selected</wpd-display>
			<wpd-button col="2" data-role="select-all" data-noclick><?php esc_html_e( 'Select all', 'wpd-table-showcase' ); ?></wpd-button>
			<wpd-button col="2" data-role="clear" data-noclick><?php esc_html_e( 'Clear', 'wpd-table-showcase' ); ?></wpd-button>
			<wpd-button col="2" data-role="bulk" data-noclick><?php esc_html_e( 'Bulk action', 'wpd-table-showcase' ); ?></wpd-button>
		</wpd-row>
		<wpd-table data-scene="selection" selectable="multi"></wpd-table>
	</wpd-stack>
	<?php
}

/**
 * Tab template: Sticky — sticky-columns + sticky-header + RTL toggle.
 */
function wpd_table_showcase_tab_sticky() {
	?>
	<wpd-stack gap="8">
		<wpd-row gap="8">
			<wpd-checkbox col="4" data-role="rtl" label="<?php esc_attr_e( 'Right-to-left', 'wpd-table-showcase' ); ?>"></wpd-checkbox>
			<wpd-checkbox col="4" data-role="bordered" label="<?php esc_attr_e( 'Bordered', 'wpd-table-showcase' ); ?>"></wpd-checkbox>
			<wpd-checkbox col="4" data-role="compact" label="<?php esc_attr_e( 'Compact', 'wpd-table-showcase' ); ?>"></wpd-checkbox>
		</wpd-row>
		<div data-role="rtl-wrap" style="--wpd-table-max-height: 360px;">
			<wpd-table data-scene="sticky" sticky-columns="2" sticky-header striped hover></wpd-table>
		</div>
	</wpd-stack>
	<?php
}

/**
 * Tab template: Custom cells — string / TemplateResult / HTMLElement renderers.
 */
function wpd_table_showcase_tab_cells() {
	?>
	<wpd-stack gap="8">
		<p class="wpd-table-showcase__hint">
			<?php esc_html_e( 'Avatar (img), status pill (badge), money (string), trend (SVG node), action (button with data-noclick).', 'wpd-table-showcase' ); ?>
		</p>
		<wpd-table data-scene="cells" hover></wpd-table>
	</wpd-stack>
	<?php
}

/**
 * Tab template: Sub-tables — three-level nesting + persistence.
 */
function wpd_table_showcase_tab_subtables() {
	?>
	<wpd-stack gap="8">
		<wpd-row gap="8">
			<wpd-button col="3" data-role="expand-all" data-noclick><?php esc_html_e( 'Expand all', 'wpd-table-showcase' ); ?></wpd-button>
			<wpd-button col="3" data-role="collapse-all" data-noclick><?php esc_html_e( 'Collapse all', 'wpd-table-showcase' ); ?></wpd-button>
			<wpd-display col="6" data-role="open-count">0 expanded</wpd-display>
		</wpd-row>
		<wpd-table data-scene="subtables" hover></wpd-table>
	</wpd-stack>
	<?php
}

/**
 * Tab template: States — loading toggle and slottable empty state.
 */
function wpd_table_showcase_tab_states() {
	?>
	<wpd-stack gap="12">
		<wpd-panel>
			<wpd-stack gap="6">
				<wpd-row gap="8">
					<wpd-button col="6" data-role="reload" data-noclick><?php esc_html_e( 'Simulate reload (1.2s)', 'wpd-table-showcase' ); ?></wpd-button>
					<wpd-number-field col="6" label="<?php esc_attr_e( 'Skeleton rows', 'wpd-table-showcase' ); ?>" data-role="skeleton-rows" value="5" min="1" max="20"></wpd-number-field>
				</wpd-row>
				<wpd-table data-scene="loading"></wpd-table>
			</wpd-stack>
		</wpd-panel>

		<wpd-panel>
			<wpd-stack gap="6">
				<wpd-row gap="8">
					<wpd-button col="6" data-role="filter-empty" data-noclick><?php esc_html_e( 'Filter to nothing', 'wpd-table-showcase' ); ?></wpd-button>
					<wpd-button col="6" data-role="reset-data" data-noclick><?php esc_html_e( 'Reset', 'wpd-table-showcase' ); ?></wpd-button>
				</wpd-row>
				<wpd-table data-scene="empty">
					<div slot="empty" class="wpd-table-showcase__empty">
						<p><?php esc_html_e( 'No matching orders.', 'wpd-table-showcase' ); ?></p>
						<wpd-button data-role="reset-from-slot"><?php esc_html_e( 'Reset filters', 'wpd-table-showcase' ); ?></wpd-button>
					</div>
				</wpd-table>
			</wpd-stack>
		</wpd-panel>
	</wpd-stack>
	<?php
}

/**
 * Tab template: Theming — sliders bound to CSS custom properties.
 */
function wpd_table_showcase_tab_theming() {
	?>
	<wpd-stack gap="8">
		<wpd-row gap="8">
			<wpd-number-field col="3" label="<?php esc_attr_e( 'Font size (px)', 'wpd-table-showcase' ); ?>" data-role="font-size" value="13" min="10" max="20"></wpd-number-field>
			<wpd-number-field col="3" label="<?php esc_attr_e( 'Cell padding-y (px)', 'wpd-table-showcase' ); ?>" data-role="pad-y" value="8"  min="2"  max="20"></wpd-number-field>
			<wpd-number-field col="3" label="<?php esc_attr_e( 'Cell padding-x (px)', 'wpd-table-showcase' ); ?>" data-role="pad-x" value="12" min="2"  max="32"></wpd-number-field>
			<wpd-select       col="3" label="<?php esc_attr_e( 'Accent', 'wpd-table-showcase' ); ?>" data-role="accent" value="default">
				<wpd-option value="default"><?php esc_html_e( 'Default', 'wpd-table-showcase' ); ?></wpd-option>
				<wpd-option value="rose"><?php esc_html_e( 'Rose', 'wpd-table-showcase' ); ?></wpd-option>
				<wpd-option value="indigo"><?php esc_html_e( 'Indigo', 'wpd-table-showcase' ); ?></wpd-option>
				<wpd-option value="forest"><?php esc_html_e( 'Forest', 'wpd-table-showcase' ); ?></wpd-option>
			</wpd-select>
		</wpd-row>
		<div data-role="theme-wrap">
			<wpd-table data-scene="theming" striped hover></wpd-table>
		</div>
	</wpd-stack>
	<?php
}

/**
 * Tab template: All-in-one — every feature combined.
 */
function wpd_table_showcase_tab_all() {
	?>
	<wpd-stack gap="8">
		<p class="wpd-table-showcase__hint">
			<?php esc_html_e( 'Filters + sort + multi-select + sticky band + custom cells + sub-tables + scrollToRow.', 'wpd-table-showcase' ); ?>
		</p>
		<wpd-row gap="8">
			<wpd-number-field col="4" label="<?php esc_attr_e( 'Scroll to index', 'wpd-table-showcase' ); ?>" data-role="scroll-index" value="20" min="0" max="41"></wpd-number-field>
			<wpd-button       col="2" data-role="scroll" data-noclick><?php esc_html_e( 'Go', 'wpd-table-showcase' ); ?></wpd-button>
			<wpd-display      col="6" data-role="status">—</wpd-display>
		</wpd-row>
		<div style="--wpd-table-max-height: 380px;">
			<wpd-table data-scene="all" sticky-columns="3" sticky-header selectable="multi" striped hover></wpd-table>
		</div>
	</wpd-stack>
	<?php
}
