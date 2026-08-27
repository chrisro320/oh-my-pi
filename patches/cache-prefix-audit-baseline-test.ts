// Regression cases for baseline selection. Case 2 is the one an earlier
// implementation got wrong: a side-channel request APPENDS virtual messages, so
// it ties the real baseline on shared-prefix length and newest-first ordering
// then picks it, reporting a phantom rewrite.

interface Fp {
   at: string;
   pid: number;
   model: string;
   system: string[];
   tools: string;
   messages: string[];
}

const sharedPrefix = (a: Fp, b: Fp): number => {
   if (a.tools !== b.tools) return -1;
   for (let i = 0; i < Math.max(a.system.length, b.system.length); i++) {
      if (a.system[i] !== b.system[i]) return -1;
   }
   const shared = Math.min(a.messages.length, b.messages.length);
   let i = 0;
   while (i < shared && a.messages[i] === b.messages[i]) i++;
   return i;
};

/** Score-only selection — the defective version, kept to show the difference. */
const naiveBaseline = (candidates: Fp[], next: Fp): Fp | undefined => {
   let best: Fp | undefined;
   let bestScore = -1;
   for (const c of candidates) {
      const score = sharedPrefix(c, next);
      if (score > bestScore) {
         bestScore = score;
         best = c;
      }
   }
   return best;
};

const bestBaseline = (candidates: Fp[], next: Fp): Fp | undefined => {
   let best: Fp | undefined;
   let bestScore = -1;
   let bestIsFullPrefix = false;
   for (const c of candidates) {
      const score = sharedPrefix(c, next);
      if (score < 0) continue;
      const isFullPrefix = score === c.messages.length;
      const better =
         best === undefined ||
         (isFullPrefix && !bestIsFullPrefix) ||
         (isFullPrefix === bestIsFullPrefix && score > bestScore);
      if (better) {
         bestScore = score;
         bestIsFullPrefix = isFullPrefix;
         best = c;
      }
   }
   return best;
};

const classify = (prev: Fp, next: Fp): string => {
   const shared = Math.min(prev.messages.length, next.messages.length);
   for (let i = 0; i < shared; i++) {
      if (prev.messages[i] !== next.messages[i]) return `HISTORY_REWRITE@${i}`;
   }
   if (next.messages.length > prev.messages.length) return `APPEND_ONLY@${shared}`;
   if (next.messages.length < prev.messages.length) return `TRUNCATED@${shared}`;
   return "IDENTICAL";
};

const history = (n: number): string[] => Array.from({ length: n }, (_, i) => `user:h${i}`);
const base = { pid: 1, model: "claude-opus-5", system: ["s0", "s1"], tools: "t" };

// `bestBaseline` is an ANNOTATION source, never the verdict. Cases 1-3 assert it
// identifies the real predecessor behind virtual-tail noise; case 6 asserts that
// using it as the verdict would have HIDDEN a regression, which is why the
// verdict stays measured against the immediate predecessor.
let failures = 0;
const check = (label: string, got: string, want: string): void => {
   const ok = got === want;
   if (!ok) failures++;
   console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n        got=${got} want=${want}`);
};

// ---- Case 1: side request REPLACES the tail (same length) ----
{
   const p: Fp = { ...base, at: "P", messages: history(325) };
   const v: Fp = { ...base, at: "V", messages: [...history(324), "user:VIRTUAL"] };
   const r: Fp = { ...base, at: "R", messages: history(327) };
   // recent is newest-first: the side request is the most recent.
   const chosen = bestBaseline([v, p], r);
   check("replace-tail: picks real baseline", `${chosen?.at}:${classify(chosen!, r)}`, "P:APPEND_ONLY@325");
}

// ---- Case 2: side request APPENDS virtual messages (ties on score) ----
{
   const p: Fp = { ...base, at: "P", messages: history(323) };
   const v: Fp = { ...base, at: "V", messages: [...history(323), "user:V1", "user:V2", "user:V3"] };
   const r: Fp = { ...base, at: "R", messages: history(325) };
   console.log(`  scores: P=${sharedPrefix(p, r)} V=${sharedPrefix(v, r)} (tie)`);
   const naive = naiveBaseline([v, p], r);
   console.log(`  naive picks ${naive?.at} -> ${classify(naive!, r)}`);
   const chosen = bestBaseline([v, p], r);
   check("append-tail: picks real baseline", `${chosen?.at}:${classify(chosen!, r)}`, "P:APPEND_ONLY@323");
}

// ---- Case 3: resume where the LAST request before exit was a keepalive ----
{
   const p: Fp = { ...base, at: "P", pid: 1, messages: history(323) };
   const v: Fp = { ...base, at: "V", pid: 1, messages: [...history(323), "user:KEEPALIVE"] };
   const r: Fp = { ...base, at: "R", pid: 2, messages: history(324) };
   // Persisted candidate set, newest-first, as restored after resume.
   const chosen = bestBaseline([v, p], r);
   check("resume after keepalive", `${chosen?.at}:${classify(chosen!, r)}`, "P:APPEND_ONLY@323");
}

// ---- Case 4: a REAL near-tail rewrite must still be reported ----
{
   const p: Fp = { ...base, at: "P", messages: history(327) };
   const flipped = [...history(327)];
   flipped[325] = "model:FLIPPED";
   const r: Fp = { ...base, at: "R", messages: flipped };
   const chosen = bestBaseline([p], r);
   check("real rewrite near tail", `${chosen?.at}:${classify(chosen!, r)}`, "P:HISTORY_REWRITE@325");
}

// ---- Case 5: a different model shares no prefix and must not be chosen ----
{
   const p: Fp = { ...base, at: "P", messages: history(300) };
   const other: Fp = { ...base, at: "OTHER", system: ["different"], messages: history(400) };
   const r: Fp = { ...base, at: "R", messages: history(302) };
   const chosen = bestBaseline([other, p], r);
   check("foreign system prompt rejected", `${chosen?.at}:${classify(chosen!, r)}`, "P:APPEND_ONLY@300");
}

// ---- Case 6: annotation must NOT become the verdict ----
// An OLD candidate can happen to be a clean prefix of the current request while
// the request is a genuine regression against its actual predecessor. Measuring
// the verdict from the best-matching candidate would report append-only and lose
// the regression entirely — which is why the verdict uses the predecessor and
// `bestBaseline` only annotates.
{
   const old: Fp = { ...base, at: "OLD", messages: history(100) };
   // Predecessor advanced to 105.
   const predecessor: Fp = { ...base, at: "PRED", messages: history(105) };
   // Current request rolled BACK to 102: a real regression against PRED.
   const now: Fp = { ...base, at: "NOW", messages: history(102) };

   const verdict = classify(predecessor, now);
   check("verdict vs predecessor keeps regression", verdict, "TRUNCATED@102");

   const annotated = bestBaseline([predecessor, old], now);
   check(
      "best-matching candidate would have masked it",
      `${annotated?.at}:${classify(annotated!, now)}`,
      "OLD:APPEND_ONLY@100",
   );
   console.log("        ^ exactly why the annotation never overrides the verdict");
}


console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exit(1);
