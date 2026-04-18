/**
 * Shared label-mapping step component.
 *
 * Two modes:
 * - **Enum mode** (Trello, Linear — when `providerLabels.length > 0`):
 *   renders a searchable `Combobox` per CASCADE slot with color swatches
 *   next to each label. A bulk-create banner at the top fires
 *   `onCreateMissingLabels` for every slot that has a `labelDefaults`
 *   entry but no existing mapping — one click covers the common
 *   fresh-setup case. When a slot is already mapped, only the picker
 *   renders; the per-row create input collapses to de-clutter the step.
 * - **Free-text mode** (JIRA — when `providerLabels` is empty): renders
 *   plain `Input` fields per slot. Unchanged from earlier shape.
 *
 * SSR note: enum mode uses the shared `Combobox` (radix Popover + cmdk).
 * `renderToStaticMarkup` tests can't traverse through that — new tests
 * use the React-element-tree pattern established by
 * `tests/unit/web/steps/container-pick.test.ts`.
 */

import { createElement, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button.js';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import type { DataProps } from '@/lib/data-props.js';
import type { StandardStep } from '../../../../../../src/integrations/pm/manifest.js';

export interface ProviderLabel {
	readonly id: string;
	readonly name: string;
	readonly color?: string;
}

export interface LabelMappingStepProps {
	readonly step: StandardStep;
	readonly providerId: string;
	readonly labelSlots: ReadonlyArray<{ readonly key: string; readonly label: string }>;
	readonly providerLabels: ReadonlyArray<ProviderLabel>;
	readonly mappings: Readonly<Record<string, string>>;
	readonly onMappingChange: (slotKey: string, labelValue: string) => void;
	readonly onCreateLabel?: (slotKey: string, name: string, color?: string) => void;
	/**
	 * Fires bulk creation of every slot that has a `labelDefaults` entry
	 * but no existing mapping. Omitting the prop hides the bulk banner.
	 * Called with the subset of slots that need creating; the provider's
	 * hook translates each into a `pm.discovery.createLabel` call.
	 */
	readonly onCreateMissingLabels?: (
		slots: ReadonlyArray<{ slot: string; name: string; color?: string }>,
	) => void;
	readonly loading?: boolean;
	readonly error?: string;
	/** True while an `onCreateMissingLabels` call is in flight. */
	readonly creatingMissing?: boolean;
	/**
	 * Canonical per-slot default names + colors (e.g. Linear:
	 * `cascade-ready` @ `#0284C7`). Drives three affordances:
	 *  - Pre-fills the per-row Create input with the default name.
	 *  - Passes `color` through to `onCreateLabel(slot, name, color)`.
	 *  - Enables the bulk-create banner for slots that have a default
	 *    but no mapping yet.
	 * Omitting the prop keeps the "user types everything" UX unchanged.
	 */
	readonly labelDefaults?: Readonly<
		Record<string, { readonly name: string; readonly color?: string }>
	>;
}

export function LabelMappingStep({
	step,
	providerId,
	labelSlots,
	providerLabels,
	mappings,
	onMappingChange,
	onCreateLabel,
	onCreateMissingLabels,
	loading,
	error,
	creatingMissing,
	labelDefaults,
}: LabelMappingStepProps) {
	const useFreeText = providerLabels.length === 0;

	const rootProps = {
		'data-step-component': 'label-mapping',
		'data-provider-id': providerId,
		'data-step-id': step.id,
		'data-mode': useFreeText ? 'free-text' : 'enum',
		className: 'space-y-3',
	};

	if (loading) {
		return createElement(
			'div',
			rootProps,
			createElement(
				'p',
				{ 'data-state': 'loading', className: 'text-sm text-muted-foreground' },
				'Loading labels…',
			),
		);
	}
	if (error) {
		return createElement(
			'div',
			rootProps,
			createElement(
				'p',
				{ 'data-state': 'error', className: 'text-sm text-destructive' },
				`Error: ${error}`,
			),
		);
	}

	// Slots that have a labelDefaults entry and no current mapping — the
	// bulk-create banner acts on exactly these.
	const missingSlots = labelDefaults
		? labelSlots
				.filter((slot) => !mappings[slot.key] && labelDefaults[slot.key])
				.map((slot) => ({
					slot: slot.key,
					name: labelDefaults[slot.key].name,
					color: labelDefaults[slot.key].color,
				}))
		: [];
	const showBulkBanner =
		!useFreeText && !!onCreateMissingLabels && !!onCreateLabel && missingSlots.length >= 1;

	const comboboxOptions: ComboboxOption[] = providerLabels.map((label) => ({
		value: label.id,
		label: label.name,
		swatch: label.color,
	}));

	return createElement(
		'div',
		rootProps,
		showBulkBanner
			? renderBulkBanner(missingSlots, onCreateMissingLabels, !!creatingMissing)
			: null,
		createElement(
			'div',
			{ className: 'space-y-2' },
			...labelSlots.map((slot) => {
				const currentValue = mappings[slot.key] ?? '';
				const fieldId = `label-${slot.key}`;

				if (useFreeText) {
					return createElement(
						'div',
						{
							key: slot.key,
							className: 'flex items-center gap-3',
							'data-slot': slot.key,
						},
						createElement(
							Label,
							{
								htmlFor: fieldId,
								className: 'w-32 shrink-0 text-xs text-muted-foreground',
							},
							slot.label,
						),
						createElement(Input, {
							id: fieldId,
							type: 'text',
							value: currentValue,
							onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
								onMappingChange(slot.key, e.target.value),
							placeholder: 'Label name',
							className: 'flex-1',
						}),
					);
				}

				const isMapped = !!currentValue && providerLabels.some((l) => l.id === currentValue);
				const labelDefault = labelDefaults?.[slot.key];
				const showCreateForm = !!onCreateLabel && !isMapped;
				return createElement(
					'div',
					{
						key: slot.key,
						className: 'space-y-2',
						'data-slot': slot.key,
						'data-mapped': isMapped ? 'true' : 'false',
						'data-has-create-form': showCreateForm ? 'true' : 'false',
					} as React.ComponentProps<'div'> & DataProps,
					createElement(
						'div',
						{ className: 'flex items-center gap-3' },
						createElement(
							Label,
							{
								htmlFor: fieldId,
								className: 'w-32 shrink-0 text-xs text-muted-foreground',
							},
							slot.label,
						),
						createElement(
							'div',
							{ className: 'flex-1' },
							createElement(Combobox, {
								id: fieldId,
								value: currentValue,
								onChange: (value: string) => onMappingChange(slot.key, value),
								options: comboboxOptions,
								emptyLabel: '— Select —',
								placeholder: 'Search labels…',
							}),
						),
					),
					// Per-row Create form: shown only when the slot is NOT yet
					// mapped and the provider supports label creation. Collapsed
					// once mapped so the step stays visually clean. The form owns
					// its own input state so the parent step is a pure function
					// (testable via direct call + element-tree traversal).
					showCreateForm && onCreateLabel
						? createElement(CreateLabelForm, {
								slotKey: slot.key,
								defaultName: labelDefault?.name,
								defaultColor: labelDefault?.color,
								onCreate: onCreateLabel,
							})
						: null,
				) as ReactNode;
			}),
		),
	);
}

// ────────────────────────────────────────────────────────────────────────
// Helper components — broken out so the main function stays small and so
// the render output is easier to reason about in React DevTools.
// ────────────────────────────────────────────────────────────────────────

/**
 * Bulk-create banner: stateless, inlined as a helper (not a component)
 * so its `data-*` attributes live directly in `LabelMappingStep`'s
 * returned tree. Tests traverse the element tree without a renderer
 * and need to see the banner without drilling into a nested component.
 */
function renderBulkBanner(
	missingSlots: ReadonlyArray<{ slot: string; name: string; color?: string }>,
	onCreate:
		| ((slots: ReadonlyArray<{ slot: string; name: string; color?: string }>) => void)
		| undefined,
	busy: boolean,
): ReactNode {
	const count = missingSlots.length;
	return createElement(
		'div',
		{
			'data-bulk-create-banner': 'true',
			'data-missing-count': String(count),
			className:
				'flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2',
		} as React.ComponentProps<'div'> & DataProps,
		createElement(
			'div',
			{ className: 'flex-1 text-sm' },
			createElement(
				'p',
				{ className: 'font-medium' },
				`Create ${count} missing CASCADE ${count === 1 ? 'label' : 'labels'} with defaults`,
			),
			createElement(
				'p',
				{ className: 'mt-0.5 text-xs text-muted-foreground' },
				missingSlots.map((s) => s.name).join(' · '),
			),
		),
		createElement(
			Button,
			{
				type: 'button',
				variant: 'default',
				size: 'sm',
				'data-action': 'create-missing-labels',
				disabled: busy,
				onClick: () => onCreate?.(missingSlots),
			} as React.ComponentProps<typeof Button> & DataProps,
			busy ? 'Creating…' : 'Create all',
		),
	);
}

interface CreateLabelFormProps {
	readonly slotKey: string;
	readonly defaultName?: string;
	readonly defaultColor?: string;
	readonly onCreate: (slotKey: string, name: string, color?: string) => void;
}

/**
 * Per-slot inline "Create label" form. Owns its input state so the
 * parent `LabelMappingStep` function stays pure — tests call the step
 * directly and traverse the returned tree without a React renderer.
 */
function CreateLabelForm({ slotKey, defaultName, defaultColor, onCreate }: CreateLabelFormProps) {
	const [newLabelName, setNewLabelName] = useState(defaultName ?? '');
	return createElement(
		'div',
		{ className: 'flex items-center gap-2 pl-32' },
		createElement(Input, {
			type: 'text',
			placeholder: 'New label name',
			value: newLabelName,
			onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewLabelName(e.target.value),
			className: 'h-8 text-xs flex-1',
		}),
		createElement(
			Button,
			{
				type: 'button',
				variant: 'outline',
				size: 'sm',
				onClick: () => {
					if (newLabelName) {
						onCreate(slotKey, newLabelName, defaultColor);
						setNewLabelName('');
					}
				},
				'data-action': 'create-label',
				'data-create-color': defaultColor,
			} as React.ComponentProps<typeof Button> & DataProps,
			'Create',
		),
	);
}
