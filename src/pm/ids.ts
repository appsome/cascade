/**
 * Branded ID types for PM providers.
 *
 * Bare strings can pass anywhere: a state name where a state UUID is
 * required, a display label where a label-ID is required, etc. Linear's
 * integration shipped three production bugs from this confusion in a
 * single week (#1117, #1137, #1139). Branded types make each of those
 * mistakes a compile error.
 *
 * Usage:
 *
 *   // At the boundary (wizard, HTTP input, DB row), parse once:
 *   const stateId = parseStateId(row.state_id);
 *
 *   // Internally, everything accepts only branded IDs:
 *   adapter.moveWorkItem(id, stateId);  // compiles
 *   adapter.moveWorkItem(id, 'Done');   // compile error
 *
 *   // At the outbound boundary (DB write, HTTP body, log line), unwrap:
 *   db.update({ stateId: unwrap(stateId) });
 */

/**
 * Stable PM workflow-state identifier (e.g. Linear state UUID,
 * JIRA transition target ID).
 */
export type StateId = string & { readonly __brand: 'StateId' };

/**
 * Stable PM label identifier (Trello label ID, Linear label UUID,
 * JIRA label — for labels, JIRA uses the label name as the ID).
 */
export type LabelId = string & { readonly __brand: 'LabelId' };

/**
 * Stable PM container identifier. A "container" is the provider-native
 * collection of work items: a Trello list ID, a JIRA project key, a
 * Linear team UUID.
 */
export type ContainerId = string & { readonly __brand: 'ContainerId' };

/** Thrown by the `parse*Id` factories when the input is empty or whitespace. */
export class InvalidIdError extends Error {
	readonly kind: string;
	readonly attempted: string;

	constructor(kind: string, attempted: string) {
		super(`Invalid ${kind}: '${attempted}' — expected a non-empty, non-whitespace string`);
		this.name = 'InvalidIdError';
		this.kind = kind;
		this.attempted = attempted;
	}
}

function requireNonEmpty(raw: string, kind: string): string {
	if (typeof raw !== 'string' || raw.trim().length === 0) {
		throw new InvalidIdError(kind, raw);
	}
	return raw;
}

/** Parse and brand a state ID. Throws `InvalidIdError` on empty/whitespace input. */
export function parseStateId(raw: string): StateId {
	return requireNonEmpty(raw, 'StateId') as StateId;
}

/** Parse and brand a label ID. Throws `InvalidIdError` on empty/whitespace input. */
export function parseLabelId(raw: string): LabelId {
	return requireNonEmpty(raw, 'LabelId') as LabelId;
}

/** Parse and brand a container ID. Throws `InvalidIdError` on empty/whitespace input. */
export function parseContainerId(raw: string): ContainerId {
	return requireNonEmpty(raw, 'ContainerId') as ContainerId;
}

/**
 * Strip the brand for boundary crossings (DB writes, HTTP bodies, log lines).
 * Accepts any branded string type (or a plain string) and returns a plain string.
 *
 * This helper exists so the call site reads as a deliberate "I am leaving the
 * typed world" rather than an opaque cast.
 */
export function unwrap<T extends string>(id: T): string {
	return id;
}
