# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

```bash
bun test                                      # run all tests
bun test test/grid-layout.test.ts             # run a single test file
bun test --watch                              # watch mode
bun run build                                 # compile to dist/
npx tsx scripts/gen-svg.ts <fixture>          # generate SVG from test/fixtures/<fixture>.flow
npx tsx scripts/gen-svg.ts learning-flow      # most complete stress fixture
```

`bun` is the runtime and test runner. If `bun` is not in PATH, fall back to `npx tsx` for one-off scripts (see `scripts/gen-svg.ts`). Do not use `npx tsx` for tests — they use `bun:test` imports.

Test fixtures live in `test/fixtures/*.flow`. Generated SVGs go to `test/output/`.

---

## Architecture

**Pipeline** (in order): `parse → layout → route → renderSVG`

```
src/parser/      lexer.ts + parser.ts → FlowDocument (AST)
src/layout/      dagre-layout.ts      → node x/y positions + GridLayoutMeta
                 grid-layout.ts       → paper-cutout placement engine (TB flows)
                 router.ts            → RouteResult per edge (waypoints + pathData)
                 port-reservation.ts  → cardinal port assignment (N/S/E/W)
                 shape-ports.ts       → port geometry per shape
src/render/      svg.ts               → SVG string from positioned doc + routes
                 svg-tree.ts          → virtual element builder / serializer
                 shapes/index.ts      → per-shape SVG renderers
src/themes/      clean.ts             → stroke, fill, font tokens
```

**Public API** (`src/index.ts`): `parse`, `layout`, `route`, `renderSVG`, or the one-shot `render(source)`.

### Layout engine — two modes

`dagre-layout.ts` is the entry point for both modes.

- **Grid layout** (default for TB flows without swimlanes): `grid-layout.ts` places nodes into `(row, column)` cells on an infinite grid. Columns are named `main`, `W1`, `W2`, `E1`, `E2`, … Side column assignment is adaptive — `no`/`false` branches go West by convention, but `adaptiveSide()` flips to East when West is more than 2× loaded. `finalizeColumns()` converts column names to x coordinates.

- **Dagre layout** (swimlanes, groups, `@layout dagre`, non-TB direction): delegates to `@dagrejs/dagre`.

`getGridMeta(doc)` returns the `GridLayoutMeta` if grid layout ran, or `undefined` for dagre.

### Router — three edge classes

1. **Local edges** (`routeGridLocal`): same-column forward edges within one row step. L-shaped or straight.
2. **Skip edges** (`routeGridSkip`): back-edges, cross-column forward edges, multi-row same-column edges. Route via a side channel (`channels.outerWest`, `channels.outerEast`, `channels.west/east` maps). Channel x coordinates are computed in `buildGridChannels()`.
3. **Cardinal edges** (`routeCardinal`): swimlane documents.

`classifySkipEdges()` in `grid-layout.ts` decides which class each edge gets. Key rules:
- `toRow < fromRow` → always skip (back-edge).
- Same column, gap ≥ 2 with intermediate occupants → skip.
- Cross-column forward edge where target column already has a node in the source row → skip (prevents L-route piercing that node).

**Port reservation** (`port-reservation.ts`): two-pass system assigns cardinal exit ports then entry ports. Diamonds exit from tips; rectangles from face centers. The reservation prevents two edges sharing the same port on the same face.

**Line jumps**: `applyLineJumps()` post-processes all routes, detecting perpendicular crossings and rewriting the yielding edge's path data with a small arc bump (`waypointsToRoundedPathWithJumps`). Enabled by default; disable with `@line-jumps off`.

### Key invariants to preserve

- `anyNodeBetweenSourceAndChannel` checks only between `source.x` and `channelX`, not to infinity. Do not widen this check.
- `usingSouthEntry` threshold is `< width * 0.25`. It must stay tight or paths enter nodes from wrong faces.
- `usingTopEntry` only fires when the channel is on the *far* side of the target (outer loop). Near-side inter-column channels use E/W entry facing the channel (issue #29).
- `calculateBounds` in `svg.ts` walks route waypoints as well as node bounding boxes. Outer-channel paths extend beyond nodes.

### Routing correctness invariants (must all hold after every route)

These are the ground-truth spec. Any fix that breaks one of these is wrong, even if it fixes a visual issue.

1. **No pierce**: no path segment crosses any node's bounding box (node + 8px margin), except the two terminal segments connecting to ports.
2. **Entry direction matches flow**: same-column forward edges enter N; cross-column edges enter the face that faces the source column / channel (E or W); back-edges enter S or E/W depending on channel side. Do not force N merely because `toRow > fromRow`.
3. **Decision exits are geometric+semantic**: `yes`/`true` → tip aligned with target (S when below, E/W when cross-column or loop-back); `no`/`false` → E/W tip toward target; never exit N (reserved for inbound).
4. **No port stacking**: two edges on the same face of the same node must have distinct (x,y) entry/exit points, separated ≥ 4px.
5. **All coordinates finite**: every waypoint must be a finite number (no NaN, no Infinity).
6. **Channel consistency**: the `channelX` used in waypoint construction must match the `channelX` used in port reservation. Mismatches cause wrong-face entry.

### Decision exit conventions (do not change without updating tests)

- `yes`/`true` branches: score free cardinals `{S, E, W}` by alignment with `(dx, dy)` and pick the best. Same-column-below still resolves to S; cross-column and loop-backs pick the tip facing the target (avoids S-exit U-turns).
- `no`/`false` branches: exit toward the target column (E if target is right, W if left).
- The `assignDecisionExits()` pre-pass encodes these rules. Do not bypass it.
- See also `test/loopback-port-selection.test.ts` for the geometry-aware pin regressions.

### Channel selection rules (do not break these)

`predictSkipDirs()` computes `channelX` before port reservation. `routeGridSkip()` re-derives `channelX` if the reservation changed the exit direction. **These two must agree.** The most common source of routing bugs is one updating channelX and the other not.

- main → sideCol with forced S/N exit: use **outer** channel (outerWest/outerEast), not the inner column channel.
- main → main with W exit override: use outerWest.
- main → main with E exit override: use outerEast.
- sideCol → main: use the **inner** channel between the two columns. Do not apply the main-column correction.
- The `fromSide === 0` guard in `predictSkipDirs` is intentional — it prevents sideCol→main edges from getting the wrong outer channel.

### Port reservation rules (do not change without running full suite)

- `entryPin` in `buildGridReservation` pins **all** skip edge entries (`isSkip ? dirs.entryDir : undefined`). This is required so multiple skip edges targeting the same face land in the same bucket and get spread via `applyReservationSpread`. Narrowing this back to S-only breaks spread for W/E entries.
- `exitPin` for decisions is always the `assignDecisionExits` override. Never bypass it.
- The two-pass order (exits first, then entries) is load-bearing. Reversing it breaks opposite-direction conflict detection.
- Predicted-entry pre-pass in `reservePorts`: natural entry sides are stamped before the exit pass so exits see future inbound claims. Stamps are removed before the real entry pass.
- `rankAround` order is preferred → near-perp → far-perp → axis-opposite (not preferred → opposite → perp).

### Known remaining visual issues (not yet tested)

1. **Trench collision** (`incident-response`: green yes-edge and red no-edge share outer-west channel). Fix: replace `edgeIndex % 4` spread with a per-channel slot counter that checks vertical range overlap. ~10 lines in `routeGridSkip`. Low risk.
2. **`Reviewer approved? → Iterate On Project`** (`learning-flow`): no-branch enters from wrong face. Needs a dedicated test + targeted fix.

### Architectural direction (when the above are fixed)

The next meaningful architectural improvement is a **dynamic channel sizing + iterative layout loop**:

```
classify edges → count concurrent channel occupancy → size channels
→ assign pixel positions → route → validate → bump if violations → repeat
```

This replaces the fixed `SPREAD = 14` constant with channel widths derived from actual edge occupancy. Convergence is guaranteed (constraints only increase). Most diagrams converge in 1 pass. Estimated scope: ~300 lines, 3–5 days. **Do not attempt this before the oracle corpus and invariant validator are in place** — those provide the safety net needed to refactor the layout engine without introducing regressions.

---

## Product Architecture & Deployment Strategy

### What this repo contains

1. **Core library** (`src/`) — parser, layout, router, renderer. The engine everything else depends on.
2. **CLI** (`src/cli.ts`) — local command-line usage.
3. **MCP server** (`src/mcp-server.ts`) — developer-facing tool integration.
4. **Web server** (`server/`) — self-hosted Bun HTTP server: SOP → LLM → `.flow` + SVG. Deployed via Docker/Portainer.
5. **Browser editor** (`editor/`) — static browser bundle (`build:editor`). Currently deployed standalone to Cloudflare.

### Decided: generator + editor cohabitate in this repo

The live editor (currently at `flowscript.foxanddoveconsulting`) and the self-hosted generator (`server/`) will be unified into a single product served from this repo's server. Rationale:

- The user journey is one workflow: *paste document → AI generates `.flow` → user refines → downloads SVG*
- Splitting across two URLs requires a cross-domain handoff hack (URL fragments)
- Both need the same `flowscript.js` browser bundle — no reason to duplicate
- Future multiuser SaaS needs a backend anyway (LLM key cannot be in the browser)

**Target structure:**
```
GET /            → generator page (current server/ui/index.html)
GET /editor      → live .flow editor page (adapted from editor/)
GET /flowscript.js → browser bundle (served as static asset)
```

"Edit .flow" button on the generator opens `/editor#<encoded flow>`. Editor reads the hash on load and pre-populates.

### Deployment tiers (long-term)

| Tier | Who | Backend | LLM key |
|---|---|---|---|
| Self-hosted (Docker) | Private orgs | Their Portainer/server | Their own key |
| Cloudflare (SaaS) | Everyone else | Cloudflare Workers | We pay, usage-gated |
| Browser-only | Developers / power users | None | N/A — editor only |

**Key constraint:** the LLM call must always live server-side. Never expose API keys in the browser bundle. This means the Cloudflare public deployment will eventually need Workers (not just Pages).

### What stays separate (for now)

- The Cloudflare editor at `flowscript.foxanddoveconsulting` remains live as-is — it's not broken, just incomplete. It gets replaced when the unified product is ready.
- No separate repo for the web app. It's a consumer of the core library in the same repo, importing directly from `src/` without an npm publish step.

---

## Behavioral Guidelines

*(From [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills))*

### Think Before Coding

Before implementing: state assumptions explicitly, surface tradeoffs, ask when uncertain. If multiple interpretations exist, present them — don't pick silently.

### Simplicity First

Minimum code that solves the problem. No speculative abstractions, no unrequested flexibility. If a change exceeds ~50 lines and a simpler path exists, name it first.

### Surgical Changes

Touch only what the request requires. Don't improve adjacent code, reformat, or refactor things that aren't broken. Match existing style. If unrelated dead code is noticed, mention it — don't delete it. Every changed line should trace directly to the user's request.

### Goal-Driven Execution

For non-trivial changes, state a brief plan with verifiable steps before coding:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```
Run `bun test` after each meaningful change. Use `npx tsx scripts/gen-svg.ts learning-flow` to visually verify layout changes — the test suite checks geometric invariants but cannot catch visual regressions.
