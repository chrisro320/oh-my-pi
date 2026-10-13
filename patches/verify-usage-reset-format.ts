// The usage footer's reset countdowns render as one-decimal single units so the
// quota line stays narrow: 275 min -> "4.5h", 154 h -> "6.4d". The two-unit
// forms ("4h 35m", "6d 10h") must not come back. Both status surfaces are
// covered: the rendered `usage` segment and its native `describe` twin, which
// share `formatUsageReset`.
//
//   OMP_PATCH_VERIFY_TUI_ROOT=<tree>/pi-tui bun patches/verify-usage-reset-format.ts
//
// A tree that keeps the old minute/hour decomposition fails the exact-string
// assertions below (negative control); so does any mutation that rounds the
// tenths up or computes them with float arithmetic.
import assert from "node:assert/strict";
import { homedir } from "node:os";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const TUI_ROOT = process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${NM}/pi-tui`;
// Root-selected imports: an isolated patch replay must exercise its own tree,
// never the live install.
const { SEGMENTS, describeSegment } = await import(`${TUI_ROOT}/src/status-line/segments.ts`);
const { ensureThemeSync, setSymbolPreset } = await import(`${TUI_ROOT}/src/theme/theme.ts`);
ensureThemeSync();

const ANSI = /\u001b\[[0-9;]*m/g;
const strip = (text: string): string => text.replace(ANSI, "");

type ResetUnit = "m" | "h";

// `m` = minutes (5h/1d windows), `h` = hours (7d/mo windows): each window names
// the unit its provider reset timer is measured in.
function usageContext(value: number, unit: ResetUnit): unknown {
	const usage =
		unit === "m" ? { fiveHour: { percent: 0, resetMinutes: value } } : { sevenDay: { percent: 0, resetHours: value } };
	return { usage, startupPlaceholder: false };
}

// The reset countdown is the parenthesised text the window renders; the label
// and the percent never carry parentheses, so the first group is unambiguous.
function resetInRender(value: number, unit: ResetUnit): string {
	const rendered = strip(SEGMENTS.usage.render(usageContext(value, unit) as never).content);
	const match = rendered.match(/\(([^)]*)\)/);
	assert.ok(match, `rendered usage segment must carry a reset window for ${value}${unit}: ${JSON.stringify(rendered)}`);
	return match[1];
}

function resetInDescribe(value: number, unit: ResetUnit): string {
	const view = describeSegment("usage", usageContext(value, unit) as never);
	assert.ok(view, `native usage description must exist for ${value}${unit}`);
	const text = view.spans.map(span => span.t).join("");
	const match = text.match(/\(([^)]*)\)/);
	assert.ok(match, `native usage description must carry a reset window for ${value}${unit}: ${JSON.stringify(text)}`);
	return match[1];
}

// Boundaries: the last value below a unit, the whole unit, the first tenth above
// it, and the transition to the next unit. Tenths are floored, so 119 min is the
// largest sub-2h value and 1439 min the largest sub-day value.
const MINUTE_CASES: Array<[number, string]> = [
	[59, "59m"],
	[60, "1h"],
	[61, "1h"],
	[119, "1.9h"],
	[120, "2h"],
	[275, "4.5h"],
	[1439, "23.9h"],
];
const HOUR_CASES: Array<[number, string]> = [
	[23, "23h"],
	[24, "1d"],
	[25, "1d"],
	[30, "1.2d"],
	[154, "6.4d"],
	[167, "6.9d"],
	[168, "7d"],
];

for (const [value, expected] of MINUTE_CASES) {
	assert.equal(resetInRender(value, "m"), expected, `rendered reset for ${value} min`);
	assert.equal(resetInDescribe(value, "m"), expected, `native reset for ${value} min`);
}
for (const [value, expected] of HOUR_CASES) {
	assert.equal(resetInRender(value, "h"), expected, `rendered reset for ${value} h`);
	assert.equal(resetInDescribe(value, "h"), expected, `native reset for ${value} h`);
}

// The whole quota line for the measured pair (275 min / 154 h) on both presets.
// Unicode is what the live footer prints; ascii is the Tern-safe smoke preset.
const SAMPLE = { usage: { fiveHour: { percent: 3, resetMinutes: 275 }, sevenDay: { percent: 0, resetHours: 154 } }, startupPlaceholder: false };
const oldForm = /4h 35m|6d 10h|4\.5h |6\.4d /;

await setSymbolPreset("unicode");
const unicodeLine = strip(SEGMENTS.usage.render(SAMPLE as never).content);
assert.equal(unicodeLine, "⏱ 5h 3% (4.5h) · 7d 0% (6.4d)", `unicode quota line: ${JSON.stringify(unicodeLine)}`);
assert.ok(!oldForm.test(unicodeLine), `unicode quota line still shows a two-unit countdown: ${JSON.stringify(unicodeLine)}`);

await setSymbolPreset("ascii");
const asciiLine = strip(SEGMENTS.usage.render(SAMPLE as never).content);
assert.equal(asciiLine, "t: 5h 3% (4.5h) - 7d 0% (6.4d)", `ascii quota line: ${JSON.stringify(asciiLine)}`);
assert.ok(!oldForm.test(asciiLine), `ascii quota line still shows a two-unit countdown: ${JSON.stringify(asciiLine)}`);

console.log(`verify-usage-reset-format: ${MINUTE_CASES.length + HOUR_CASES.length} countdown boundaries on both surfaces`);
console.log(`verify-usage-reset-format: ${unicodeLine}`);
console.log(`verify-usage-reset-format: ${asciiLine}`);
