# ADR 001 — Grid Routing Architecture

**Date:** 2026-06-09  
**Status:** Active  
**Context:** Post-analysis session after 3 failing tests and visible trench collision in learning-flow SVG.

---

## The problem that kept recurring

Seven routing bug-fix commits in three weeks. Same pattern each time: fix one thing, break another. The root cause was identified as **specification-free routing** — the code was the only definition of correct behavior, so every patch risked violating an unwritten rule.

---

## What we found

### The architecture is sound
The `parse → layout → route → render` pipeline is correctly separated. The bugs were not architectural — they were accumulated heuristic patches applied without a shared understanding of invariants.

### The specific bugs (June 2026 session)

Three tests were failing. All three traced to the same root cause: **the `channelX` used during port reservation and the `channelX` used during waypoint construction could disagree**.

| Test | Symptom | Root cause |
|---|---|---|
| yes-branch exits wrong tip | S tip expected, W tip actual | `assignDecisionExits` treated cross-column back-refs as genuine loops |
| Monitor entered from E not W | Wrong face | `predictSkipDirs` computed channelX from initial topology; correction block only fired when `overrideExit !== exitDir`, but the upward-loop guard had already set `exitDir` to match without updating `channelX` |
| 3 retry edges stacked | No spread | `entryPin` was S-only; W-entry edges got no pin, reservation diverted each to a different free cardinal, total=1 each, spread never triggered |

### The six fixes

All in `src/layout/router.ts`:

1. `assignDecisionExits`: `yes/true` back-edges use S exit when `dx < -50` (westward cross-column, target placed above in a left side column due to layout). Same-column and eastward cross-column keep side exits.

2. `predictSkipDirs` signature: added `overrideExit?: CardinalDir` parameter.

3. `predictSkipDirs` body: when `overrideExit` is given AND `fromSide === 0` (main column source), always re-derive `channelX` for the actual exit direction. The `fromSide === 0` guard is critical — side-column sources (W1→main) already have the correct inner channel and must not have it replaced.

4. `buildGridReservation`: passes `overrideExit` to `predictSkipDirs` so reservation and routing see the same channel.

5. `buildGridReservation` `entryPin`: widened from `isSkip && dirs.entryDir === 'S'` to `isSkip ? dirs.entryDir : undefined`. All skip entries are now pinned, not just S-entries. Required for spreading to work on W/E entry faces.

6. `routeGridSkip` two sub-fixes:
   - gapY uses `exitFinalDir === 'S'` not `goingDown` — a forced-S exit on a back-edge must step *down* from the south tip, not up
   - channelX re-derivation extended to `main→sideCol` with forced S/N exit (previously only handled main→main)

---

## The invariants (the spec that was missing)

These must hold after every route. Any LLM fix that breaks one of these is wrong.

1. No path segment pierces any node bounding box (+ 8px margin)
2. Entry direction matches flow direction
3. Decision exits are semantic (`yes`→S, `no`→E/W toward target)
4. No two edges share the same port pixel on the same face
5. All waypoint coordinates are finite
6. Channel consistency: reservation and waypoint construction use the same channelX

---

## What to do next (in order)

### 1. Per-channel slot counter (~10 lines, low risk)
Replace `edgeIndex % 4` in `routeGridSkip` with a per-channel slot counter that tracks how many edges with overlapping vertical ranges already use that channel. Fixes the trench collision visible in `incident-response`. Do this first — it's the smallest fix with the clearest impact.

### 2. Oracle corpus (~1 hour of owner review time)
Generate candidate routes for ~20 canonical scenarios. Owner reviews each and approves. Lock in as geometric regression tests. This is the safety net that makes all future changes safe.

Scenarios to cover at minimum:
- Local forward (same col, adjacent row)
- Local cross-column forward (adjacent row)
- Skip forward (same col, multi-row)
- Skip cross-column forward
- Yes-branch back-edge (same column)
- Yes-branch back-edge (cross-column, main→W1)
- No-branch local
- No-branch skip
- Self-loop
- Multi-branch decision (3+ conditions)
- Two back-edges to same target (spread test)
- Three back-edges to same target (spread test)

### 3. Invariant validator (~100 lines, low risk)
A `validateRoutes(doc, routes)` function that checks all 6 invariants and returns a violation list. Called in tests; can become the loop termination condition in v2. Do this before any structural refactoring.

### 4. Iterative layout-routing loop (v2, ~300 lines, medium risk)
Only after 1–3 are done.

```
classify → count channel occupancy → size channels → assign positions → route → validate → bump if violations → repeat
```

Replaces the fixed `SPREAD = 14` constant. Most diagrams converge in 1 pass. Guaranteed convergence (constraints only increase). This is the right long-term architecture but requires the oracle corpus and validator as a safety net first.

---

## What not to do

- **Do not narrow `entryPin` back to S-only.** It was `isSkip && dirs.entryDir === 'S'` before; widening it to all skip entries is required for W/E face spreading. Narrowing it again will re-break test 3 (synthetic stacking).

- **Do not remove the `fromSide === 0` guard in `predictSkipDirs`.** Without it, sideCol→main edges (e.g., W1→main yes-back-edges) get their correct inner channel replaced with the wrong outer channel.

- **Do not change the two-pass order in `reservePorts`** (exits first, then entries). The opposite-direction conflict detection depends on exits being in `used` when entries are processed.

- **Do not attempt the iterative pipeline without the oracle corpus.** You need geometric regression tests before refactoring the layout engine or you're flying blind.

---

## Why this codebase is worth investing in

- The pipeline architecture is correct and clean
- The bugs were in specific, identifiable places — not spread through the codebase
- The fixes were surgical (6 changes, one file, ~80 lines)
- The test suite is meaningful (assertions about geometric invariants, not implementation details)
- The remaining issues have clear, bounded fixes

This is a young codebase with scar tissue from stateless LLM editing, not a fundamentally broken design.
