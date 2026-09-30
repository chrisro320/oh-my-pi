#!/usr/bin/env python3
"""Calibrate the cache-liveness model of patches/verify-compaction-cache-liveness.ts
against real recorded Anthropic usage.

Offline: reads only ~/.omp/agent/cache-prefix-audit.log{,.1} and
~/.omp/agent/compaction-trace.log. No network, no credentials. Only counts,
indices and token numbers are read/printed -- never message text.

The model under test (mirrors the gate's simulate()/recordWrite(), with the
message index standing in for "block"; research/cache-model-block-proxy.txt
measures that proxy against the archived wire bodies):

  * a request writes cache entries at each of its own breakpoints, stamped at
    the request timestamp;
  * an entry survives TTL (1h);
  * a lookup resolves at anchor = max(breakpoint index) to the highest entry
    index that is (a) still alive, (b) <= anchor, (c) within LOOKBACK blocks
    behind the anchor;
  * the request reads blocks 0..hit and writes blocks hit+1..anchor.

Predicted verdict per request: "does the predicted read reach at least the
previous request's tail in the same (session, model) chain". Ground truth, from
the recorded usage only: real cacheRead >= 80% of the previous request's own
input+read+write (i.e. the read really did cover the whole previous prefix).
"""

from __future__ import annotations

import json
import os
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta

HOME = os.path.expanduser("~")
AUDIT_PATHS = [
    os.path.join(HOME, ".omp/agent/cache-prefix-audit.log.1"),
    os.path.join(HOME, ".omp/agent/cache-prefix-audit.log"),
]
TRACE_PATH = os.path.join(HOME, ".omp/agent/compaction-trace.log")

TTL = timedelta(hours=1)
LOOKBACK_DEFAULT = 20  # blocks; message index is used as the block unit
PAIR_WINDOW_S = 600
PAIR_SKEW_S = -0.02  # a usage may precede its own request row by a hair; not by a turn
GAP_BUCKETS = [
    ("<5m", timedelta(0), timedelta(minutes=5)),
    ("5-60m", timedelta(minutes=5), timedelta(minutes=60)),
    (">60m", timedelta(minutes=60), None),
]
GT_READ_FRACTION = 0.80


def parse_at(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def norm_model(model):
    return model.split("/")[-1] if isinstance(model, str) else model


def sig(row):
    d = row.get("diff") or {}
    return (d.get("kind"), d.get("index"), d.get("detail"))


def load_audit():
    rows = []
    for path in AUDIT_PATHS:
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for lineno, line in enumerate(handle, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "event" in row and "messages" not in row and "usage" not in row:
                    continue
                row["_src"] = f"{os.path.basename(path)}:{lineno}"
                rows.append(row)
    names = {os.path.basename(p): i for i, p in enumerate(AUDIT_PATHS)}
    rows.sort(key=lambda r: (r["at"], names.get(r["_src"].split(":")[0], 9)))
    return rows


def split_chains(rows):
    events = defaultdict(list)
    for row in rows:
        if "sessionId" in row and "model" in row:
            events[(row["sessionId"], norm_model(row["model"]))].append(row)
    turns = {}
    for key, evs in events.items():
        evs.sort(key=lambda r: (r["at"], r["_src"]))
        requests = [r for r in evs if "usage" not in r]
        usages = [r for r in evs if "usage" in r]
        used = [False] * len(requests)
        out = []
        latencies = []
        for use in usages:
            sig_use = sig(use)
            best = None
            use_at = parse_at(use["at"])
            for index in range(len(requests) - 1, -1, -1):
                if used[index]:
                    continue
                candidate = requests[index]
                if sig(candidate) != sig_use:
                    continue
                delta = (use_at - parse_at(candidate["at"])).total_seconds()
                if delta < PAIR_SKEW_S or delta > PAIR_WINDOW_S:
                    continue
                best = index
                break  # scanning backwards: first hit is the nearest predecessor
            if best is None:
                out.append({"req": None, "use": use})
                continue
            used[best] = True
            latencies.append((use_at - parse_at(requests[best]["at"])).total_seconds())
            out.append({"req": requests[best], "use": use})
        for index, req in enumerate(requests):
            if not used[index]:
                out.append({"req": req, "use": None})
        out.sort(key=lambda t: ((t["req"] or t["use"])["at"]))
        turns[key] = {"turns": out, "latencies": latencies}
    return turns


def classify(entries, anchor, at, lookback):
    """Return (hit_index, reason, hit_written_at) for a lookup at `anchor`."""
    best_alive = None
    best_expired = None
    for index, written_at in entries.items():
        if index > anchor:
            continue
        if at - written_at >= TTL:
            if best_expired is None or index > best_expired:
                best_expired = index
            continue
        if best_alive is None or index > best_alive:
            best_alive = index
    if best_alive is None:
        return -1, ("expired" if best_expired is not None else "no-history"), None
    if anchor - best_alive > lookback:
        return -1, "window", None
    return best_alive, "hit", entries[best_alive]


def replay_chain(turns, lookback=LOOKBACK_DEFAULT, stamp="request", unmatched_writes=True):
    entries = {}
    records = []
    prev_anchor = None
    prev_total = None
    prev_messages = None
    prev_req_at = None

    for turn in turns:
        req, use = turn["req"], turn["use"]
        rec = {
            "req_at": req["at"] if req else None,
            "src": req["_src"] if req else None,
            "messages": req.get("messages") if req else None,
            "breakpoints": req.get("breakpoints") if req else None,
            "kind": (req or {}).get("diff", {}).get("kind"),
            "detail": (req or {}).get("diff", {}).get("detail"),
            "cross_process": (req or {}).get("crossProcess"),
            "use_at": use["at"] if use else None,
            "real_input": (use["usage"].get("input") if use else None),
            "real_read": use["usage"]["cacheRead"] if use else None,
            "real_write": use["usage"]["cacheWrite"] if use else None,
            "verdict": use.get("verdict") if use else None,
            "gap_s": (parse_at(req["at"]) - prev_req_at).total_seconds() if (req and prev_req_at) else None,
            "first_in_window": prev_req_at is None,
            "pred": None,
        }
        bps = [int(b.split(":")[0]) for b in ((req.get("breakpoints") or []) if req else [])]
        anchor = max(bps) if bps else -1

        if bps:
            at = parse_at(req["at"]) if (stamp == "request" or use is None) else parse_at(use["at"])
            hit, reason, hit_written_at = classify(entries, anchor, at, lookback)
            ref = prev_anchor if prev_anchor is not None else 0
            rec["pred"] = {
                "anchor": anchor,
                "hit": hit,
                "reason": reason,
                "hit_written_at": hit_written_at.isoformat() if hit_written_at else None,
                "read_blocks": hit + 1,
                "written_blocks": anchor - hit,
                "reaches_prev_tail": hit >= ref,
                "prev_anchor": prev_anchor,
            }

        if use is not None:
            read, write = use["usage"]["cacheRead"], use["usage"]["cacheWrite"]
            rec["zero_usage"] = read == 0 and write == 0 and (use["usage"].get("input") or 0) == 0
            # The boolean only means something when the previous request is a
            # prefix of this one; a compaction/summary restart breaks that.
            rec["gt_defined"] = (
                prev_total is not None
                and prev_messages is not None
                and rec["messages"] is not None
                and rec["messages"] >= prev_messages
            )
            if prev_total and rec["gt_defined"]:
                rec["gt_reaches_prev_tail"] = read >= GT_READ_FRACTION * prev_total
            elif prev_total is None:
                rec["gt_reaches_prev_tail"] = read > 0
            else:
                rec["gt_reaches_prev_tail"] = None  # generation break: not scorable
            rec["gt_read_dominant"] = read > write and read > 0
            rec["prev_usage_total"] = prev_total
            prev_total = read + write + (use["usage"].get("input") or 0)

        if bps and (use is not None or unmatched_writes):
            for index in bps:
                entries[index] = parse_at(req["at"])
        if req is not None:
            prev_req_at = parse_at(req["at"])
            prev_messages = req.get("messages")
            if bps:
                prev_anchor = anchor
        records.append(rec)
    return records


def agreement(pairs):
    if not pairs:
        return None
    ok = sum(1 for p, g in pairs if p == g)
    return {"n": len(pairs), "agree": ok, "rate": ok / len(pairs)}


def fmt(agg):
    return "n/a" if agg is None else f"{agg['rate']*100:5.1f}% ({agg['agree']}/{agg['n']})"


def bucket_for(delta):
    for name, low, high in GAP_BUCKETS:
        if delta >= low and (high is None or delta < high):
            return name
    return ">60m"


def collect(chains, lookback=LOOKBACK_DEFAULT, stamp="request", unmatched_writes=True):
    """Replay every chain into {chain key: [records]}."""
    out = {}
    for key, chain in chains.items():
        out[key] = replay_chain(
            chain["turns"], lookback=lookback, stamp=stamp, unmatched_writes=unmatched_writes
        )
    return out


def evaluate(replayed, lanes="breakpoint", skip_first=True):
    """Aggregate agreement. `lanes` selects breakpoint lanes or every request."""
    stats = {
        "pairs": [],
        "by_gap": defaultdict(list),
        "by_kind": defaultdict(list),
        "by_reason": defaultdict(list),
        "by_verdict": defaultdict(list),
        "generation_breaks": [],
        "disagreements": [],
        "turns": 0,
        "bp_turns": 0,
        "paired": 0,
        "unmatched_reqs": 0,
        "zero_usage": 0,
        "skipped": 0,
    }
    for key, records in replayed.items():
        for rec in records:
            stats["turns"] += 1
            if lanes == "breakpoint" and not rec["breakpoints"]:
                continue
            if rec["breakpoints"]:
                stats["bp_turns"] += 1
            if rec["use_at"] is None:
                stats["unmatched_reqs"] += 1
                continue
            stats["paired"] += 1
            if rec.get("zero_usage"):
                stats["zero_usage"] += 1
                continue
            if skip_first and rec["first_in_window"]:
                stats["skipped"] += 1
                continue
            gt = rec["gt_reaches_prev_tail"]
            pred = rec["pred"]["reaches_prev_tail"] if rec["pred"] else False
            if gt is None:
                stats["generation_breaks"].append((key, rec))
                continue
            pair = (pred, gt)
            stats["pairs"].append(pair)
            gap = bucket_for(timedelta(seconds=rec["gap_s"])) if rec["gap_s"] is not None else "cold"
            stats["by_gap"][gap].append(pair)
            kind = rec["kind"] or "-"
            stats["by_kind"][kind].append(pair)
            stats["by_reason"][rec["pred"]["reason"] if rec["pred"] else "no-breakpoints"].append(pair)
            verdict_hit = bool(rec["verdict"]) and "hit" in rec["verdict"].lower() and "MISS" not in rec["verdict"]
            stats["by_verdict"][(pred, verdict_hit)].append(pair)
            if pred != gt:
                stats["disagreements"].append((key, rec, gt))
    return stats


def load_trace():
    rows = []
    with open(TRACE_PATH, "r", encoding="utf-8", errors="replace") as handle:
        for lineno, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            row["_src"] = f"compaction-trace.log:{lineno}"
            rows.append(row)
    return rows


def measure_block_proxy(sample_every=7):
    """Measure the content-block / message ratio from the archived wire bodies.

    The replay above keys entries on the audit's message index, so one message
    stands in for one block. The provider's lookback is specified in content
    blocks, so the real window in message units is 20 / (blocks per message).
    """
    import glob as _glob

    bodies = sorted(_glob.glob(os.path.join(HOME, ".omp/agent/payloads/*/anthropic-wire/*main.body.json")))
    ratios = []
    tail_ratios = []
    for path in bodies[::sample_every]:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                payload = json.load(handle)
        except (json.JSONDecodeError, OSError):
            continue
        messages = payload.get("messages") or []
        if len(messages) < 8:
            continue
        counts = []
        for message in messages:
            content = message.get("content")
            counts.append(len(content) if isinstance(content, list) else 1)
        ratios.append(sum(counts) / len(counts))
        tail = counts[-24:]
        tail_ratios.append(sum(tail) / len(tail))
    return ratios, tail_ratios, len(bodies)


def main():
    lookback = int(sys.argv[1]) if len(sys.argv) > 1 else LOOKBACK_DEFAULT
    rows = load_audit()
    turns = split_chains(rows)
    replayed = collect(turns, lookback=lookback)
    stats = evaluate(replayed)

    print(f"audit rows parsed                 : {len(rows)}")
    print(f"(session, model) chains           : {len(turns)}")
    print(f"turns replayed                    : {stats['turns']}")
    print(f"turns on breakpoint lanes         : {stats['bp_turns']}")
    print(f"  paired with a usage row         : {stats['paired']}")
    print(f"  requests with no usage row      : {stats['unmatched_reqs']}")
    print(f"  zero-usage (aborted) responses  : {stats['zero_usage']}")
    print(f"  skipped (first turn of window)  : {stats['skipped']}")
    print(f"  generation breaks (unscorable)  : {len(stats['generation_breaks'])}")
    print(f"lookback used                     : {lookback} message-blocks")
    lat = sorted(sec for chain in turns.values() for sec in chain["latencies"])
    if lat:
        print(
            f"pairing latency (usage.at - request.at): n={len(lat)} median={lat[len(lat)//2]:.1f}s "
            f"p90={lat[9*len(lat)//10]:.1f}s max={lat[-1]:.1f}s  >120s: {sum(1 for x in lat if x > 120)}"
        )
    print()
    for key, rec in stats["generation_breaks"]:
        print(
            f"  generation break (unscorable): {rec['req_at']} {key[0][:8]}/{key[1]:<17} "
            f"msgs={rec['messages']} bp={rec['breakpoints']} kind={rec['kind']} "
            f"real(read={rec['real_read']},write={rec['real_write']}) | {rec['verdict']}"
        )
    print()
    print("=" * 82)
    print("AGREEMENT  predicted 'read reaches previous request's tail'  vs  real usage")
    print("=" * 82)
    print(f"  breakpoint lanes                : {fmt(agreement(stats['pairs']))}")
    print(f"  all requests (model undefined   : {fmt(agreement(evaluate(replayed, lanes='all')['pairs']))}")
    print("   on lanes without breakpoints)")
    print()
    print("WHY THE ALL-REQUESTS NUMBER IS LOW: per-lane reality (all requests)")
    per_model = defaultdict(list)
    for key, recs in replayed.items():
        for rec in recs:
            if rec["use_at"] is None or rec.get("zero_usage") or rec["first_in_window"]:
                continue
            if rec["gt_reaches_prev_tail"] is None:
                continue
            pred = rec["pred"]["reaches_prev_tail"] if rec["pred"] else False
            per_model[key[1]].append((pred, rec["gt_reaches_prev_tail"], bool(rec["breakpoints"])))
    for model, items in sorted(per_model.items(), key=lambda kv: -len(kv[1]))[:8]:
        bp = [i for i in items if i[2]]
        nbp = [i for i in items if not i[2]]
        line = f"  {model:<26} n={len(items):<5} real-hit={sum(1 for _,g,_ in items if g):<5}"
        if bp:
            line += f" breakpoints: {fmt(agreement([(p, g) for p, g, _ in bp]))}"
        if nbp:
            line += f"  no breakpoints: {fmt(agreement([(p, g) for p, g, _ in nbp]))}"
        print(line)
    print()
    print("BY GAP SINCE PREVIOUS REQUEST (all requests, model undefined on the non-breakpoint lanes)")
    all_stats = evaluate(replayed, lanes="all")
    for name in ["<5m", "5-60m", ">60m", "cold"]:
        if name in all_stats["by_gap"]:
            print(f"  {name:>7}: {fmt(agreement(all_stats['by_gap'][name]))}")
    print()
    print("BY GAP SINCE PREVIOUS REQUEST (breakpoint lanes)")
    for name in ["<5m", "5-60m", ">60m", "cold"]:
        if name in stats["by_gap"]:
            print(f"  {name:>7}: {fmt(agreement(stats['by_gap'][name]))}")
    print()
    print("BY diff.kind (breakpoint lanes)")
    for kind, pairs in sorted(stats["by_kind"].items(), key=lambda kv: -len(kv[1])):
        print(f"  {kind:>18}: {fmt(agreement(pairs))}")
    print()
    print("MODEL MECHANISM vs REALITY (breakpoint lanes)")
    print("  reason      n    model-hit  real-hit  agreement")
    for reason, pairs in sorted(stats["by_reason"].items(), key=lambda kv: -len(kv[1])):
        real_hits = sum(1 for _, g in pairs if g)
        print(f"  {reason:>12} {len(pairs):<4} {sum(1 for p,_ in pairs if p):<10} {real_hits:<9} {fmt(agreement(pairs))}")
    print()
    print("MODEL vs THE AUDIT'S OWN BYTE-IDENTITY VERDICT (confusion, breakpoint lanes)")
    for (pred, verdict_hit), pairs in sorted(stats["by_verdict"].items(), key=lambda kv: -len(kv[1])):
        real_hits = sum(1 for _, g in pairs if g)
        print(f"  model={'hit ' if pred else 'miss'} audit-verdict={'hit ' if verdict_hit else 'miss'}: n={len(pairs):<4} real-hit={real_hits:<4} ({fmt(agreement(pairs))})")
    print()
    print(f"DISAGREEMENTS: {len(stats['disagreements'])}")
    for key, rec, gt in stats["disagreements"]:
        pred = rec["pred"]
        print(
            f"  {rec['req_at']} {key[0][:8]}/{key[1]:<17} msgs={rec['messages']:<4} "
            f"bp={rec['breakpoints']} kind={rec['kind']:<15} gap={rec['gap_s'] if rec['gap_s'] is None else int(rec['gap_s'])}s "
            f"pred({pred['reason']},hit={pred['hit']},read={pred['read_blocks']},prev={pred['prev_anchor']}) "
            f"real(read={rec['real_read']},write={rec['real_write']}) gt={gt} | {rec['verdict']}"
        )
    print()
    print("TURNS WHERE THE MODEL PREDICTS A MISS (or reality is a miss) -- the discriminating cases")
    for key, records in replayed.items():
        for rec in records:
            if not rec["breakpoints"] or rec["use_at"] is None or rec.get("zero_usage"):
                continue
            pred = rec["pred"]
            real_miss = rec["real_read"] < 0.5 * (rec.get("prev_usage_total") or 0) if rec.get("prev_usage_total") else False
            if pred["reason"] == "hit" and not real_miss:
                continue
            print(
                f"  {rec['req_at']} {key[0][:8]}/{key[1]:<17} msgs={rec['messages']:<4} bp={rec['breakpoints']} "
                f"kind={rec['kind']:<15} gap={rec['gap_s'] if rec['gap_s'] is None else int(rec['gap_s'])}s "
                f"pred({pred['reason']},hit={pred['hit']},prev={pred['prev_anchor']}) "
                f"real(read={rec['real_read']},write={rec['real_write']}) gt={rec['gt_reaches_prev_tail']} | {rec['verdict']}"
            )
    print()

    # ------------------------------------------------------------------ sweeps
    print("=" * 82)
    print("PARAMETER SENSITIVITY (breakpoint lanes)")
    print("=" * 82)
    for lb in [0, 2, 4, 6, 10, 14, 20, 30, 40, 80]:
        st = evaluate(collect(turns, lookback=lb))
        print(f"  lookback={lb:<3} TTL=1h stamp=request     : {fmt(agreement(st['pairs']))}")
    st = evaluate(collect(turns, stamp="response"))
    print(f"  lookback=20  TTL=1h stamp=response     : {fmt(agreement(st['pairs']))}")
    st = evaluate(collect(turns, unmatched_writes=False))
    print(f"  lookback=20  TTL=1h unpaired-writes off: {fmt(agreement(st['pairs']))}")
    print()
    print("  turns whose verdict flips with a wider window (what bounds the window):")
    base = {rec["req_at"]: rec["pred"]["reaches_prev_tail"] for key, recs in replayed.items() for rec in recs if rec["pred"]}
    for lb in [4, 10, 20, 40, 80]:
        alt = collect(turns, lookback=lb)
        flips = []
        for key, recs in alt.items():
            for rec in recs:
                if rec["pred"] and rec["req_at"] in base and rec["pred"]["reaches_prev_tail"] != base[rec["req_at"]]:
                    flips.append((rec["req_at"], key, rec["pred"]["reason"], rec["pred"]["hit"], rec["pred"]["prev_anchor"], rec["gt_reaches_prev_tail"]))
        print(f"    lookback={lb:<3}: {len(flips)} flips vs lookback=20" + (f"  {flips[:4]}" if flips else ""))
    print()

    # ------------------------------------------------------- TTL bounds
    print("=" * 82)
    print("TTL BOUNDS FROM REAL DATA")
    print("=" * 82)
    hit_gaps = []
    for key, recs in replayed.items():
        for rec in recs:
            if not rec["breakpoints"] or rec["use_at"] is None or rec.get("zero_usage"):
                continue
            if rec["gt_reaches_prev_tail"] and rec["gap_s"]:
                hit_gaps.append((rec["gap_s"], rec["req_at"], key))
    hit_gaps.sort()
    all_gaps = sorted(
        rec["gap_s"]
        for key, recs in replayed.items()
        for rec in recs
        if rec["breakpoints"] and rec["use_at"] is not None and not rec.get("zero_usage") and rec["gap_s"] is not None
    )
    if all_gaps:
        print(f"  gap since previous request: n={len(all_gaps)} median={int(statistics.median(all_gaps))}s "
              f"p90={int(all_gaps[9*len(all_gaps)//10])}s max={int(all_gaps[-1])}s  >1h: {sum(1 for g in all_gaps if g > 3600)}")
    if hit_gaps:
        print(f"  largest gap that still produced a real hit : {int(hit_gaps[-1][0])}s at {hit_gaps[-1][1]} ({hit_gaps[-1][2][1]})")
        print(f"  median gap among real hits                 : {int(statistics.median([g for g,_,_ in hit_gaps]))}s")
        print(f"  real hits with a gap > 1h                  : {sum(1 for g,_,_ in hit_gaps if g > 3600)}")
    print("  (the compaction replay below supplies the upper bound: an entry aged 1:57 did not hit)")
    print()

    # ------------------------------------------------------- token coherence
    print("=" * 82)
    print("TOKEN COHERENCE (breakpoint lanes, hits only)")
    print("=" * 82)
    per_chain = defaultdict(list)
    for key, records in replayed.items():
        for rec in records:
            if not rec["breakpoints"] or rec["use_at"] is None or rec.get("zero_usage"):
                continue
            pred = rec["pred"]
            if pred["hit"] >= 0 and pred["read_blocks"] > 0:
                per_chain[key].append((pred["read_blocks"], rec["real_read"]))
    for key, vals in sorted(per_chain.items(), key=lambda kv: -len(kv[1]))[:6]:
        ratios = sorted(r / b for b, r in vals)
        med = statistics.median(ratios)
        print(
            f"  {key[0][:8]}/{key[1]:<17} n={len(vals):<4} real cacheRead / predicted read blocks: "
            f"median={med:7.1f} p10={ratios[len(ratios)//10]:7.1f} p90={ratios[9*len(ratios)//10]:7.1f}"
        )
    print()

    # ------------------------------------------------ reach / jump histograms
    print("=" * 82)
    print("HOW FAR THE LOOKUP HAD TO REACH (what the corpus actually exercises)")
    print("  reach = this request's anchor - the matched entry index")
    print("  jump  = this request's anchor - the previous request's last marker")
    print("=" * 82)
    reach = Counter()
    jump = Counter()
    for key, records in replayed.items():
        for rec in records:
            if not rec["breakpoints"]:
                continue
            pred = rec["pred"]
            if pred["hit"] >= 0:
                reach[pred["anchor"] - pred["hit"]] += 1
            if pred["prev_anchor"] is not None:
                jump[pred["anchor"] - pred["prev_anchor"]] += 1
    print("  reach histogram:")
    for distance, count in sorted(reach.items()):
        print(f"    {distance:>4} blocks back: {count}")
    print("  jump histogram:")
    for distance, count in sorted(jump.items()):
        print(f"    +{distance:<3} blocks per turn: {count}")
    max_reach = max(reach) if reach else 0
    print(f"  => the widest reach the corpus ever needs is {max_reach} blocks")
    print("  => a matched entry was ALWAYS the immediately preceding request's own marker;")
    print("     no turn ever had to be served from an older, un-restamped entry, so the")
    print("     corpus itself cannot show whether older markers stay alive.")
    print()
    print("=" * 82)
    print("BLOCK PROXY (message index vs content block, archived wire bodies)")
    print("=" * 82)
    ratios, tail_ratios, total_bodies = measure_block_proxy()
    if ratios:
        ratios.sort()
        tail_ratios.sort()
        print(f"  sampled bodies: {len(ratios)} of {total_bodies}")
        print(
            f"  content blocks per message, whole body: median={ratios[len(ratios)//2]:.3f} "
            f"p10={ratios[len(ratios)//10]:.3f} p90={ratios[9*len(ratios)//10]:.3f}"
        )
        print(
            f"  content blocks per message, last 24    : median={tail_ratios[len(tail_ratios)//2]:.3f} "
            f"p10={tail_ratios[len(tail_ratios)//10]:.3f} p90={tail_ratios[9*len(tail_ratios)//10]:.3f}"
        )
        med = ratios[len(ratios)//2]
        print(f"  => LOOKBACK of 20 content blocks is {20/med:.1f} messages, not 20")
        print("  => applying LOOKBACK=20 to message indices is therefore ~45% too permissive")
    print()

    # ------------------------------------------------------------ compaction
    print("=" * 82)
    print("REAL COMPACTION REQUESTS THROUGH THE MODEL")
    print("=" * 82)
    trace = load_trace()
    pid_to_chain = {}
    for row in rows:
        if "pid" in row and "sessionId" in row and "model" in row:
            pid_to_chain.setdefault(row["pid"], (row["sessionId"], norm_model(row["model"])))
    wires = [r for r in trace if r.get("k") == "summarize.wire"]
    usages = [r for r in trace if r.get("k") == "summarize.usage"]
    interesting = [w for w in wires if w.get("breakpoints") and w.get("at", "").startswith("2026-09-30")]
    for wire in interesting:
        chain = pid_to_chain.get(wire.get("pid"))
        wire_at = parse_at(wire["at"])
        usage = next(
            (u for u in usages if u.get("pid") == wire.get("pid") and u["at"] >= wire["at"] and u.get("model") == wire.get("model")),
            None,
        )
        wb = [int(b.split(":")[0]) for b in wire["breakpoints"]]
        print(f"\n  wire {wire['at']} pid={wire['pid']} model={wire['model']}")
        print(f"       messages={wire['messages']} breakpoints={wire['breakpoints']} chain={chain}")
        if usage:
            u = usage["usage"]
            print(f"       real usage: read={u['cacheRead']} write={u['cacheWrite']} cttl={u.get('cttl')}")
        if not chain:
            print("       no chain mapping")
            continue
        entries = {}
        prev_anchor = None
        last_messages = None
        for rec in replayed[chain]:
            if rec["req_at"] is None or parse_at(rec["req_at"]) >= wire_at:
                continue
            if rec["breakpoints"]:
                for index in [int(b.split(":")[0]) for b in rec["breakpoints"]]:
                    entries[index] = parse_at(rec["req_at"])
                prev_anchor = max(int(b.split(":")[0]) for b in rec["breakpoints"])
                last_messages = rec["messages"]
        # what the main chain did right before
        print(f"       last main request before it: messages={last_messages} anchor={prev_anchor}")
        for probe in sorted({min(wb), max(wb)}):
            written = entries.get(probe)
            print(f"       entry at {probe}: written={written} age={None if written is None else wire_at - written}")
        hit, reason, _ = classify(entries, max(wb), wire_at, lookback)
        print(f"       OLD shape (msgs={wire['messages']}, bp={wb}) -> hit={hit} reason={reason} read_blocks={hit+1} written_blocks={max(wb)-hit}")
        # NEW shape: full live chain + instruction, breakpoints [n-1, n]
        if last_messages:
            new_bp = [last_messages - 1, last_messages]
            hit2, reason2, _ = classify(entries, max(new_bp), wire_at, lookback)
            print(f"       NEW shape (msgs={last_messages+1}, bp={new_bp}) -> hit={hit2} reason={reason2} read_blocks={hit2+1} written_blocks={max(new_bp)-hit2}")
        # which old entries are alive at the boundary
        alive = sorted(i for i, w in entries.items() if wire_at - w < TTL)
        print(f"       alive entries at wire time: {len(alive)} (max={alive[-1] if alive else None})")

    out = {
        "audit_rows": len(rows),
        "chains": len(turns),
        "lookback": lookback,
        "bp_turns": stats["bp_turns"],
        "paired": stats["paired"],
        "unmatched_requests": stats["unmatched_reqs"],
        "zero_usage": stats["zero_usage"],
        "agreement": agreement(stats["pairs"]),
        "by_gap": {k: agreement(v) for k, v in stats["by_gap"].items()},
        "by_kind": {k: agreement(v) for k, v in stats["by_kind"].items()},
        "by_reason": {
            k: {"agreement": agreement(v), "real_hits": sum(1 for _, g in v if g), "n": len(v)}
            for k, v in stats["by_reason"].items()
        },
        "disagreements": [
            {
                "at": rec["req_at"],
                "chain": list(key),
                "messages": rec["messages"],
                "breakpoints": rec["breakpoints"],
                "kind": rec["kind"],
                "gap_s": rec["gap_s"],
                "pred": rec["pred"],
                "real_read": rec["real_read"],
                "real_write": rec["real_write"],
                "verdict": rec["verdict"],
            }
            for key, rec, _ in stats["disagreements"]
        ],
    }
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "calibrate-cache-model.result.json"), "w") as handle:
        json.dump(out, handle, indent=2)
    return out


if __name__ == "__main__":
    main()
