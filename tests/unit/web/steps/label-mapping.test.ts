/**
 * Tests for the shared LabelMappingStep.
 *
 * Enum-mode rows render the shared `Combobox`, so we traverse the React
 * element tree (same pattern as `container-pick.test.ts`) instead of
 * `renderToStaticMarkup` — radix-ui's Popover breaks SSR in tests.
 * Free-text mode (JIRA) stays plain HTML and keeps using SSR assertions.
 */

import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StandardStep } from '../../../../src/integrations/pm/manifest.js';
import { LabelMappingStep } from '../../../../web/src/components/projects/pm-providers/steps/label-mapping.js';
import { Combobox, type ComboboxOption } from '../../../../web/src/components/ui/combobox.js';

const step: StandardStep = { kind: 'label-mapping', id: 'labels' };

const labelSlots = [
	{ key: 'processing', label: 'Processing' },
	{ key: 'error', label: 'Error' },
];

const providerLabels = [
	{ id: 'lbl-processing', name: 'cascade-processing', color: '#2563EB' },
	{ id: 'lbl-error', name: 'cascade-error', color: '#DC2626' },
];

/**
 * Walk the element tree and collect every `[data-slot=<slotKey>]` row
 * along with the Combobox it contains (if any). Used by the enum-mode
 * tests because SSR-through-Combobox is out.
 */
function collectSlotRows(
	element: ReactElement,
): Array<{ slotKey: string; row: ReactElement; combobox: ReactElement | null }> {
	const rows: Array<{ slotKey: string; row: ReactElement; combobox: ReactElement | null }> = [];
	function visit(node: unknown) {
		if (!isValidElement(node)) return;
		const props = node.props as Record<string, unknown>;
		const slotKey = props['data-slot'];
		if (typeof slotKey === 'string') {
			rows.push({ slotKey, row: node, combobox: findComboboxDescendant(node) });
		}
		const children = props.children;
		if (Array.isArray(children)) {
			for (const child of children) visit(child);
		} else {
			visit(children);
		}
	}
	visit(element);
	return rows;
}

function findComboboxDescendant(element: ReactElement): ReactElement | null {
	if (!isValidElement(element)) return null;
	if (element.type === Combobox) return element;
	const children = (element.props as { children?: unknown }).children;
	if (Array.isArray(children)) {
		for (const child of children) {
			const found = isValidElement(child) ? findComboboxDescendant(child) : null;
			if (found) return found;
		}
	} else if (isValidElement(children)) {
		return findComboboxDescendant(children);
	}
	return null;
}

/** Find the bulk-create banner div via `data-bulk-create-banner`. */
function findBulkBanner(element: ReactElement): ReactElement | null {
	if (!isValidElement(element)) return null;
	const props = element.props as Record<string, unknown>;
	if (props['data-bulk-create-banner'] === 'true') return element;
	const children = props.children;
	if (Array.isArray(children)) {
		for (const child of children) {
			const found = isValidElement(child) ? findBulkBanner(child) : null;
			if (found) return found;
		}
	} else if (isValidElement(children)) {
		return findBulkBanner(children);
	}
	return null;
}

describe('LabelMappingStep — enum mode', () => {
	it('renders one Combobox per slot with labels mapped to ComboboxOption[] including color swatch', () => {
		const tree = LabelMappingStep({
			step,
			providerId: 'linear',
			labelSlots,
			providerLabels,
			mappings: {},
			onMappingChange: () => {},
		});
		const rows = collectSlotRows(tree);
		expect(rows.map((r) => r.slotKey)).toEqual(['processing', 'error']);
		for (const { combobox } of rows) {
			expect(combobox).not.toBeNull();
			const options = (combobox?.props as { options: ComboboxOption[] }).options;
			expect(options).toEqual([
				{ value: 'lbl-processing', label: 'cascade-processing', swatch: '#2563EB' },
				{ value: 'lbl-error', label: 'cascade-error', swatch: '#DC2626' },
			]);
		}
	});

	it('marks the root as data-mode="enum" when providerLabels is non-empty', () => {
		const tree = LabelMappingStep({
			step,
			providerId: 'linear',
			labelSlots,
			providerLabels,
			mappings: {},
			onMappingChange: () => {},
		});
		expect((tree.props as Record<string, unknown>)['data-mode']).toBe('enum');
	});

	it('collapses the per-row Create input once a slot is mapped', () => {
		const tree = LabelMappingStep({
			step,
			providerId: 'linear',
			labelSlots,
			providerLabels,
			mappings: { processing: 'lbl-processing' },
			onMappingChange: () => {},
			onCreateLabel: () => {},
		});
		const rows = collectSlotRows(tree);
		const processing = rows.find((r) => r.slotKey === 'processing');
		const error = rows.find((r) => r.slotKey === 'error');
		expect(processing).toBeDefined();
		expect(error).toBeDefined();
		const processingProps = processing?.row.props as Record<string, unknown>;
		const errorProps = error?.row.props as Record<string, unknown>;
		expect(processingProps['data-mapped']).toBe('true');
		expect(processingProps['data-has-create-form']).toBe('false');
		expect(errorProps['data-mapped']).toBe('false');
		expect(errorProps['data-has-create-form']).toBe('true');
	});

	it('hides the per-row Create button entirely when onCreateLabel is not supplied', () => {
		const tree = LabelMappingStep({
			step,
			providerId: 'linear',
			labelSlots,
			providerLabels,
			mappings: {},
			onMappingChange: () => {},
		});
		const rows = collectSlotRows(tree);
		for (const { row } of rows) {
			expect((row.props as Record<string, unknown>)['data-has-create-form']).toBe('false');
		}
	});
});

describe('LabelMappingStep — bulk-create banner', () => {
	it('renders when onCreateMissingLabels is supplied and ≥1 slot is unmapped with a default', () => {
		const tree = LabelMappingStep({
			step,
			providerId: 'linear',
			labelSlots,
			providerLabels,
			mappings: {},
			onMappingChange: () => {},
			onCreateLabel: () => {},
			onCreateMissingLabels: () => {},
			labelDefaults: {
				processing: { name: 'cascade-processing', color: '#2563EB' },
				error: { name: 'cascade-error', color: '#DC2626' },
			},
		});
		const banner = findBulkBanner(tree);
		expect(banner).not.toBeNull();
		expect((banner?.props as Record<string, unknown>)['data-missing-count']).toBe('2');
	});

	it('hides when every slot with a default is already mapped', () => {
		const tree = LabelMappingStep({
			step,
			providerId: 'linear',
			labelSlots,
			providerLabels,
			mappings: { processing: 'lbl-processing', error: 'lbl-error' },
			onMappingChange: () => {},
			onCreateLabel: () => {},
			onCreateMissingLabels: () => {},
			labelDefaults: {
				processing: { name: 'cascade-processing', color: '#2563EB' },
				error: { name: 'cascade-error', color: '#DC2626' },
			},
		});
		expect(findBulkBanner(tree)).toBeNull();
	});

	it('hides when onCreateMissingLabels is omitted (even if defaults + unmapped slots)', () => {
		const tree = LabelMappingStep({
			step,
			providerId: 'linear',
			labelSlots,
			providerLabels,
			mappings: {},
			onMappingChange: () => {},
			onCreateLabel: () => {},
			labelDefaults: {
				processing: { name: 'cascade-processing', color: '#2563EB' },
				error: { name: 'cascade-error', color: '#DC2626' },
			},
		});
		expect(findBulkBanner(tree)).toBeNull();
	});

	it('hides when labelDefaults is omitted', () => {
		const tree = LabelMappingStep({
			step,
			providerId: 'linear',
			labelSlots,
			providerLabels,
			mappings: {},
			onMappingChange: () => {},
			onCreateLabel: () => {},
			onCreateMissingLabels: () => {},
		});
		expect(findBulkBanner(tree)).toBeNull();
	});
});

// ── Free-text mode (JIRA) — unchanged plain-HTML shape, SSR-testable ──

describe('LabelMappingStep — free-text mode', () => {
	it('renders text inputs when providerLabels is empty', () => {
		const html = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'jira',
				labelSlots,
				providerLabels: [],
				mappings: { processing: 'cascade-processing' },
				onMappingChange: () => {},
			}),
		);
		expect(html).toContain('data-mode="free-text"');
		expect(html).toContain('placeholder="Label name"');
		expect(html).toMatch(/id="label-processing"[^>]*value="cascade-processing"/);
	});

	it('renders loading and error states', () => {
		const loading = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'trello',
				labelSlots,
				providerLabels: [],
				mappings: {},
				onMappingChange: () => {},
				loading: true,
			}),
		);
		expect(loading).toContain('data-state="loading"');

		const error = renderToStaticMarkup(
			createElement(LabelMappingStep, {
				step,
				providerId: 'trello',
				labelSlots,
				providerLabels: [],
				mappings: {},
				onMappingChange: () => {},
				error: 'failed',
			}),
		);
		expect(error).toContain('data-state="error"');
	});
});
