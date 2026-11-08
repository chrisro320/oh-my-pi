// 18.10.0 authority-boundary gate: actual archive importer and SDK switch.
// Synthetic journals, private HOME, intercepted transport; no provider requests.
// Import races use the real synchronous claim boundary, never a timing sleep.
// Run with OMP_PATCH_VERIFY_NM or package-specific AGENT/AI roots.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlan } from "./version-registry.ts";
import { enterPrivateHome } from "./durability-harness.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const plan = resolvePlan({ gate: "verify-session-transfer-authority", roots: [AGENT_ROOT] });
// Private HOME must also precede runtime startup (os.homedir may be cached).
const root = enterPrivateHome({
	entry: import.meta.path,
	prefix: "omp-transfer-authority-",
	setEnv: {
		TMUX_PANE: "%durability-inode",
		// Kept for the forced-worker fixture and probe entry, which resolve this tree by env.
		OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT, OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
	},
	reExecEnv: { OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT, OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT },
});
globalThis.fetch = (() => { throw new Error("Network forbidden in transfer authority gate"); }) as typeof fetch;

// Specifiers are runtime-selected: importing by package name would test another tree.
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { FileSessionStorage } = await import(`${AGENT_ROOT}/src/session/session-storage.ts`);
const { packSession, unpackSession, markSessionMoved } = await import(`${AGENT_ROOT}/src/session/session-transfer.ts`);
const { lastSessionTransfer } = await import(`${AGENT_ROOT}/src/session/session-transfer-marker.ts`);
const { readTerminalBreadcrumbEntry } = await import(`${AGENT_ROOT}/src/session/session-paths.ts`);
const { DateCwdReminderInjector, createSessionDateCwdReminderJournal } =
	await import(`${AGENT_ROOT}/src/session/date-cwd-reminder.ts`);
const { readArchiveEntries } = await import(Bun.resolveSync("@oh-my-pi/pi-utils/ar", AGENT_ROOT));
// Every registered plan journals each reminder placement as a `date-cwd-reminder`
// custom entry of the session JSONL.
/** The archive artifact whose staged publication the cross-device fixture forces to fail. */
const STAGED_ARTIFACT = "sentinel.bin";
const cwd = join(root, "work");
mkdirSync(cwd);

/** The session surface a {@link DateCwdReminderJournal} reads and writes. */
interface ReminderSession {
	getSessionId(): string;
	getSessionFile(): string | null;
	getBranchView(): readonly unknown[];
	appendCustomEntry(customType: string, data?: unknown): string;
	getLeafId(): string | null;
	getEntry(id: string): unknown;
}

/** The reminder injector for this plan: 18.16.0 reads and writes the session's journal. */
function reminderInjector(manager: ReminderSession) {
	return new DateCwdReminderInjector(createSessionDateCwdReminderJournal(manager));
}

/** `date-cwd-reminder` placements recorded in one session JSONL, in file order. */
function journalEntriesOf(journal: string): unknown[] {
	const entries: unknown[] = [];
	for (const line of journal.trim().split("\n")) {
		const parsed: unknown = JSON.parse(line);
		if (typeof parsed !== "object" || parsed === null) continue;
		if (!("type" in parsed) || parsed.type !== "custom") continue;
		if (!("customType" in parsed) || parsed.customType !== "date-cwd-reminder") continue;
		entries.push(parsed);
	}
	return entries;
}

async function archiveFixture(name: string, extended = false, sourceCwd = cwd, placeReminders = true, writeArtifacts = true) {
	const sessionDir = join(root, name);
	const manager = SessionManager.create(sourceCwd, sessionDir);
	manager.appendMessage({ role: "user", content: `base ${name}`, timestamp: 1 });
	await manager.ensureOnDisk();
	await manager.flush();
	const file = manager.getSessionFile();
	assert.ok(file);
	const prefix = readFileSync(file, "utf8");
	if (extended) {
		manager.appendMessage({ role: "user", content: `incoming ${name}`, timestamp: 2 });
		await manager.flush();
	}
	const id = manager.getSessionId();
	const artifacts = manager.getArtifactsDir();
	assert.ok(artifacts);
	if (writeArtifacts) {
		mkdirSync(artifacts, { recursive: true });
		writeFileSync(join(artifacts, "sentinel.bin"), Buffer.from([0, 255, 13, 10, 7]));
	}
	const sent = placeReminders
		? reminderInjector(manager)
			.transform({ systemPrompt: ["fixture"], messages: manager.buildSessionContext().messages }, "2026-09-06", sourceCwd)
		: undefined;
	await manager.close();
	const archive = join(root, `${name}.omp-session`);
	await packSession(file, archive);
	return { sessionDir, file, id, archive, prefix, artifacts, firstMessage: sent && JSON.stringify(sent.messages[0]) };
}

/** Capture files and directories, including binary artifacts and orphan folders. */
function snapshotTree(directory: string): Array<[string, string | null]> {
	if (!existsSync(directory)) return [];
	const result: Array<[string, string | null]> = [];
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (entry.isDirectory()) {
			result.push([entry.name, null]);
			for (const [relative, bytes] of snapshotTree(join(directory, entry.name))) result.push([`${entry.name}/${relative}`, bytes]);
		} else result.push([entry.name, readFileSync(join(directory, entry.name)).toString("base64")]);
	}
	return result;
}

try {
	// A held same-process claim is just as authoritative as a remote process.
	const held = await archiveFixture("held-claim");
	const writer = await SessionManager.open(held.file);
	writer.appendMessage({ role: "user", content: "live owner committed this", timestamp: 3 });
	await writer.flush();
	const heldBytes = readFileSync(held.file, "utf8");
	try {
		await assert.rejects(() => unpackSession(held.archive, { cwd, sessionDir: held.sessionDir }),
			/live.*(writer|process)|another live|owns it/i,
			"import must refuse an ID whose writer still holds authority");
		assert.equal(readFileSync(held.file, "utf8"), heldBytes, "refused import cannot replace the writer's journal");
	} finally {
		await writer.close();
	}

	// Publish the bytes of a real, fully drained local append at the exact
	// incoming claim boundary. This represents another completed writer without
	// assuming close() releases synchronously or using a timing sleep.
	const raced = await archiveFixture("claim-order");
	const local = await SessionManager.open(raced.file);
	local.appendMessage({ role: "user", content: "append-before-import-claim", timestamp: 4 });
	await local.flush();
	const committedBytes = readFileSync(raced.file, "utf8");
	await local.close();
	writeFileSync(raced.file, raced.prefix);
	const originalClaim = FileSessionStorage.prototype.claimSession;
	let injected = false;
	FileSessionStorage.prototype.claimSession = function (id: string, file: string, options?: { exclusive?: boolean }) {
		if (id === raced.id && !injected) {
			injected = true;
			writeFileSync(raced.file, committedBytes);
		}
		return originalClaim.call(this, id, file, options);
	};
	try {
		const imported = await unpackSession(raced.archive, { cwd, sessionDir: raced.sessionDir });
		assert.equal(injected, true, "fixture must cross the actual claim boundary");
		assert.equal(imported.mode, "forked", "post-claim discovery must retain a divergent local tail");
		assert.notEqual(imported.id, raced.id, "divergent incoming history must acquire a fresh ID");
		assert.equal(readFileSync(raced.file, "utf8"), committedBytes, "the concurrent local append survives publication");
		const fork = await SessionManager.open(imported.sessionFile);
		try {
			assert.ok(!JSON.stringify(fork.getEntries()).includes("append-before-import-claim"),
				"the incoming fork must not pretend to contain the local-only message");
		} finally {
			await fork.close();
		}
	} finally {
		FileSessionStorage.prototype.claimSession = originalClaim;
	}

	// A diverged local copy forks even when the incoming session carries no
	// artifacts: an archive that declares none has nothing left to complete.
	const bare = await archiveFixture("fork-without-artifacts", false, cwd, true, false);
	assert.equal(existsSync(bare.artifacts), false, "the fixture must have no artifacts directory at all");
	const bareLocal = await SessionManager.open(bare.file);
	bareLocal.appendMessage({ role: "user", content: "divergent local history", timestamp: 11 });
	await bareLocal.flush();
	await bareLocal.close();
	const bareImported = await unpackSession(bare.archive, { cwd, sessionDir: bare.sessionDir });
	assert.equal(bareImported.mode, "forked", "a diverged copy of an artifact-free session forks");
	assert.notEqual(bareImported.id, bare.id, "the artifact-free fork acquires a fresh ID");
	const bareFork = await SessionManager.open(bareImported.sessionFile);
	try {
		assert.ok(JSON.stringify(bareFork.getEntries()).includes("base fork-without-artifacts"),
			"the artifact-free fork resumes the incoming history");
		assert.ok(!JSON.stringify(bareFork.getEntries()).includes("divergent local history"));
	} finally {
		await bareFork.close();
	}

	// An archive that declares no artifacts must still import in the other
	// modes: complete-artifact publication needs a staged artifacts directory
	// even when it is empty, so nothing stats a directory never staged.
	for (const mode of ["created", "replaced"] as const) {
		const noArtifacts = await archiveFixture(`artifact-free-${mode}`, false, cwd, true, false);
		assert.equal(existsSync(noArtifacts.artifacts), false,
			`${mode}: the fixture must have no artifacts directory at all`);
		const destination = mode === "created" ? join(root, `artifact-free-destination-${mode}`) : noArtifacts.sessionDir;
		mkdirSync(destination, { recursive: true });
		const imported = await unpackSession(noArtifacts.archive, { cwd, sessionDir: destination });
		assert.equal(imported.mode, mode, `an artifact-free archive must import as ${mode}`);
		const manager = await SessionManager.open(imported.sessionFile);
		try {
			const placements = createSessionDateCwdReminderJournal(manager).load();
			assert.ok(placements.length > 0, `${mode}: the published journal must carry the archive's date/cwd placements`);
			assert.equal(journalEntriesOf(readFileSync(imported.sessionFile, "utf8")).length, placements.length,
				`${mode}: every journaled placement must survive the publication`);
			const request = reminderInjector(manager)
				.transform({ systemPrompt: ["fixture"], messages: manager.buildSessionContext().messages }, "2026-09-06", cwd);
			assert.equal(JSON.stringify(request.messages[0]), noArtifacts.firstMessage,
				`${mode}: the artifact-free import must keep its first provider message byte-identical`);
		} finally {
			await manager.close();
		}
	}

	for (const extended of [false, true]) {
		const fixture = await archiveFixture(extended ? "prefix" : "equal", extended);
		if (extended) writeFileSync(fixture.file, fixture.prefix); // synthetic other-machine prefix
		const imported = await unpackSession(fixture.archive, { cwd, sessionDir: fixture.sessionDir });
		assert.equal(imported.mode, "replaced", "equal/prefix history remains a normal import");
		assert.equal(imported.id, fixture.id, "a non-divergent import retains its identity");
		const copies = readdirSync(fixture.sessionDir).filter(name => name.endsWith(".jsonl"))
			.filter(name => readFileSync(join(fixture.sessionDir, name), "utf8").trim().split("\n")
				.map(line => JSON.parse(line)).find(entry => entry.type === "session")?.id === fixture.id);
		assert.equal(copies.length, 1, "publication leaves exactly one writable journal per imported identity");
		const manager = await SessionManager.open(imported.sessionFile);
		try {
			assert.equal(lastSessionTransfer(manager.getEntries())?.kind, "arrived");
			if (extended) assert.ok(JSON.stringify(manager.getEntries()).includes("incoming prefix"));
			// The archive's placements travel inside the journal, so a fresh
			// injector resumed on the imported history re-sends the exact bytes.
			assert.ok(createSessionDateCwdReminderJournal(manager).load().length > 0,
				"the imported journal must carry the archive's date/cwd placements");
			const request = reminderInjector(manager)
				.transform({ systemPrompt: ["fixture"], messages: manager.buildSessionContext().messages }, "2026-09-06", cwd);
			assert.equal(JSON.stringify(request.messages[0]), fixture.firstMessage,
				"a resumed import must keep its first provider message byte-identical");
		} finally {
			await manager.close();
		}
	}

	// A legacy archive carries no `date-cwd-reminder` entries: it is not an
	// archive whose journal merely records nothing for this branch. A same-ID
	// local copy's placements must not leak into it — and because a placement
	// is a transcript entry, such a local copy is a divergent history.
	const legacyFixture = await archiveFixture("legacy-journal", false, cwd, false);
	const archivedMembers = await readArchiveEntries({ path: legacyFixture.archive, format: "tar" });
	const archivedJournal = archivedMembers.get("session.jsonl");
	assert.ok(archivedJournal, "the legacy fixture archive must carry its journal member");
	assert.equal(journalEntriesOf(Buffer.from(archivedJournal).toString("utf8")).length, 0,
		"the legacy fixture archive must carry no date/cwd placements");
	const old = await SessionManager.open(legacyFixture.file);
	reminderInjector(old).transform({ systemPrompt: ["fixture"], messages: old.buildSessionContext().messages },
		"1900-01-01", "POISON GLOBAL CWD");
	assert.ok(JSON.stringify(createSessionDateCwdReminderJournal(old).load()).includes("POISON GLOBAL CWD"),
		"fixture must stage a same-ID local placement");
	await old.close();
	const poisonedBytes = readFileSync(legacyFixture.file, "utf8");
	assert.equal(journalEntriesOf(poisonedBytes).length, 1,
		"the same-ID local copy must hold its own placement before the import");
	const importedLegacy = await unpackSession(legacyFixture.archive, { cwd, sessionDir: legacyFixture.sessionDir });
	assert.equal(importedLegacy.mode, "forked",
		"a same-ID copy carrying placements the archive lacks is a divergent history");
	const legacy = await SessionManager.open(importedLegacy.sessionFile);
	try {
		assert.deepEqual(createSessionDateCwdReminderJournal(legacy).load(), [],
			"an archive without placements must not inherit a same-ID copy's journal");
		assert.equal(journalEntriesOf(readFileSync(importedLegacy.sessionFile, "utf8")).length, 0);
		const replay = reminderInjector(legacy)
			.transform({ systemPrompt: ["fixture"], messages: legacy.buildSessionContext().messages }, "2026-09-08", cwd);
		assert.ok(!JSON.stringify(replay.messages).includes("POISON GLOBAL CWD"));
		assert.match(JSON.stringify(replay.messages), /2026-09-08/);
		assert.equal(readFileSync(legacyFixture.file, "utf8"), poisonedBytes,
			"the import must not rewrite the diverged same-ID source");
	} finally {
		await legacy.close();
	}

	// Fail only after the destination journal is published. The importer must
	// restore prior bytes/artifacts (replacement) or remove all new output
	// (creation). Divergence reaches forkFrom and must also release its minted ID.
	for (const mode of ["created", "replaced", "forked"] as const) {
		const fixture = await archiveFixture(`publish-${mode}`);
		const destination = mode === "created" ? join(root, `destination-${mode}`) : fixture.sessionDir;
		mkdirSync(destination, { recursive: true });
		if (mode === "forked") {
			const local = await SessionManager.open(fixture.file);
			local.appendMessage({ role: "user", content: "divergent local history", timestamp: 6 });
			await local.flush();
			await local.close();
		}
		const before = snapshotTree(destination);
		const sourceBefore = snapshotTree(fixture.sessionDir);
		const originalPublish = FileSessionStorage.prototype.writeLinesAtomic;
		let failedPath: string | undefined;
		let failedId: string | undefined;
		FileSessionStorage.prototype.writeLinesAtomic = async function (file: string, lines: readonly string[], options: unknown) {
			await originalPublish.call(this, file, lines, options);
			if (!failedPath && file.startsWith(`${destination}/`)) {
				const header = lines.join("").trim().split("\n").map(line => JSON.parse(line)).find(entry => entry.type === "session");
				assert.ok(header?.id, "failure injection requires the actual destination journal header");
				failedPath = file;
				failedId = header.id;
				throw new Error(`forced-after-landing-${mode}`);
			}
		};
		try {
			await assert.rejects(() => unpackSession(fixture.archive, { cwd, sessionDir: destination }), /forced-after-landing/);
			assert.ok(failedPath && failedId, `${mode}: fixture must reach the real post-publication boundary`);
			assert.deepEqual(snapshotTree(destination), before, `${mode}: failed publication must roll back journal and artifacts`);
			assert.deepEqual(snapshotTree(fixture.sessionDir), sourceBefore, `${mode}: source/local history is untouched`);
			if (mode === "forked") assert.notEqual(failedId, fixture.id, "divergence must exercise a minted identity");
			const release = new FileSessionStorage().claimSession(failedId, failedPath, { exclusive: true });
			try {
				assert.ok(release, `${mode}: failure must release the landed or minted identity's claim`);
			} finally {
				release?.();
			}
		} finally {
			FileSessionStorage.prototype.writeLinesAtomic = originalPublish;
		}
	}

	const crossDevice = await archiveFixture("cross-device-artifacts");
	const originalTree = snapshotTree(crossDevice.sessionDir);
	const originalArtifacts = snapshotTree(crossDevice.artifacts);
	const originalRename = fs.rename;
	const originalCopy = fs.cp;
	const originalLink = fs.link;
	const originalCopyFile = fs.copyFile;
	let exdevs = 0;
	let artifactCopyFailures = 0;
	let failArtifact = true;
	const copyingImportedArtifact = (from: string, to: string) =>
		!from.startsWith(`${crossDevice.sessionDir}/`) && to.startsWith(`${crossDevice.sessionDir}/`) &&
		from.endsWith(`/${STAGED_ARTIFACT}`);
	/** The staged publication copies the artifact directory or, per entry, the artifact itself. */
	const stagedArtifactSource = (source: string) =>
		source.endsWith(`/${STAGED_ARTIFACT}`) || existsSync(join(source, STAGED_ARTIFACT));
	fs.rename = async (from, to) => {
		if (typeof from === "string" && typeof to === "string" &&
			!from.startsWith(`${crossDevice.sessionDir}/`) && to.startsWith(`${crossDevice.sessionDir}/`) &&
			stagedArtifactSource(from)) {
			exdevs++;
			throw Object.assign(new Error("synthetic cross-device artifact directory"), { code: "EXDEV" });
		}
		await originalRename(from, to);
	};
	fs.cp = async (from, to, options) => {
		const source = String(from);
		const target = String(to);
		if (failArtifact && !source.startsWith(`${crossDevice.sessionDir}/`) &&
			target.startsWith(`${crossDevice.sessionDir}/`) && stagedArtifactSource(source)) {
			await originalCopy(from, to, { ...options, filter: (entry, destination) => {
				if (copyingImportedArtifact(entry, destination)) {
					artifactCopyFailures++;
					throw Object.assign(new Error("forced archive artifact copy failure"), { code: "EIO" });
				}
				return options?.filter?.(entry, destination) ?? true;
			} });
			return;
		}
		await originalCopy(from, to, options);
	};
	// The historical merge fallback used link/copyFile instead of cp. Fail
	// the same artifact there, so a warning-and-success regression is visible.
	fs.link = async (from, to) => {
		if (copyingImportedArtifact(String(from), String(to))) {
			throw Object.assign(new Error("synthetic cross-device artifact"), { code: "EXDEV" });
		}
		await originalLink(from, to);
	};
	fs.copyFile = async (from, to, flags) => {
		if (failArtifact && copyingImportedArtifact(String(from), String(to))) {
			artifactCopyFailures++;
			throw Object.assign(new Error("forced archive artifact copy failure"), { code: "EIO" });
		}
		await originalCopyFile(from, to, flags);
	};
	try {
		await assert.rejects(() => unpackSession(crossDevice.archive, { cwd, sessionDir: crossDevice.sessionDir }));
		assert.ok(exdevs > 0 && artifactCopyFailures > 0, "fixture must fail the real cross-device artifact copy");
		assert.deepEqual(snapshotTree(crossDevice.sessionDir), originalTree,
			"incomplete staged artifact publication fails and restores all prior journal/artifact bytes");
		failArtifact = false;
		const imported = await unpackSession(crossDevice.archive, { cwd, sessionDir: crossDevice.sessionDir });
		const importedManager = await SessionManager.open(imported.sessionFile);
		try {
			assert.deepEqual(snapshotTree(importedManager.getArtifactsDir()), originalArtifacts,
				"positive EXDEV import must publish every archive artifact byte-for-byte");
			// The placements live in the journal member, so the staged move
			// publishes them with the session: the moved history keeps the
			// exact first request it was sent with.
			const placements = createSessionDateCwdReminderJournal(importedManager).load();
			assert.ok(placements.length > 0, "the moved journal must carry its date/cwd placements");
			assert.equal(journalEntriesOf(readFileSync(imported.sessionFile, "utf8")).length, placements.length,
				"every journaled placement must survive the staged publication");
			const request = reminderInjector(importedManager)
				.transform({ systemPrompt: ["fixture"], messages: importedManager.buildSessionContext().messages }, "2026-09-06", cwd);
			assert.equal(JSON.stringify(request.messages[0]), crossDevice.firstMessage,
				"the moved session's first provider request must keep messages[0] byte-identical");
		} finally {
			await importedManager.close();
		}
	} finally {
		fs.rename = originalRename;
		fs.cp = originalCopy;
		fs.link = originalLink;
		fs.copyFile = originalCopyFile;
	}

	// Inspection is intentionally stale here: another public command publishes
	// the departure after open(). Writable admission must re-read under claim.
	const stale = await archiveFixture("stale-inspection");
	const staleManager = await SessionManager.open(stale.file);
	await markSessionMoved(stale.file, "completed transfer after raw open");
	const staleBytes = readFileSync(stale.file, "utf8");
	try {
		assert.equal(lastSessionTransfer(staleManager.getEntries()), undefined, "fixture must start with stale cached provenance");
		await staleManager.adoptForWrite();
		assert.notEqual(staleManager.getSessionId(), stale.id, "admission must fork the newly departed source");
		await assert.rejects(() => markSessionMoved(staleManager.getSessionFile(), "racing second departure"),
			/live.*(writer|process)|another live|owns it/i,
			"admission retains authority: a departure cannot enter before the first writable append");
		staleManager.appendMessage({ role: "user", content: "first admitted write", timestamp: 7 });
		await staleManager.flush();
		assert.equal(readFileSync(stale.file, "utf8"), staleBytes);
	} finally {
		await staleManager.close();
	}

	const removedCwd = join(root, "removed-worktree");
	mkdirSync(removedCwd);
	const relocated = await archiveFixture("removed-worktree-history", false, removedCwd);
	await markSessionMoved(relocated.file, "remote relocation destination");
	const departedTree = snapshotTree(relocated.sessionDir);
	rmSync(removedCwd, { recursive: true });
	const continued = await SessionManager.openRelocated(relocated.file, removedCwd, cwd, join(root, "relocated"));
	try {
		assert.notEqual(continued.getSessionId(), relocated.id, "relocation must adopt before moving a departed source");
		assert.equal(continued.getCwd(), cwd);
		assert.deepEqual(snapshotTree(relocated.sessionDir), departedTree, "removed-worktree resume cannot relocate the departed source");
	} finally {
		await continued.close();
	}

	const oldCwd = join(root, "inode-before");
	const renamedCwd = join(root, "inode-after");
	mkdirSync(oldCwd);
	const recent = SessionManager.create(oldCwd);
	recent.appendMessage({ role: "user", content: "inode breadcrumb history", timestamp: 8 });
	await recent.ensureOnDisk();
	await recent.flush();
	const recentFile = recent.getSessionFile();
	const recentId = recent.getSessionId();
	await recent.close();
	await markSessionMoved(recentFile, "inode destination");
	const recentBytes = readFileSync(recentFile, "utf8");
	const breadcrumb = await readTerminalBreadcrumbEntry();
	assert.equal(breadcrumb?.sessionFile, recentFile, "positive inode recovery requires this terminal's source breadcrumb");
	assert.equal(breadcrumb?.cwd, oldCwd);
	assert.ok(breadcrumb?.cwdIdentity, "the actual breadcrumb writer must capture the source cwd inode before rename");
	renameSync(oldCwd, renamedCwd);
	const inodeResume = await SessionManager.continueRecent(renamedCwd);
	try {
		assert.notEqual(inodeResume.getSessionId(), recentId, "inode recovery must fork a departed history");
		assert.ok(JSON.stringify(inodeResume.getEntries()).includes("inode breadcrumb history"),
			"positive inode recovery must resume history rather than silently create an empty session");
		assert.equal(readFileSync(recentFile, "utf8"), recentBytes, "inode relocation must not rewrite or remove the departed source");
	} finally {
		await inodeResume.close();
	}

	const moved = await archiveFixture("moved-source");
	await markSessionMoved(moved.file, "fixture destination");
	const departedBytes = readFileSync(moved.file, "utf8");
	const inspection = await SessionManager.open(moved.file);
	assert.equal(inspection.getSessionId(), moved.id, "raw inspection retains the departed identity");
	await inspection.setSessionFile(moved.file, { writable: false });
	assert.equal(inspection.getSessionId(), moved.id, "explicit read-only adoption cannot fork");
	await inspection.close();
	assert.equal(readFileSync(moved.file, "utf8"), departedBytes, "inspection leaves departed bytes untouched");

	const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
	const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
	const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
	const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
	registerMockApi("transfer-authority");
	const agentDir = join(root, "agent");
	const settings = await Settings.loadIsolated({ cwd, agentDir, overrides: { "memory.backend": "off" } });
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("mock", "synthetic");
	const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });
	const { session } = await createAgentSession({
		cwd, agentDir, settings, authStorage, modelRegistry,
		model: createMockModel({ responses: [] }), getApiKey: () => "synthetic",
		sessionManager: SessionManager.create(cwd, join(root, "active")),
		skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
		disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
		preloadedCustomToolPaths: [], skipPythonPreflight: true, toolNames: [], restrictToolNames: true,
	});
	try {
		session.setSessionBeforeSwitchReconciler(null);
		session.setSessionSwitchReconciler(null);
		const foreignCwd = join(root, "foreign-project");
		mkdirSync(foreignCwd);
		const canceled = await archiveFixture("cancel-adoption", false, foreignCwd);
		await markSessionMoved(canceled.file, "canceled destination");
		const canceledTree = snapshotTree(canceled.sessionDir);
		const originalId = session.sessionManager.getSessionId();
		session.sessionManager.appendMessage({ role: "user", content: "owned outgoing history", timestamp: 9 });
		await session.sessionManager.ensureOnDisk();
		await session.sessionManager.flush();
		const outgoingFile = session.sessionManager.getSessionFile();
		const outgoingBytes = readFileSync(outgoingFile, "utf8");
		let cwdPrompts = 0;
		const deciding = Promise.withResolvers<void>();
		const rejectCwd = Promise.withResolvers<boolean>();
		const switching = session.switchSession(canceled.file, { onCwdChange: async () => {
			cwdPrompts++;
			deciding.resolve();
			return rejectCwd.promise;
		} });
		const settledSwitch = switching.then((value: boolean) => ({ value }), (error: unknown) => ({ error }));
		try {
			await Promise.race([
				deciding.promise,
				settledSwitch.then(result => { throw new Error(`switch ended before held cwd decision: ${JSON.stringify(result)}`); }),
			]);
			await assert.rejects(() => markSessionMoved(outgoingFile, "departure during cancellable switch"),
				/live.*(writer|process)|another live|owns it/i,
				"outgoing authority must remain held while rollback can restore its cached transcript");
			assert.equal(readFileSync(outgoingFile, "utf8"), outgoingBytes);
		} finally {
			rejectCwd.resolve(false);
			await settledSwitch;
		}
		assert.equal(await switching, false);
		assert.equal(cwdPrompts, 1, "fixture must cancel the actual cross-cwd adoption");
		assert.equal(session.sessionManager.getSessionId(), originalId);
		assert.deepEqual(snapshotTree(canceled.sessionDir), canceledTree, "canceled switch leaves no orphan fork or artifacts");
		session.sessionManager.appendMessage({ role: "user", content: "safe append after rollback", timestamp: 10 });
		await session.sessionManager.flush();
		assert.equal(lastSessionTransfer(session.sessionManager.getEntries()), undefined,
			"a canceled switch must not reactivate an unowned departed source");
		await assert.rejects(() => markSessionMoved(outgoingFile, "departure after rollback"),
			/live.*(writer|process)|another live|owns it/i);

		const originalFlush = SessionManager.prototype.flush;
		let noticeFailed = false;
		SessionManager.prototype.flush = async function () {
			await originalFlush.call(this);
			if (!noticeFailed && lastSessionTransfer(this.getEntries())?.kind === "forked") {
				noticeFailed = true;
				throw new Error("forced-adoption-notice-publication");
			}
		};
		try {
			await assert.rejects(() => session.switchSession(canceled.file, { onCwdChange: async () => true }),
				/forced-adoption-notice-publication/);
			assert.equal(noticeFailed, true, "fixture must fail after the fork and notice have landed");
			assert.equal(session.sessionManager.getSessionId(), originalId);
			assert.deepEqual(snapshotTree(canceled.sessionDir), canceledTree, "failed adoption publication rolls back all owned output");
			const release = new FileSessionStorage().claimSession(canceled.id, canceled.file, { exclusive: true });
			try { assert.ok(release, "failed adoption must release its source claim"); } finally { release?.(); }
		} finally {
			SessionManager.prototype.flush = originalFlush;
		}
		assert.equal(await session.switchSession(moved.file), true, "actual in-process SDK switch must adopt the target");
		assert.notEqual(session.sessionManager.getSessionId(), moved.id, "writable switch must fork a departed ID");
		assert.notEqual(session.sessionManager.getSessionFile(), moved.file);
		assert.equal(lastSessionTransfer(session.sessionManager.getEntries())?.kind, "forked");
		session.sessionManager.appendMessage({ role: "user", content: "write on adopted fork", timestamp: 5 });
		await session.sessionManager.flush();
		assert.equal(readFileSync(moved.file, "utf8"), departedBytes, "a switched writer cannot append to the departed source");

		// Q1 (18.18.0 worker mode): ownership across threads. A worker thread has its own module
		// state, so the per-thread lease map cannot see main's claim; only the OS lease can. While
		// one thread owns a session the other must get an explicit refusal (adoption, claim, pack),
		// never a sibling fork, a new ID, a moved path, or journal bytes from a second writer.
		const { workerPoolForTests } = await import("./worker-pool-for-tests.ts");
		interface ProbeLink { call(method: "probe", request: Record<string, unknown>): Promise<Record<string, unknown>> }
		const crossThread = await archiveFixture("cross-thread", false, cwd, false, false);
		const crossArchive = join(root, "cross-thread-probe.omp-session");
		const crossTree = () => snapshotTree(crossThread.sessionDir);
		const pool = await workerPoolForTests({ entry: new URL("./worker-session-lease-probe.ts", import.meta.url) });
		try {
			const placement = await pool.acquireWorker();
			try {
				const peer: unknown = placement.worker;
				assert.ok(typeof peer === "object" && peer !== null && "link" in peer, "pool must place the probe on a real worker thread");
				const link = peer.link as ProbeLink;
				const probe = (request: Record<string, unknown>) => link.call("probe", request);
				const refused = (result: Record<string, unknown>, what: string) => {
					assert.equal(result.outcome, what === "claim" ? "denied" : "refused", `worker ${what} must be refused: ${JSON.stringify(result)}`);
					if (result.outcome === "refused") assert.match(String(result.message), /live|another|owns|Cannot/i);
				};

				// Main owns; the worker is refused on every route that could take or fork the session.
				const owner = await SessionManager.open(crossThread.file);
				try {
					await owner.adoptForWrite();
					owner.appendMessage({ role: "user", content: "main owns the session", timestamp: 20 });
					await owner.flush();
					const ownedBytes = readFileSync(crossThread.file, "utf8");
					const ownedTree = crossTree();
					refused(await probe({ op: "adopt", file: crossThread.file }), "adopt");
					refused(await probe({ op: "claim", id: crossThread.id, file: crossThread.file, exclusive: true }), "claim");
					refused(await probe({ op: "claim", id: crossThread.id, file: crossThread.file, exclusive: false }), "claim");
					refused(await probe({ op: "pack", file: crossThread.file, archive: crossArchive }), "pack");
					assert.equal(owner.getSessionId(), crossThread.id, "the owner keeps its session ID");
					assert.equal(owner.getSessionFile(), crossThread.file, "the owner keeps its session path");
					assert.equal(readFileSync(crossThread.file, "utf8"), ownedBytes, "a refused worker leaves the journal untouched");
					assert.deepEqual(crossTree(), ownedTree, "a refused worker creates no sibling file");
					assert.equal(existsSync(crossArchive), false, "a refused worker pack publishes no archive");
				} finally {
					await owner.close();
				}

				// Main released; the worker adopts the same ID at the same path, still without a sibling.
				const treeAtRelease = crossTree();
				const adopted = await probe({ op: "adopt", file: crossThread.file });
				assert.deepEqual({ ...adopted }, { outcome: "granted", id: crossThread.id, file: crossThread.file },
					"revival on the worker keeps the session ID and path");
				assert.deepEqual(crossTree(), treeAtRelease, "worker revival creates no sibling file");

				// The worker owns; main is refused with the explicit error, and the files stay put.
				const workerBytes = readFileSync(crossThread.file, "utf8");
				const contender = await SessionManager.open(crossThread.file);
				try {
					await assert.rejects(() => contender.adoptForWrite(), /another writer|transfer owns|live/i,
						"main adoption must be refused while the worker holds the lease");
				} finally {
					await contender.close();
				}
				assert.equal(new FileSessionStorage().claimSession(crossThread.id, crossThread.file, { exclusive: true }), null,
					"main exclusive claim must be denied while the worker holds the lease");
				await assert.rejects(() => packSession(crossThread.file, crossArchive), /live omp process|another/i);
				assert.equal(readFileSync(crossThread.file, "utf8"), workerBytes, "main cannot write over the worker's journal");
				assert.deepEqual(crossTree(), treeAtRelease, "a refused main creates no sibling file");

				// After the worker lets go, main takes the same session again.
				assert.equal((await probe({ op: "release" })).outcome, "released");
				const retake = new FileSessionStorage().claimSession(crossThread.id, crossThread.file, { exclusive: true });
				try { assert.ok(retake, "main must acquire once the worker released the lease"); } finally { retake?.(); }
			} finally {
				placement.release();
			}
		} finally {
			pool.dispose();
		}
	} finally {
		await session.dispose();
		authStorage.close();
	}
	console.log(`PASS session transfer authority (${plan.version}): claim-before-read, transactional imports/adoption, journaled date/cwd reminders and relocation`);
} finally {
	rmSync(root, { recursive: true, force: true });
}
