/**
 * Mask a credential value for list previews: short values collapse to '****',
 * longer ones keep the last 4 characters ('****abcd'). Shared by the project
 * and organization credential list endpoints so the masking rule cannot drift.
 */
export function maskCredentialValue(value: string): string {
	return value.length <= 12 ? '****' : `****${value.slice(-4)}`;
}
