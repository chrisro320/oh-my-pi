// Live pre-release check of the rebuilt pi-natives Escape monitor against the
// staging runtime. Only targets the scratch xterm titled "omp-cu-scratch".
// Usage: bun live-escape-test.ts <runtime-node_modules/@oh-my-pi> type|escape
// type:   run right after physical typing; expects the text to land and the
//         grant to stay active (the old addon cancels here).
// escape: holds Shift for 20 s; press physical Escape meanwhile; expects the
//         hold to fail and the grant to be revoked.
const [nm, mode] = process.argv.slice(2);
if (!nm || (mode !== "type" && mode !== "escape")) throw new Error("usage: <nm> type|escape");
const { createDesktopSession } = await import(`${nm}/pi-natives/native/desktop.js`);
const session = await createDesktopSession({ display: process.env.DISPLAY });
const windows = await session.listWindows();
const target = windows.find((w: { title: string }) => w.title === "omp-cu-scratch");
if (!target) throw new Error("scratch xterm 'omp-cu-scratch' not found");
const result: Record<string, unknown> = { mode, window: target.id, start: new Date().toISOString() };
result.acquire = await session.acquireControl();
try {
	if (mode === "type") await session.typeText(target.id, "echo native-fix-ok", { takeover: true });
	else await session.holdKeys(target.id, ["shift"], { duration: 20, takeover: true });
	result.op = "ok";
} catch (error) {
	result.op = String(error);
}
result.stateAfter = session.controlState();
session.releaseControl();
await session.close();
result.end = new Date().toISOString();
console.log(JSON.stringify(result));
