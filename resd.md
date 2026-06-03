# Kult Games — "10K Active Users" Claim vs On-Chain Reality

**Prepared for**: 0G BD team (for a conversation with the Kult Games team)
**Date**: 2026-05-29
**Data source**: 0G Mainnet (Aristotle) via the public Etherscan-compatible API at `chainscan.0g.ai/open/api` — measured live on 2026-05-29.
**Method**: Because Kult uses a backend-relayer architecture (see below), "users" cannot be counted as transaction senders. We extracted the **distinct player wallet addresses embedded in the transaction calldata** of each game's core contract. That is the closest on-chain proxy for a real player.

---

## TL;DR (the one slide)

| Metric | Value |
|---|---|
| **Kult's claim** | ~10,000 active users |
| On-chain **distinct players, all-time** (cumulative since Nov 2025, 4 main games, deduplicated) | **~6,492** |
| On-chain **30-day active** distinct players (Apr 29 – May 29) | **~435** |
| On-chain **7-day active** distinct players | **~279** |

**Headline**: The "10K" figure is ~1.5× the **all-time cumulative** distinct on-chain players across all live games, and roughly **20–25× the number of players who actually generated on-chain activity in the last 30 days (~435).** The gap is too large to be measurement noise — it almost certainly reflects a **different definition of "active user"** (e.g., off-chain registrations, social community, or quest wallets) rather than players currently transacting on 0G.

---

## 1. Architecture context (why "users ≠ senders")

Every Kult game contract is called by a **single backend relayer wallet**, not by players. Players sign nothing on-chain; the backend submits their actions and embeds the player's address inside the calldata.

- Example (Highway Hustle `login` action): the tx is sent by relayer `0x0430…46db`, and the player address `0xff02…fa1` appears as a parameter inside the calldata.
- Sender-level "unique address" counts are therefore meaningless (they return 1). We decode calldata instead.

**Implication for BD**: Kult's internal analytics are the only place the true user count lives. On-chain we can establish a **floor** (players who triggered at least one chain write) but not a full census. This is the central thing to align on.

---

## 2. Distinct players per game (full lifetime history)

| Game | Total game-logic txs | Distinct players (all-time) | Active window |
|---|---|---|---|
| ZeroGPool (flagship) | 9,672 | 2,754 | 2025-11-13 → 2026-05-28 |
| Highway Hustle | 8,423 | 2,709 | 2026-02-01 → 2026-05-29 |
| GuessTheAI | 4,275 | 1,574 | 2025-11-01 → 2026-05-28 |
| ZeroDash | 11,074 | 1,021 | 2026-02-03 → 2026-05-28 |
| Warzone Warriors (Anchor) | 13 | ~16 | 2026-05-24 → 2026-05-28 |
| **Union (deduplicated)** | **~33,400** | **~6,492** | Nov 2025 → May 2026 |

Players overlap across titles (the "unified ecosystem" story holds — the union, 6,492, is well below the sum of 8,058, meaning many players appear in multiple games).

---

## 3. Active players (the number that matters for an "active users" claim)

| Game | 30-day txs | 30-day active players | 7-day active players |
|---|---|---|---|
| Highway Hustle | 665 | 191 | 140 |
| ZeroDash | 1,639 | 144 | 119 |
| ZeroGPool | 870 | 123 | 85 |
| GuessTheAI | 374 | 117 | 24 |
| Warzone Warriors | 13 | 16 | 16 |
| **Union (dedup)** | — | **~435** | **~279** |

**On-chain monthly-active is ~435; weekly-active ~279.** That is the figure to put next to "10,000 active users."

---

## 4. Activity-health flags worth raising

1. **Older infrastructure went quiet.** Shared Wallet A (`0x4Af2…32b9`), which the partner said powers GuessTheAI, Highway Hustle, and ZeroGPool, **stopped sending transactions on 2026-05-07** (57,860 lifetime txs, mostly storage/Flow writes). Relaying has since been **consolidated onto a single wallet `0x0430…46db`**, which now relays nearly every game including the old titles. Worth asking why (migration? cost? backend rework?).
2. **An undisclosed relayer appeared.** GuessTheAI is now relayed by `0x41AC…f3d7`, which was **not in the address list Kult shared on 2026-05-26**. Minor, but worth confirming the full wallet inventory.
3. **Warzone / RoboWars are effectively pre-traction.** Despite Warzone being the strongest *integration* signal (it uses canonical 0G Flow/Mine/Reward), it has only ~13 recent player txs. The deep integration is real; the *usage* is not there yet.
4. **Relayer pattern caps verifiability.** ~99% of one relayer's internal calls go straight to the Flow contract — consistent with batched storage writes, not direct user interaction. We literally cannot independently verify user counts without their data.

---

## 5. Why the numbers might legitimately differ (frame these as questions, not accusations)

- **Definition gap**: "Active users" may mean off-chain accounts / registered wallets / social community (they've publicly cited a "50k+ community"), not players generating on-chain writes.
- **Not every session writes on-chain**: gameplay may be largely off-chain with only milestones/saves anchored — which would make on-chain a significant *undercount* of real players.
- **Quest inflation the other way**: Galxe/LiftOff quest wallets can *inflate* on-chain distinct addresses above real humans. (We see 6,492 distinct addresses all-time, but those need not be 6,492 humans.)
- **Time window**: "10K" might be cumulative-since-launch rather than currently active.

Any of these can be true simultaneously, which is exactly why we need their definition.

---

## 6. Recommended talking points for the call

**Open positive**: "Your integration is genuinely strong — Warzone uses the canonical 0G contracts directly, you have ~6,500 distinct player wallets across the ecosystem since November, and real storage roots we've verified. That's above average for partners."

**Then reconcile**:
1. "When you say **10,000 active users**, what's the definition — registered accounts, MAU, or wallets transacting? On-chain we see ~435 distinct players in the last 30 days and ~6,500 all-time. Help us bridge that."
2. "Are most gameplay sessions off-chain, with only some actions anchored to 0G? If so, what share of users ever touch 0G?"
3. "Can you share a weekly active-user series (even aggregated) so we can map your DAU/MAU to on-chain writes?"
4. "Wallet A stopped on May 7 and everything moved to a single relayer — was that a planned backend migration?"
5. "Warzone has the deepest integration but almost no players yet — what's the launch/marketing plan to convert integration into usage?"

**Propose a shared KPI** (carry over from the prior milestone review):
> Over the next 8–12 weeks, demonstrate sustained **on-chain monthly-active players** (distinct calldata players) trending from ~435 toward a jointly-agreed target, with a monthly snapshot pulled from the public API.

---

## 7. Exactly how "players" and "active players" were calculated

This is the step we will be asked to defend, so the procedure is spelled out fully.

### 7.1 The problem the method solves
Players don't sign their own transactions — a backend relayer does (Section 1). So the player's wallet never appears in the `from` field. It appears **inside the transaction's calldata** as a function argument. The method recovers that argument.

### 7.2 Step-by-step
1. **Pull every transaction** to each game's core contract: `module=account&action=txlist&address=<contract>&sort=desc`, paginated 100 at a time (the API caps `offset` at 100) until the contract's history is exhausted.
2. **For each transaction, decode the calldata (`input` field)**:
   - Drop the first 10 hex characters (`0x` + the 4-byte function selector).
   - Split the remainder into 32-byte words (64 hex chars each) — the ABI encoding layout.
   - A word is treated as an **address** when its first 24 hex chars are zero (a 20-byte address is left-padded to 32 bytes) and the trailing 40 hex chars are non-zero.
   - *Example (Highway `login`)*: selector `0x26d5c4d8`, then a word resolving to `0xff02…fa1` — that is the player.
3. **Filter out non-players**: drop the relayer wallets, the canonical 0G contracts (Flow/Mine/Reward), the zero address, and the `0xeee…eee` native-token sentinel. Everything left is a candidate player wallet.
4. **Deduplicate into a set** → that set's size = **distinct players for that contract**.
5. **Union the sets across the 4 main game contracts** → **all-time distinct players (6,492)**, deduplicated so a player in two games is counted once.

### 7.3 Active players = same thing, time-boxed
Identical extraction, but a transaction only counts if its `timestamp` is within the window:
- **30-day active** = timestamp ≥ 2026-04-29 → union **435**
- **7-day active** = timestamp ≥ 2026-05-22 → union **279**

Because results are sorted newest-first, pagination stops as soon as timestamps fall before the cutoff.

### 7.4 Reproducibility
All figures pulled 2026-05-29 from `https://chainscan.0g.ai/open/api`. Addresses are those Kult provided on 2026-05-26 (`../evidence/kult-provided-integration-details-2026-05-26.md`) plus the newly-observed relayer `0x41AC…f3d7`.

---

## 8. Why the comparison looks bad for the "10K active" claim

The reasoning matters more than the raw gap, because it pre-empts the obvious pushback. Two points are key:

**A. Our method is *generous* to Kult, yet the number still falls short.**
We count **any** address embedded in calldata as a "player" — even addresses that are merely *referenced* rather than the acting user. We also count **all-time cumulative** wallets that never expire (a player who logged in once in November is still counted). And one human running multiple quest wallets inflates the count **upward**. Despite all three biases pushing the number *up*, the all-time total is still only **~6,492 — below 10,000**, and the genuinely active figure is **~435/month**. A measurement tilted in their favor that *still* can't reach the claim is the strongest signal that the claim isn't about on-chain users.

**B. The "most gameplay is off-chain" defense backfires.**
The one clean way to reconcile 10K with 435 is: *"most users play off-chain; only some actions get anchored to 0G."* But if that's true, then **those users aren't actually using 0G** — which undercuts the entire "built on / powered by 0G" partnership narrative. So the claim lands in a dilemma:
  - **Either** ~10K users exist but most never touch 0G → the *0G-usage* story is overstated; **or**
  - **They do touch 0G** → then on-chain activity should be far above 435/month.

Both branches are a problem worth a candid conversation. The supporting signals point the same way: activity is **concentrated and declining** (Wallet A dead since May 7), and the deepest-integrated title (Warzone) has **~13 player txs**, not thousands.

**The fair caveat (state it plainly):** distinct wallet ≠ distinct human, and off-chain-only activity is invisible to this method, so 435/6,492 are a **lower bound** on "players who ever triggered a 0G write." The ask is simply for Kult to define their "active user" and show how it maps to on-chain activity.
