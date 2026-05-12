import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedChecklistItem {
	id: string;
	name: string;
	complete: boolean;
}

export interface ParsedChecklist {
	name: string;
	items: ParsedChecklistItem[];
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export function hashChecklistItemId(checklistName: string, itemText: string): string {
	const hash = createHash('sha256').update(`${checklistName}\0${itemText}`).digest('hex');
	return `cl-${hash.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const H3_REGEX = /^### (.+)$/;
const HEADING_REGEX = /^#{1,6}\s+/;
const CHECKBOX_REGEX = /^- \[([ x])\] (.+)$/;

export function parseInlineChecklists(description: string): ParsedChecklist[] {
	if (!description) return [];

	const state: ParseState = { checklists: [], current: null };
	for (const line of description.split('\n')) {
		applyLineToParseState(state, classifyLine(line, state.current));
	}
	flushCurrent(state);
	return state.checklists;
}

export function checklistSectionContainsItems(
	description: string,
	checklistName: string,
	items: { name: string; checked?: boolean }[],
): boolean {
	const deduped = dedupeChecklistSections(description, checklistName);
	const section = findChecklistSection(deduped.split('\n'), checklistName);
	if (!section) return false;
	const sectionItems = collectSectionItems(deduped.split('\n'), section);
	return items.every((item) => {
		const actual = sectionItems.get(item.name);
		if (actual === undefined) return false;
		return item.checked === undefined || actual === item.checked || actual === true;
	});
}

export function checklistItemStateSatisfied(
	description: string,
	checklistName: string,
	itemName: string,
	checked: boolean,
): boolean {
	const deduped = dedupeChecklistSections(description, checklistName);
	const section = findChecklistSection(deduped.split('\n'), checklistName);
	if (!section) return false;
	return collectSectionItems(deduped.split('\n'), section).get(itemName) === checked;
}

interface ParseState {
	checklists: ParsedChecklist[];
	current: ParsedChecklist | null;
}

function applyLineToParseState(state: ParseState, action: LineClassification): void {
	switch (action.action) {
		case 'new-section':
			flushCurrent(state);
			state.current = { name: action.name, items: [] };
			return;
		case 'add-item':
			state.current?.items.push(action.item);
			return;
		case 'end-section':
			flushCurrent(state);
			state.current = null;
			return;
		case 'skip':
			return;
	}
}

function flushCurrent(state: ParseState): void {
	if (state.current && state.current.items.length > 0) {
		state.checklists.push(state.current);
	}
}

type LineClassification =
	| { action: 'new-section'; name: string }
	| { action: 'add-item'; item: ParsedChecklistItem }
	| { action: 'end-section' }
	| { action: 'skip' };

function classifyLine(line: string, current: { name: string } | null): LineClassification {
	const h3Match = line.match(H3_REGEX);
	if (h3Match) return { action: 'new-section', name: h3Match[1] };

	if (current && HEADING_REGEX.test(line)) return { action: 'end-section' };

	const cbMatch = line.match(CHECKBOX_REGEX);
	if (cbMatch && current) {
		const name = cbMatch[2].trim();
		return {
			action: 'add-item',
			item: {
				id: hashChecklistItemId(current.name, name),
				name,
				complete: cbMatch[1] === 'x',
			},
		};
	}

	if (current && line.trim() === '') return { action: 'skip' };
	if (current) return { action: 'skip' };
	return { action: 'skip' };
}

// ---------------------------------------------------------------------------
// Synthetic checklist ID helpers (shared by JIRA and Linear adapters)
// ---------------------------------------------------------------------------

/**
 * Prefix used to construct synthetic checklist IDs for inline-markdown
 * providers (JIRA and Linear).  Format: `inline-<workItemId>-<nameHash>`.
 */
export const INLINE_CHECKLIST_ID_PREFIX = 'inline-';

/**
 * Build a synthetic checklist ID that encodes the work-item ID and a
 * stable 8-char hash of the checklist name.
 */
export function buildChecklistId(workItemId: string, checklistName: string): string {
	const hash = hashChecklistItemId('', checklistName).slice(3); // strip 'cl-' prefix
	return `${INLINE_CHECKLIST_ID_PREFIX}${workItemId}-${hash}`;
}

/**
 * Parse a synthetic checklist ID back into its constituent parts.
 * Returns `null` when the ID does not follow the `inline-` format.
 */
export function parseChecklistId(
	checklistId: string,
): { workItemId: string; nameHash: string } | null {
	if (!checklistId.startsWith(INLINE_CHECKLIST_ID_PREFIX)) return null;
	const rest = checklistId.slice(INLINE_CHECKLIST_ID_PREFIX.length);
	// Last segment is 8-char hex hash; everything before is the workItemId
	const m = rest.match(/^(.+)-([0-9a-f]{8})$/);
	if (!m) return null;
	return { workItemId: m[1], nameHash: m[2] };
}

// ---------------------------------------------------------------------------
// Find a checklist section name by hash (includes empty sections)
// ---------------------------------------------------------------------------

/**
 * Returns the name of the first `### ` heading in `description` whose hash of
 * its name (via `hashChecklistItemId('', name).slice(3)`) matches `nameHash`.
 * Useful for finding empty checklist sections that the parser drops.
 */
export function findChecklistNameByHash(description: string, nameHash: string): string | null {
	if (!description) return null;
	for (const line of description.split('\n')) {
		const m = line.match(H3_REGEX);
		if (m) {
			const name = m[1];
			if (hashChecklistItemId('', name).slice(3) === nameHash) return name;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Appending a new checklist section
// ---------------------------------------------------------------------------

export function appendChecklistSection(
	description: string,
	checklistName: string,
	items: { name: string; checked: boolean }[],
): string {
	const lines: string[] = [`### ${checklistName}`];
	for (const item of items) {
		lines.push(`- [${item.checked ? 'x' : ' '}] ${item.name}`);
	}
	const section = lines.join('\n');

	if (!description) return section;
	return `${description.trimEnd()}\n\n${section}`;
}

export function upsertChecklistSection(
	description: string,
	checklistName: string,
	items: { name: string; checked: boolean }[],
): string {
	const deduped = dedupeChecklistSections(description, checklistName);
	const lines = deduped ? deduped.split('\n') : [];
	const section = findChecklistSection(lines, checklistName);

	if (!section) {
		return appendChecklistSection(deduped, checklistName, items);
	}

	if (items.length === 0) return deduped;
	return dedupeChecklistSections(
		appendChecklistSection(deduped, checklistName, items),
		checklistName,
	);
}

// ---------------------------------------------------------------------------
// Adding a single item
// ---------------------------------------------------------------------------

export function addItemToChecklist(
	description: string,
	checklistName: string,
	itemName: string,
	checked = false,
): string {
	const lines = description.split('\n');
	const insertIdx = findChecklistInsertionIndex(lines, checklistName);
	if (insertIdx === -1) {
		throw new Error(`Checklist section "${checklistName}" not found in description`);
	}

	const newLine = `- [${checked ? 'x' : ' '}] ${itemName}`;
	lines.splice(insertIdx + 1, 0, newLine);
	return lines.join('\n');
}

export function upsertItemInChecklist(
	description: string,
	checklistName: string,
	itemName: string,
	checked = false,
): string {
	const deduped = dedupeChecklistSections(description, checklistName);
	const lines = deduped.split('\n');
	const section = findChecklistSection(lines, checklistName);
	if (!section) {
		throw new Error(`Checklist section "${checklistName}" not found in description`);
	}

	const existing = findItemLineInSection(lines, section, itemName);
	if (existing !== -1) {
		const existingChecked = lines[existing].match(CHECKBOX_REGEX)?.[1] === 'x';
		if (checked && !existingChecked) {
			lines[existing] = `- [x] ${itemName}`;
		}
		return lines.join('\n');
	}

	return addItemToChecklist(deduped, checklistName, itemName, checked);
}

// ---------------------------------------------------------------------------
// Toggling an item
// ---------------------------------------------------------------------------

export function toggleChecklistItem(
	description: string,
	itemId: string,
	complete: boolean,
	checklists: ParsedChecklist[],
): string {
	const target = findItemById(itemId, checklists);
	if (!target) throw new Error(`Checklist item not found: ${itemId}`);

	return replaceCheckboxLine(description, target.checklistName, target.item.name, complete);
}

// ---------------------------------------------------------------------------
// Removing an item
// ---------------------------------------------------------------------------

export function removeChecklistItem(
	description: string,
	itemId: string,
	checklists: ParsedChecklist[],
): string {
	const target = findItemById(itemId, checklists);
	if (!target) throw new Error(`Checklist item not found: ${itemId}`);

	const lines = description.split('\n');
	const scan = scanSection(lines, target.checklistName, target.item.name);
	if (scan.targetLineIdx === -1) throw new Error(`Checklist item line not found: ${itemId}`);

	if (scan.itemCount === 1) {
		// Remove the entire section: use lastContentIdx so trailing detail lines
		// after the only checkbox are included and not left orphaned.
		const sectionEnd = scan.lastContentIdx !== -1 ? scan.lastContentIdx : scan.targetLineIdx;
		removeSectionBlock(lines, scan.headingIdx, sectionEnd);
	} else {
		// Also remove detail/prose lines immediately following the deleted checkbox
		// (up to the next checkbox, heading, or blank line) so they aren't orphaned.
		let deleteEnd = scan.targetLineIdx;
		for (let i = scan.targetLineIdx + 1; i < lines.length; i++) {
			if (HEADING_REGEX.test(lines[i]) || CHECKBOX_REGEX.test(lines[i]) || lines[i].trim() === '') {
				break;
			}
			deleteEnd = i;
		}
		lines.splice(scan.targetLineIdx, deleteEnd - scan.targetLineIdx + 1);
	}

	return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findItemById(
	itemId: string,
	checklists: ParsedChecklist[],
): { checklistName: string; item: ParsedChecklistItem } | null {
	for (const cl of checklists) {
		for (const item of cl.items) {
			if (item.id === itemId) return { checklistName: cl.name, item };
		}
	}
	return null;
}

function replaceCheckboxLine(
	description: string,
	checklistName: string,
	itemName: string,
	complete: boolean,
): string {
	const lines = description.split('\n');
	const scan = scanSection(lines, checklistName, itemName);
	if (scan.targetLineIdx === -1) {
		throw new Error(`Could not find checkbox line for "${itemName}" in section "${checklistName}"`);
	}
	lines[scan.targetLineIdx] = `- [${complete ? 'x' : ' '}] ${itemName}`;
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Section scanning
// ---------------------------------------------------------------------------

interface SectionScan {
	headingIdx: number;
	targetLineIdx: number;
	itemCount: number;
	/** Index of the last non-empty line in the section (may be a detail line after the last checkbox). */
	lastContentIdx: number;
}

interface ChecklistSectionSpan {
	name: string;
	startIdx: number;
	endIdx: number;
}

function dedupeChecklistSections(description: string, checklistName: string): string {
	if (!description) return description;
	const lines = description.split('\n');
	const sections = scanChecklistSections(lines).filter((section) => section.name === checklistName);
	if (sections.length <= 1) return description;

	const first = sections[0];
	const mergedItems = collectMergedSectionItems(lines, sections);
	const rewrittenFirstSection = rewriteChecklistSection(
		lines.slice(first.startIdx, first.endIdx),
		mergedItems,
	);
	return removeDuplicateChecklistSections(lines, sections, rewrittenFirstSection);
}

function findChecklistInsertionIndex(lines: string[], checklistName: string): number {
	const heading = `### ${checklistName}`;
	let insertIdx = -1;
	let inSection = false;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === heading) {
			inSection = true;
			insertIdx = i;
			continue;
		}
		if (!inSection) continue;
		if (CHECKBOX_REGEX.test(lines[i])) {
			insertIdx = i;
		} else if (HEADING_REGEX.test(lines[i])) {
			break;
		} else if (lines[i].trim() !== '') {
			// Non-empty detail/prose line — advance insertIdx so new items land
			// after all trailing detail belonging to the previous item, not before it.
			insertIdx = i;
		}
	}

	return insertIdx;
}

function collectMergedSectionItems(
	lines: string[],
	sections: ChecklistSectionSpan[],
): Map<string, boolean> {
	const mergedItems = new Map<string, boolean>();
	for (const section of sections) {
		for (const [name, checked] of collectSectionItems(lines, section)) {
			mergedItems.set(name, (mergedItems.get(name) ?? false) || checked);
		}
	}
	return mergedItems;
}

function rewriteChecklistSection(
	sectionLines: string[],
	mergedItems: Map<string, boolean>,
): string[] {
	const state = { lines: [] as string[], seen: new Set<string>(), lastCheckboxIdx: -1 };
	for (const line of sectionLines) {
		rewriteChecklistSectionLine(state, line, mergedItems);
	}
	insertMissingChecklistItemLines(state, mergedItems);
	return state.lines;
}

function rewriteChecklistSectionLine(
	state: { lines: string[]; seen: Set<string>; lastCheckboxIdx: number },
	line: string,
	mergedItems: Map<string, boolean>,
): void {
	const cbMatch = line.match(CHECKBOX_REGEX);
	if (!cbMatch) {
		state.lines.push(line);
		return;
	}
	const itemName = cbMatch[2].trim();
	if (state.seen.has(itemName)) return;
	state.seen.add(itemName);
	const checked = (mergedItems.get(itemName) ?? false) || cbMatch[1] === 'x';
	state.lines.push(`- [${checked ? 'x' : ' '}] ${itemName}`);
	state.lastCheckboxIdx = state.lines.length - 1;
}

function insertMissingChecklistItemLines(
	state: { lines: string[]; seen: Set<string>; lastCheckboxIdx: number },
	mergedItems: Map<string, boolean>,
): void {
	const missingItemLines: string[] = [];
	for (const [itemName, checked] of mergedItems) {
		if (!state.seen.has(itemName)) {
			missingItemLines.push(`- [${checked ? 'x' : ' '}] ${itemName}`);
		}
	}
	if (missingItemLines.length > 0) {
		// Determine insertion point: immediately after the last checkbox AND any
		// trailing non-blank detail/prose lines that follow it. Inserting at
		// lastCheckboxIdx + 1 would place new rows before those detail lines,
		// visually re-attributing them to the wrong (newly-inserted) item.
		// We stop advancing at the first blank line so we never cross a section
		// boundary or an intentional separator.
		let insertIdx: number;
		if (state.lastCheckboxIdx === -1) {
			insertIdx = 1; // No checkboxes yet; insert right after the heading.
		} else {
			insertIdx = state.lastCheckboxIdx;
			for (let i = state.lastCheckboxIdx + 1; i < state.lines.length; i++) {
				if (state.lines[i].trim() !== '') {
					// Non-blank detail/prose line — advance past it.
					insertIdx = i;
				} else {
					// Blank line — stop; don't cross section boundaries.
					break;
				}
			}
			insertIdx += 1;
		}
		state.lines.splice(insertIdx, 0, ...missingItemLines);
	}
}

function removeDuplicateChecklistSections(
	lines: string[],
	sections: ChecklistSectionSpan[],
	rewrittenFirstSection: string[],
): string {
	const first = sections[0];
	const output: string[] = [];
	for (let i = 0; i < lines.length; ) {
		if (i === first.startIdx) {
			output.push(...rewrittenFirstSection);
			i = first.endIdx;
			continue;
		}
		const duplicate = findSectionStartingAt(sections, i);
		if (duplicate) {
			i = skipRemovedDuplicateSection(lines, output, duplicate);
			continue;
		}
		output.push(lines[i]);
		i++;
	}

	return output.join('\n').trimEnd();
}

function findSectionStartingAt(
	sections: ChecklistSectionSpan[],
	lineIdx: number,
): ChecklistSectionSpan | undefined {
	return sections.find((section) => section.startIdx === lineIdx);
}

function skipRemovedDuplicateSection(
	lines: string[],
	output: string[],
	duplicate: ChecklistSectionSpan,
): number {
	// Collect non-checkbox prose lines from the duplicate section.
	// Checkbox items have already been merged into the first section's rewrite;
	// the heading line itself is also dropped. Only non-generated prose survives.
	const proseLines: string[] = [];
	for (let i = duplicate.startIdx + 1; i < duplicate.endIdx; i++) {
		if (!CHECKBOX_REGEX.test(lines[i])) {
			proseLines.push(lines[i]);
		}
	}
	// Trim leading/trailing blank lines so we don't emit orphaned whitespace.
	while (proseLines.length > 0 && proseLines[0].trim() === '') proseLines.shift();
	while (proseLines.length > 0 && proseLines[proseLines.length - 1].trim() === '') proseLines.pop();

	while (output.length > 0 && output[output.length - 1].trim() === '') output.pop();

	if (proseLines.length > 0) {
		// Preserve prose from the duplicate section after the merged content.
		output.push('');
		output.push(...proseLines);
	}

	let nextIdx = duplicate.endIdx;
	while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
	if (nextIdx < lines.length && output.length > 0 && output[output.length - 1].trim() !== '') {
		output.push('');
	}
	return nextIdx;
}

function scanChecklistSections(lines: string[]): ChecklistSectionSpan[] {
	const sections: ChecklistSectionSpan[] = [];
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(H3_REGEX);
		if (!match) continue;
		let endIdx = lines.length;
		for (let j = i + 1; j < lines.length; j++) {
			if (HEADING_REGEX.test(lines[j])) {
				endIdx = j;
				break;
			}
		}
		sections.push({ name: match[1], startIdx: i, endIdx });
	}
	return sections;
}

function findChecklistSection(lines: string[], checklistName: string): ChecklistSectionSpan | null {
	return scanChecklistSections(lines).find((section) => section.name === checklistName) ?? null;
}

function collectSectionItems(lines: string[], section: ChecklistSectionSpan): Map<string, boolean> {
	const items = new Map<string, boolean>();
	for (let i = section.startIdx + 1; i < section.endIdx; i++) {
		const match = lines[i].match(CHECKBOX_REGEX);
		if (!match) continue;
		const name = match[2].trim();
		items.set(name, (items.get(name) ?? false) || match[1] === 'x');
	}
	return items;
}

function findItemLineInSection(
	lines: string[],
	section: ChecklistSectionSpan,
	itemName: string,
): number {
	for (let i = section.startIdx + 1; i < section.endIdx; i++) {
		const match = lines[i].match(CHECKBOX_REGEX);
		if (match && match[2].trim() === itemName) return i;
	}
	return -1;
}

function scanSection(lines: string[], checklistName: string, targetItemName: string): SectionScan {
	const heading = `### ${checklistName}`;
	let headingIdx = -1;
	let targetLineIdx = -1;
	let inSection = false;
	let itemCount = 0;
	let lastContentIdx = -1;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === heading) {
			inSection = true;
			headingIdx = i;
			continue;
		}
		if (!inSection) continue;
		if (HEADING_REGEX.test(lines[i])) break;
		const cbMatch = lines[i].match(CHECKBOX_REGEX);
		if (cbMatch) {
			itemCount++;
			if (cbMatch[2].trim() === targetItemName && targetLineIdx === -1) targetLineIdx = i;
		}
		if (lines[i].trim() !== '') {
			lastContentIdx = i;
		}
	}

	return { headingIdx, targetLineIdx, itemCount, lastContentIdx };
}

function removeSectionBlock(lines: string[], headingIdx: number, lastItemIdx: number): void {
	let endIdx = lastItemIdx;
	while (endIdx + 1 < lines.length && lines[endIdx + 1].trim() === '') endIdx++;
	let startIdx = headingIdx;
	if (startIdx > 0 && lines[startIdx - 1].trim() === '') startIdx--;
	lines.splice(startIdx, endIdx - startIdx + 1);
}
