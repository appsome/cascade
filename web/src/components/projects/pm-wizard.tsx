import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Globe, Loader2, XCircle } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Label } from '@/components/ui/label.js';
import { trpc } from '@/lib/trpc.js';
// Side-effect imports register Trello (006/2) + JIRA (006/3) frontend
// wizards into the provider registry. Plan 006/4 will append linear.
import './pm-providers/trello/index.js';
import './pm-providers/jira/index.js';
import { ManifestProviderWizardSection } from './pm-providers/manifest-section.js';
import { getProviderWizard } from './pm-providers/registry.js';
import { renderManifestStep } from './pm-providers/render.js';
import { SaveStep, WebhookStep } from './pm-wizard-common-steps.js';
import {
	useLinearDiscovery,
	useLinearLabelCreation,
	useLinearWebhookInfo,
	useSaveMutation,
	useVerification,
	useWebhookManagement,
} from './pm-wizard-hooks.js';
// JIRA legacy step imports removed — all JIRA wizard rendering flows
// through the manifest path (see ./pm-providers/jira/). The
// `pm-wizard-jira-steps` module is still imported transitively by the
// adapters in `./pm-providers/jira/adapters.tsx`.
import {
	LINEAR_LABEL_DEFAULTS,
	LinearCredentialsStep,
	LinearFieldMappingStep,
	LinearTeamStep,
} from './pm-wizard-linear-steps.js';
import {
	areCredentialsReady,
	buildEditState,
	createInitialState,
	deriveActiveWebhooks,
	isStep1Complete,
	isStep2Complete,
	isStep3Complete,
	isStep4Complete,
	wizardReducer,
} from './pm-wizard-state.js';
// Trello legacy step imports removed — all Trello wizard rendering flows
// through the manifest path (see ./pm-providers/trello/). The
// `pm-wizard-trello-steps` module is still imported transitively by the
// adapters in `./pm-providers/trello/adapters.tsx`, so its behavior is
// unchanged — only the per-provider branching in this file is gone.
import { WizardStep } from './wizard-shared.js';

// ============================================================================
// Constants
// ============================================================================

const STEP_TITLES = [
	'Provider',
	'Credentials & Verification',
	'Board / Project Selection',
	'Field Mapping',
	'Webhooks',
	'Save',
] as const;

const PROVIDER_LABELS: Record<'trello' | 'jira' | 'linear', string> = {
	trello: 'Trello',
	jira: 'JIRA',
	linear: 'Linear',
};

function confirmProviderSwitch(
	from: 'trello' | 'jira' | 'linear',
	to: 'trello' | 'jira' | 'linear',
): boolean {
	return window.confirm(
		`Switch PM provider from ${PROVIDER_LABELS[from]} to ${PROVIDER_LABELS[to]}?\n\nYou'll need to re-enter credentials and re-map fields for ${PROVIDER_LABELS[to]}. The old provider's credentials will be deleted when you save.`,
	);
}

// ============================================================================
// Main PMWizard Component
// ============================================================================

export function PMWizard({
	projectId,
	initialProvider,
	initialConfig,
}: {
	projectId: string;
	initialProvider: string;
	initialConfig?: Record<string, unknown>;
}) {
	const webhooksQuery = useQuery(trpc.webhooks.list.queryOptions({ projectId }));
	const credentialsQuery = useQuery(trpc.projects.credentials.list.queryOptions({ projectId }));

	const [state, dispatch] = useReducer(wizardReducer, undefined, createInitialState);
	const [openSteps, setOpenSteps] = useState<Set<number>>(new Set([1]));
	const [creatingSlot, setCreatingSlot] = useState<string | null>(null);
	// Trello's creatingCostField was migrated into the provider wizard's own
	// useProviderHooks; the parent no longer owns it.
	// JIRA's creatingJiraCostField migrated into the provider wizard's
	// useProviderHooks (plan 006/3).

	// ---- Step navigation helpers ----

	const toggleStep = (step: number) => {
		setOpenSteps((prev) => {
			const next = new Set(prev);
			if (next.has(step)) {
				next.delete(step);
			} else {
				next.add(step);
			}
			return next;
		});
	};

	const advanceToStep = (step: number) => {
		setOpenSteps((prev) => {
			const next = new Set(prev);
			next.add(step);
			return next;
		});
	};

	// ---- Initialize from existing integration ----

	const initializedRef = useRef(false);
	useEffect(() => {
		if (!initialConfig || !initialProvider || !credentialsQuery.data) return;
		if (initializedRef.current) return;
		initializedRef.current = true;
		const configuredKeys = new Set(credentialsQuery.data.map((c) => c.envVarKey));
		const editState = buildEditState(initialProvider, initialConfig, configuredKeys);
		dispatch({ type: 'INIT_EDIT', state: editState });
		setOpenSteps(new Set([1, 2, 3, 4, 5, 6]));
	}, [initialConfig, initialProvider, credentialsQuery.data]);

	// ---- Custom hooks ----

	// Is there a manifest-registered wizard for the active provider? If so,
	// ManifestProviderWizardSection drives the rendering (and runs the
	// provider's useProviderHooks internally). Unregistered providers fall
	// through to the legacy per-provider branches.
	const manifestDef = getProviderWizard(state.provider);

	const { verifyMutation } = useVerification(state, dispatch, advanceToStep);
	// Trello (006/2) and JIRA (006/3) discovery / label / custom-field hooks
	// are composed inside each provider's useProviderHooks. Linear migrates
	// in plan 006/4.
	const { linearTeamsMutation, linearDetailsMutation, linearProjectsMutation, handleTeamSelect } =
		useLinearDiscovery(state, dispatch, advanceToStep, projectId);
	const {
		createLabelMutation: createLinearLabelMutation,
		createMissingLabelsMutation: createMissingLinearLabelsMutation,
	} = useLinearLabelCreation(state, dispatch);
	const webhookManagement = useWebhookManagement(projectId, state);
	const { webhookUrl: linearWebhookUrl } = useLinearWebhookInfo();
	const { saveMutation } = useSaveMutation(projectId, state);

	const linearWebhookSecretCredential = credentialsQuery.data?.find(
		(c) => c.envVarKey === 'LINEAR_WEBHOOK_SECRET',
	);

	// ---- Label creation handlers ----
	// Trello (006/2) and JIRA (006/3) handlers migrated into their provider
	// wizards' useProviderHooks. Linear follows in 006/4.

	const handleCreateLinearLabel = (slot: string) => {
		const defaults = LINEAR_LABEL_DEFAULTS[slot];
		if (!defaults) return;
		setCreatingSlot(slot);
		createLinearLabelMutation.mutate(
			{ name: defaults.name, color: defaults.color, slot },
			{ onSettled: () => setCreatingSlot(null) },
		);
	};

	const handleCreateAllMissingLinearLabels = () => {
		const existingLabelNames = new Set(
			(state.linearTeamDetails?.labels ?? []).map((l) => l.name.toLowerCase()),
		);
		const labelsToCreate = Object.entries(LINEAR_LABEL_DEFAULTS)
			.filter(([slot, { name }]) => {
				if (state.linearLabels[slot]) return false;
				return !existingLabelNames.has(name.toLowerCase());
			})
			.map(([slot, { name, color }]) => ({ slot, name, color }));
		if (labelsToCreate.length > 0) {
			setCreatingSlot('__batch__');
			createMissingLinearLabelsMutation.mutate(labelsToCreate, {
				onSettled: () => setCreatingSlot(null),
			});
		}
	};

	// ---- Step status ----

	const credsReady = areCredentialsReady(state);

	function getStatus(
		stepNum: number,
		complete: boolean,
	): 'pending' | 'complete' | 'error' | 'active' {
		if (complete) return 'complete';
		if (openSteps.has(stepNum)) return 'active';
		return 'pending';
	}

	// ---- Active webhooks for this provider ----
	const activeWebhooks = deriveActiveWebhooks(state.provider, webhooksQuery.data);

	// ---- Render ----

	return (
		<div className="space-y-3">
			{/* Step 1: Provider */}
			<WizardStep
				stepNumber={1}
				title={STEP_TITLES[0]}
				status={getStatus(1, isStep1Complete(state))}
				isOpen={openSteps.has(1)}
				onToggle={() => toggleStep(1)}
			>
				<div className="space-y-2">
					<Label>Provider</Label>
					<div className="flex gap-2">
						{(['trello', 'jira', 'linear'] as const).map((p) => (
							<button
								key={p}
								type="button"
								onClick={() => {
									if (p === state.provider) return;
									if (state.isEditing && !confirmProviderSwitch(state.provider, p)) return;
									dispatch({ type: 'SET_PROVIDER', provider: p });
									advanceToStep(2);
								}}
								className={`flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors ${
									state.provider === p
										? 'border-primary bg-primary/5 text-foreground'
										: 'border-input text-muted-foreground hover:text-foreground hover:bg-accent/50'
								}`}
							>
								{PROVIDER_LABELS[p]}
							</button>
						))}
					</div>
				</div>
			</WizardStep>

			{/* Step 2: Credentials & Verification */}
			<WizardStep
				stepNumber={2}
				title={STEP_TITLES[1]}
				status={getStatus(2, isStep2Complete(state))}
				isOpen={openSteps.has(2)}
				onToggle={() => toggleStep(2)}
			>
				{manifestDef ? (
					<ManifestProviderWizardSection
						def={manifestDef}
						state={state}
						dispatch={dispatch}
						projectId={projectId}
						advanceToStep={advanceToStep}
						stepIndex={0}
					/>
				) : (
					<LinearCredentialsStep state={state} dispatch={dispatch} />
				)}

				<div className="flex items-center gap-3 pt-2">
					{(!state.isEditing || !state.hasStoredCredentials || credsReady) && (
						<button
							type="button"
							onClick={() => verifyMutation.mutate()}
							disabled={!credsReady || verifyMutation.isPending}
							className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{verifyMutation.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Globe className="h-4 w-4" />
							)}
							Verify Connection
						</button>
					)}
					{state.verificationResult && (
						<div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
							<CheckCircle className="h-4 w-4" />
							Connected as <span className="font-medium">{state.verificationResult.display}</span>
						</div>
					)}
					{state.verifyError && (
						<div className="flex items-center gap-1.5 text-sm text-destructive">
							<XCircle className="h-4 w-4" />
							{state.verifyError}
						</div>
					)}
				</div>
			</WizardStep>

			{/* Step 3: Board / Project Selection */}
			<WizardStep
				stepNumber={3}
				title={STEP_TITLES[2]}
				status={getStatus(3, isStep3Complete(state))}
				isOpen={openSteps.has(3)}
				onToggle={() => toggleStep(3)}
			>
				{manifestDef ? (
					<ManifestProviderWizardSection
						def={manifestDef}
						state={state}
						dispatch={dispatch}
						projectId={projectId}
						advanceToStep={advanceToStep}
						stepIndex={1}
					/>
				) : (
					<LinearTeamStep
						state={state}
						onTeamSelect={handleTeamSelect}
						dispatch={dispatch}
						linearTeamsMutation={linearTeamsMutation}
						linearDetailsMutation={linearDetailsMutation}
						linearProjectsMutation={linearProjectsMutation}
					/>
				)}
			</WizardStep>

			{/* Step 4: Field Mapping */}
			<WizardStep
				stepNumber={4}
				title={STEP_TITLES[3]}
				status={getStatus(4, isStep4Complete(state))}
				isOpen={openSteps.has(4)}
				onToggle={() => toggleStep(4)}
			>
				{manifestDef ? (
					<ManifestProviderWizardSection
						def={manifestDef}
						state={state}
						dispatch={dispatch}
						projectId={projectId}
						advanceToStep={advanceToStep}
						stepIndex={2}
					/>
				) : (
					<LinearFieldMappingStep
						state={state}
						dispatch={dispatch}
						onCreateLabel={handleCreateLinearLabel}
						onCreateAllMissingLabels={handleCreateAllMissingLinearLabels}
						creatingSlot={creatingSlot}
					/>
				)}
			</WizardStep>

			{/* Step 5: Webhooks */}
			<WizardStep
				stepNumber={5}
				title={STEP_TITLES[4]}
				status={getStatus(5, true)}
				isOpen={openSteps.has(5)}
				onToggle={() => toggleStep(5)}
			>
				<WebhookStep
					state={state}
					webhooksQuery={webhooksQuery}
					activeWebhooks={activeWebhooks}
					linearWebhookUrl={linearWebhookUrl}
					projectId={projectId}
					linearWebhookSecretCredential={linearWebhookSecretCredential}
					{...webhookManagement}
				/>
			</WizardStep>

			{/* Step 6: Save */}
			<WizardStep
				stepNumber={6}
				title={STEP_TITLES[5]}
				status={getStatus(6, saveMutation.isSuccess)}
				isOpen={openSteps.has(6)}
				onToggle={() => toggleStep(6)}
			>
				<SaveStep state={state} saveMutation={saveMutation} />
			</WizardStep>
		</div>
	);
}
