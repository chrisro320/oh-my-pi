// Verify 0056: `devinCliMetadata` carries the official chisel client's
// per-process `sessionId` and monotonic `requestId`, on the released CLI
// version tuple. Purely in-process — no provider, network, or DB access.
import assert from "node:assert/strict";
import { join } from "node:path";
// Absolute paths on purpose: `patch` rewrites through rename, which breaks the
// hard links bun's install cache shares with this tree. A bare
// `@oh-my-pi/pi-catalog/...` specifier would then resolve to the cache's
// pristine copy and silently verify the wrong file. The override mirrors the
// `OMP_PATCH_VERIFY_*` convention the other gates use, so an official-tree
// sandbox can be replayed against its own copy.
const root = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-catalog";
// Dynamic import is required, not stylistic: the package root is runtime-selected
// (live tree by default, an official-tree sandbox when apply.sh passes
// OMP_PATCH_VERIFY_CATALOG_ROOT), so no static specifier can name it. Same
// pattern as verify-interrupt-prune-symmetry.ts / verify-date-cwd-anchor-stability.ts.
const { devinCliMetadata, devinDiscoveryMetadata } = await import(join(root, "src/wire/devin.ts"));
const { MetadataSchema } = await import(join(root, "src/discovery/devin-proto.ts"));
const { create, fromBinary, toBinary } = await import(join(root, "src/discovery/protobuf.ts"));

console.log("=== Testing Devin CLI metadata alignment (0056) ===");

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pull `Metadata.sessionId` (field 10, string) and `Metadata.requestId`
 * (field 9, uint64) straight off encoded bytes. The codec round-trip below
 * cannot catch a wrong field number — encode and decode share one schema — so
 * the official wire numbers are asserted against the raw protobuf instead.
 */
function readIdentityFields(bytes: Uint8Array): { sessionId?: string; requestId?: bigint } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out: { sessionId?: string; requestId?: bigint } = {};
	let pos = 0;
	const varint = (): bigint => {
		let shift = 0n;
		let value = 0n;
		for (;;) {
			const byte = view.getUint8(pos++);
			value |= BigInt(byte & 0x7f) << shift;
			if ((byte & 0x80) === 0) return value;
			shift += 7n;
		}
	};
	while (pos < bytes.byteLength) {
		const tag = varint();
		const field = Number(tag >> 3n);
		const wireType = tag & 7n;
		if (field === 10 && wireType === 2n) {
			const len = Number(varint());
			out.sessionId = new TextDecoder().decode(bytes.subarray(pos, pos + len));
			pos += len;
			continue;
		}
		if (field === 9 && wireType === 0n) {
			out.requestId = varint();
			continue;
		}
		switch (wireType) {
			case 0n:
				varint();
				break;
			case 1n:
				pos += 8;
				break;
			case 2n: {
				// Read the length before advancing: `pos += varint()` would read
				// `pos` (compound assignment evaluates the target first) before
				// varint() consumed its own bytes, losing one byte per multi-byte
				// length and desynchronising every field after it.
				const len = Number(varint());
				pos += len;
				break;
			}
			case 5n:
				pos += 4;
				break;
			default:
				throw new Error(`unsupported wire type ${wireType} at field ${field}`);
		}
	}
	return out;
}

// --- Request identity is minted per process, not per call --------------------
const first = devinCliMetadata("api-key-abc", "jwt-value");
const second = devinCliMetadata("api-key-abc", "jwt-value");

assert.equal(typeof first.sessionId, "string", "sessionId must be a string");
assert.match(first.sessionId, UUID_V4, `sessionId is not a UUID v4: ${first.sessionId}`);
assert.equal(second.sessionId, first.sessionId, "sessionId must be minted once per process, not per call");
assert.equal(first.ideVersion, "3000.10.23", "ideVersion must track the released devin CLI");
assert.equal(first.extensionVersion, "3000.10.23", "extensionVersion must track the released devin CLI");
assert.equal(first.extensionName, "chisel", "extensionName is the chisel identity");
assert.equal(first.ideType, "chisel", "ideType is what unlocks router assignment");

// --- The counter only ever moves forward ------------------------------------
assert.equal(typeof first.requestId, "bigint", "requestId must be a bigint (uint64 on the wire)");
assert.equal(second.requestId - first.requestId, 1n, "requestId must increment by exactly 1 per call");
const third = devinCliMetadata(undefined);
assert.equal(third.requestId - second.requestId, 1n, "requestId must keep counting without an apiKey");

// --- Pass-through behaviour must not regress --------------------------------
assert.equal(first.apiKey, "devin-session-token$api-key-abc", "apiKey keeps the scheme prefix");
assert.equal(first.userJwt, "jwt-value", "userJwt passes through");
assert.equal(third.apiKey, "", "a missing apiKey normalizes to the empty string");
assert.equal(
	devinCliMetadata("devin-session-token$already").apiKey,
	"devin-session-token$already",
	"an already-prefixed apiKey is not double-prefixed",
);
assert.equal(devinCliMetadata(undefined, "jwt-only").userJwt, "jwt-only", "an explicit userJwt is preserved");

// --- The identity must reach the wire at the official field numbers ---------
const encoded = toBinary(MetadataSchema, create(MetadataSchema, first as never));
const onWire = readIdentityFields(encoded);
assert.equal(onWire.sessionId, first.sessionId, "Metadata field 10 must carry the per-process sessionId");
assert.equal(onWire.requestId, first.requestId, "Metadata field 9 must carry the incrementing requestId");

const decoded = fromBinary(MetadataSchema, encoded);
assert.equal(decoded.sessionId, first.sessionId, "sessionId must survive the proto round-trip");
assert.equal(decoded.requestId, first.requestId, "requestId must survive the proto round-trip");
assert.equal(decoded.ideVersion, "3000.10.23", "ideVersion must survive the proto round-trip");
assert.equal(decoded.apiKey, "devin-session-token$api-key-abc", "apiKey must survive the proto round-trip");
assert.equal(decoded.userJwt, "jwt-value", "userJwt must survive the proto round-trip");

// --- Discovery is a separate identity and must stay untouched ---------------
const discovery = devinDiscoveryMetadata("api-key-abc") as Record<string, unknown>;
assert.equal("sessionId" in discovery, false, "devinDiscoveryMetadata must not carry sessionId");
assert.equal("requestId" in discovery, false, "devinDiscoveryMetadata must not carry requestId");
assert.equal(discovery.ideVersion, "0.0.0-dev", "the dev-channel discovery identity keeps its own version");
assert.equal(discovery.extensionVersion, "0.0.0-dev", "the dev-channel discovery identity keeps its own version");

console.log("PASS: per-process sessionId, requestId +1 per call, 3000.10.23 tuple, pass-through, wire fields 10/9, discovery untouched");
