/**
 * Shared color mapping for agent types used in recharts visualizations.
 *
 * Recharts requires actual color values (not CSS variables), so we use a
 * static hex palette. These colors are approximations of the light-mode
 * `oklch` chart colors from index.css. They remain visible in dark mode but
 * do not match the theme's intended dark-mode chart color scheme (which uses
 * a completely different set of oklch values).
 */

// Hex approximations of the light-mode oklch chart colors from index.css:
// chart-1: oklch(0.646 0.222 41.116) ≈ #e8642a (orange)
// chart-2: oklch(0.6 0.118 184.704)  ≈ #3aada0 (teal)
// chart-3: oklch(0.398 0.07 227.392) ≈ #4a7a9b (steel blue)
// chart-4: oklch(0.828 0.189 84.429) ≈ #d4c02a (yellow)
// chart-5: oklch(0.769 0.188 70.08)  ≈ #d99c27 (amber)

// Light-mode palette
const CHART_PALETTE = [
	'#e8642a', // chart-1: orange → planning
	'#3aada0', // chart-2: teal → implementation
	'#4a7a9b', // chart-3: steel blue → review
	'#d4c02a', // chart-4: yellow → splitting
	'#d99c27', // chart-5: amber → debug
	'#9b59b6', // purple → respond-to-review
	'#e74c3c', // red → respond-to-ci
	'#2ecc71', // green → other agents
];

// Dark-mode palette — brighter/lighter variants for visibility on dark backgrounds.
// Hex approximations of the dark-mode oklch chart colors from index.css:
// chart-1: oklch(0.488 0.243 264.376) ≈ #4d6ef5 (blue-violet)
// chart-2: oklch(0.696 0.17 162.48)   ≈ #38c98a (green)
// chart-3: oklch(0.769 0.188 70.08)   ≈ #e8a838 (amber)
// chart-4: oklch(0.627 0.265 303.9)   ≈ #c46cf0 (violet)
// chart-5: oklch(0.645 0.246 16.439)  ≈ #f0614d (red-orange)
const CHART_PALETTE_DARK = [
	'#f0844d', // orange (brighter) → planning
	'#4dd6c8', // teal (brighter) → implementation
	'#6fa8d0', // steel blue (brighter) → review
	'#f0d44d', // yellow (brighter) → splitting
	'#f0b84d', // amber (brighter) → debug
	'#c084f5', // purple (brighter) → respond-to-review
	'#f57070', // red (brighter) → respond-to-ci
	'#4ade80', // green (brighter) → other agents
];

const KNOWN_AGENT_TYPES: Record<string, number> = {
	planning: 0,
	implementation: 1,
	review: 2,
	splitting: 3,
	debug: 4,
	'respond-to-review': 5,
	'respond-to-ci': 6,
	'respond-to-pr-comment': 6,
	'respond-to-planning-comment': 6,
};

/**
 * Returns a color string for the given agent type.
 * Falls back to a consistent color based on the string hash for unknown types.
 *
 * @param agentType - The agent type identifier
 * @param dark - When true, returns a brighter color suitable for dark backgrounds
 */
export function getAgentColor(agentType: string, dark = false): string {
	const palette = dark ? CHART_PALETTE_DARK : CHART_PALETTE;
	const idx = KNOWN_AGENT_TYPES[agentType];
	if (idx !== undefined) {
		return palette[idx];
	}
	// Hash-based fallback for unknown agent types
	let hash = 0;
	for (let i = 0; i < agentType.length; i++) {
		hash = (hash * 31 + agentType.charCodeAt(i)) % palette.length;
	}
	return palette[Math.abs(hash) % palette.length];
}

/**
 * Human-readable label for an agent type.
 * e.g. "respond-to-review" → "Respond to Review"
 */
export function agentTypeLabel(agentType: string): string {
	return agentType
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}
