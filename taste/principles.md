# Taste principles (living)

Updated from **coarse round-01** rankings (2026-08-07).

## Confirmed (owner-ranked)

### P1 — Downward residual → top entry (strong)
When the target sits **clearly below** the source and the path already used a **side exit** to change column, prefer **N entry** (horizontal then down).  
Do **not** force channel-facing E/W entry merely because an inter-column corridor exists.

- Evidence: `01` A never B; `05` prefer A  
- Anti-pattern: wrap to E face of a below-side node (post-#29 Ad fixture)

### P2 — Don’t overfit indifferent cases (strong)
If A and B are both acceptable, leave as **tie**. No rule change for noise.

- Evidence: `02`, `03`, `04` either; `08` identical

### P3 — Parallel-channel clearance (strong reject)
Near-parallel vertical segments in a tight corridor are **never** acceptable, even if ports are “correct.”

- Evidence: `07` A never B (“closeness of vertical lines”)  
- Mechanism later: min gap between co-running channel segments / bend penalty for cramped corridors

### P4 — Multi-arrival face choice (weak / secondary)
When **two edges converge** on one side-column node, channel-facing side entry (B-style) can be **preferred**, while top-entry (A) remains permissible.

- Evidence: `06` B > A, A ok  
- Must not override P1 on simple single-edge below-side cases

### P5 — Self-loop bar + terminal arrow
Decision **No** self-loops:
1. Horizontal bar at **mid-gap** between nearest same-column node’s **bottom** and this diamond’s **top** (N tip).
2. Drop into N with a visible **arrowhead**.

- Not a fixed margin above E tip; not an arbitrary lift above the diamond alone.
- Fallback when nothing is above: margin above N port.

## Priority when principles conflict

```
P5 (visible arrow)     hard defect
P3 (clearance)         hard aesthetic reject
P1 (downward → N)      strong preference
P4 (multi-arrival)     weak preference
P2 (ties)              don’t invent rules
```

So: **P1 beats P4** on single cross-column-no-below edges.  
**P3** can reject a layout/route even if faces match P1.

## Hypotheses (not yet ranked)

- Same-row true lateral → E/W entry (round-01 ties; need a clearer same-row fixture if we care).
- Loopback exit tip geometry (W vs E on side-column decision) — only partially probed in 07.

## Anti-patterns (locked)

1. Force E/W entry on below-side targets “because channel” → rejected (01).  
2. Cramped parallel verticals in side corridor → rejected (07).  
3. Self-loop without readable arrowhead → defect (05, 08).

## Implications for code (not done yet)

| Item | Action | Priority |
|---|---|---|
| Post-#29 channel-face hard pin | Soften/revert toward P1 (pre-#29 behavior for below-side) | High |
| Clearance term / min channel gap | New score or geometry check for P3 | High |
| Self-loop marker / path end | Fix arrow visibility on diamond re-entry | High (bug) |
| Multi-arrival side entry | Optional weak weight (P4), after P1 | Later |
| Full candidate scorer | Medium round once P1+P3 expressed as terms | Later |

## Round-02 candidates (finer)

1. Self-loop arrow fix verification (05, 08) — binary pass/fail  
2. Clearance threshold: how much gap is enough (07 variants)  
3. P1 vs P4 conflict case: one below-side edge + one same-face arrival  
4. Holdout: learning-flow full page spot-check under restored P1  
