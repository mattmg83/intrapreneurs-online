# Intrapreneurs Online — Rules as Implemented in Code

This document is a **code-faithful transcription** of the game rules currently implemented in this repository, with two explainers for each rule:

1. **Plain-English**: what the rule means in gameplay terms.
2. **Project/Repo Navigation**: where the exact logic lives in code (file + function + important checks).

---

## Rule 1: Game setup defines seats, rounds, decks, and opening market state

### Plain-English
- A new game starts with configured player seats (typically A/B/C/D), each with:
  - hand size = 2,
  - empty projects,
  - no discard debt,
  - and not yet connected.
- The game has **3 total rounds** and starts on round 1.
- Four decks are initialized and shuffled with a deterministic seeded shuffle:
  - projects,
  - round-1 assets,
  - obstacles,
  - macro events.
- Opening market:
  - 5 projects face-up,
  - 3 assets face-up.
- Each seat also gets 2 private assets into a deal queue.

### Project/Repo Navigation
- State creation happens in `api/_lib/roomSetup.js` via `createInitialGameState(...)`.
- Seat defaults are assigned in the `for (const seat of playerSeats)` block.
- Deck generation and shuffling are implemented with `shuffle(...)`, `seededRandom(...)`, and `nextSeed(...)`.
- Initial market draw uses `draw(decks.projects, 5)` and `draw(decks.assetsRound1, 3)`.
- Initial per-seat private deals are queued in `dealQueue[seat] = draw(decks.assetsRound1, 2)`.

---

## Rule 2: Action execution is authenticated, versioned, and turn-nonce protected

### Plain-English
- A seat can only act if it provides a valid seat token.
- The client must provide the room version it thinks is current and the expected turn nonce.
- If either version or nonce is stale, the action is rejected with conflict data so client can resync.
- Supported action types are strictly whitelisted.

### Project/Repo Navigation
- Implemented in `api/rooms/[id]/act.js`:
  - token verification via `isSeatTokenValid(...)`,
  - version check vs `expectedVersion`,
  - turn nonce check vs `expectedTurnNonce`,
  - action type whitelist in the `if (...) unsupported action type` branch.
- The optimistic concurrency + gist patch workflow is handled in the same file in `handler(...)`.

---

## Rule 3: Turn ownership is enforced, with one discard exception

### Plain-English
- Normally only the current seat can act.
- Exception: a non-current seat may discard **out of turn** only when they are required to discard:
  - either from hand-limit overflow,
  - or from end-of-round discard debt.
- If round-end discards are pending globally, only discard actions are allowed until all debts are cleared.

### Project/Repo Navigation
- Implemented in `api/rooms/[id]/act.js` in `handler(...)`:
  - `isPlayersTurn` check,
  - `canDiscardOutOfTurn` exception,
  - `pendingRoundDiscards` gate forcing only `DISCARD_ASSET`.

---

## Rule 4: Picking an asset either takes an eligible market card or draws from deck

### Plain-English
- On `PICK_ASSET`, the player may take an eligible face-up asset from market.
- If no eligible market card is selected/available, the system draws the top card from assets deck.
- Market assets are then refilled back up to 3 if possible.
- Hand size increases by 1.
- If hand exceeds limit (default 7, modifier can change), the player enters must-discard state.

### Project/Repo Navigation
- Implemented in `api/rooms/[id]/act.js` via `applyPickAsset(...)`.
- Eligibility is defined by `isAssetEligible = (assetCard) => !assetCard?.pickCondition`.
- Fallback draw uses `drawTop(...)`.
- Refill loop is `while (nextAvailableAssets.length < 3) { ... }`.
- Hand limit comes from `getRoundModifierValue(room, 'handLimit', 7)`.

---

## Rule 5: Starting a project consumes one market project and increments round project count

### Plain-English
- On `START_PROJECT`, seat must choose a project currently in market.
- A project instance is added to that seat with:
  - stage `NONE`,
  - zero allocations,
  - not paused.
- The chosen project is removed from market and market is refilled toward 5 from project deck.
- `projectsStartedThisRound` for that seat increases by 1.

### Project/Repo Navigation
- Implemented in `api/rooms/[id]/act.js` via `applyStartProject(...)`.
- Validation rejects if chosen project is not in `market.availableProjects`.
- Refill loop runs while market has fewer than 5 and deck has cards.

---

## Rule 6: Allocating asset cards advances project stage by accumulated tailwind

### Plain-English
- On `ALLOCATE_TO_PROJECT`:
  - player must submit at least one unique card id,
  - cannot allocate more cards than current hand size,
  - must include a valid 64-hex `handHash` proof,
  - and target must be an active project (not paused, not already TF complete).
- Each allocated asset contributes outcomes (`budget`, `headcount`, `tailwind`) into project totals.
- Stage progression is based on **tailwind only**:
  - `NONE` if tailwind < `mvReq`,
  - `MV` if tailwind >= `mvReq`,
  - `TF` if tailwind >= `mvReq + tfReq`.
- Allocated cards are removed from hand size.

### Project/Repo Navigation
- Implemented in `api/rooms/[id]/act.js`:
  - `applyAllocateToProject(...)` for validations + totals updates,
  - `computeProjectStage(projectId, allocatedTotals)` for stage threshold logic,
  - requirements loaded from `src/data/projects.json` via `projectLookup`.

---

## Rule 7: Pausing a project resets progress and applies abandonment penalty state

### Plain-English
- On `PAUSE_PROJECT`, one seat project is marked paused.
- The project is reset:
  - allocations cleared,
  - stage reset to `NONE`,
  - `abandonedPenaltyCount` set to 1,
  - `restartBurdenTailwind` set from project data (default 1).
- Any previously allocated cards on that project are returned to player hand size.

### Project/Repo Navigation
- Implemented in `api/rooms/[id]/act.js` via `applyPauseProject(...)`.
- Project restart burden source is `projectLookup[targetProject.id]?.restartBurdenTailwind ?? 1`.

---

## Rule 8: Discarding reduces hand and may also pay round-end discard debt

### Plain-English
- `DISCARD_ASSET` requires:
  - current hand size > 0,
  - a non-empty `cardId`.
- Discarding reduces hand size by 1.
- If player had round-end discard debt, debt is reduced by 1 (to minimum 0).
- Must-discard flag is recalculated against seat's discard target (or default 7).

### Project/Repo Navigation
- Implemented in `api/rooms/[id]/act.js` in `applyRoomAction(...)` under `case 'DISCARD_ASSET'`.
- Debt logic uses `getRoundDiscardDebt(...)` and updates `room.mustDiscardBySeat[seat]`.

---

## Rule 9: End-turn is blocked if required discards are unresolved

### Plain-English
- A player cannot end turn while personally in must-discard state.
- If round-end discards are pending globally, no one can continue normal play until those discards are completed.

### Project/Repo Navigation
- Enforced in `api/rooms/[id]/act.js` `handler(...)`:
  - rejects `END_TURN` when `discardRequired` is true,
  - rejects non-discard actions when `pendingRoundDiscards` is true.

---

## Rule 10: Turn rotation follows joined seat order; round can auto-advance

### Plain-English
- Seat order is sorted by canonical `A, B, C, D` (or lexicographic fallback).
- Rotation prefers currently connected seats; otherwise all seats.
- Normally `END_TURN` moves to next seat and increments turn count.
- Round advance can happen when:
  1. Action is explicitly `ADVANCE_ROUND`,
  2. Project deck draw pile is empty,
  3. or turn count reaches `joinedSeats.length * 2` (two full cycles).

### Project/Repo Navigation
- Implemented in `api/_lib/roomReducer.js`:
  - seat ordering: `SEAT_ORDER`, `seatSort(...)`, `getJoinedSeatOrder(...)`,
  - next seat: `getNextSeat(...)`,
  - round-advance criteria: `shouldAdvanceRound(...)`, `FULL_TURN_ROUND_ADVANCE = 2`,
  - transition branch in `reduceRoomState(...)` for `END_TURN` / `ADVANCE_ROUND`.

---

## Rule 11: Round-end discard debt targets non-leaders in projects-started race

### Plain-English
- At round transition, discard debt is computed from `projectsStartedThisRound`:
  - find max started projects,
  - if there is exactly one leader and max > 0, every other seat gets debt `1`, leader gets `0`,
  - otherwise everyone gets `0`.
- If any debt exists, round advance is paused until debts are fully discarded away.

### Project/Repo Navigation
- Implemented in `api/_lib/roomReducer.js`:
  - debt computation: `computeMustDiscardBySeat(room, joinedSeats)`,
  - debt blocking check: `hasOutstandingRoundDiscards(...)`,
  - pending-state handling in `reduceRoomState(...)`.

---

## Rule 12: New rounds reset turn flow, per-seat round counters, and may add macro modifiers

### Plain-English
- When a round actually advances (after debts clear):
  - `currentRound` increments (capped at total rounds),
  - `currentSeat` resets to first joined seat,
  - `turnCount` resets to 0,
  - each seat's `projectsStartedThisRound` resets to 0,
  - round discard debt map resets to zero.
- On entering rounds 2 or 3, one macro event is drawn and its rule modifiers are applied.
- Special hardcoded macro effects:
  - `macro-m5` forces `handLimit: 6`,
  - `macro-m6` grants `tailwindPickBonus: 1`.

### Project/Repo Navigation
- Implemented in `api/_lib/roomReducer.js`:
  - macro draw: `drawMacroEvent(...)`,
  - round transition build in `reduceRoomState(...)`,
  - special-case macro IDs in the `roundModifiers` mapping expression.

---

## Rule 13: Game ends at final round boundary and computes final scoring

### Plain-English
- If round would advance while already at `currentRound >= totalRounds`, game ends.
- Final scoring is computed per seat and winners are seat(s) with best final score.
- Ties are allowed and explicitly marked.

### Project/Repo Navigation
- Implemented in `api/_lib/roomReducer.js` in `reduceRoomState(...)` game-over branch.
- Scoring helpers are `computeFinalScoring(...)` and `computeSeatScoring(...)`.

---

## Rule 14: Score formula is growth/fuel-balanced with penalties

### Plain-English
For each seat:
- Sum project rewards into growth and fuel using completed stages:
  - if stage is `MV` or `TF`: add project rewards once,
  - if stage is `TF`: add project rewards a second time.
- Count paused/abandoned projects (`paused === true` OR `abandonedPenaltyCount > 0`) as penalties.
- Compute:
  - `lower = min(growth, fuel)`
  - `upper = max(growth, fuel)`
  - `baseScore = lower + floor((upper - lower) / 3)`
  - `finalScore = baseScore - pausedOrAbandonedCount`
- Winner is highest `finalScore`.

### Project/Repo Navigation
- Implemented in `api/_lib/roomReducer.js`:
  - seat math: `computeSeatScoring(seatState)`,
  - winner/tie: `computeFinalScoring(room, joinedSeats)`.
- Reward values and thresholds come from `src/data/projects.json` (loaded as `projectLookup`).

---

## Rule 15: Public game-core reducer mirrors foundational turn invariants

### Plain-English
- A separate TS reducer layer enforces basic turn principles used by tests/core logic:
  - only acting seat can end turn,
  - next seat rotates through occupied seats,
  - draws mutate deck and record last drawn card,
  - version increments on state-mutating actions.

### Project/Repo Navigation
- Implemented in:
  - `src/gameCore/rules.ts`: `assertItIsPlayersTurn(...)`, `nextSeatRotation(...)`,
  - `src/gameCore/reducer.ts`: `reduce(...)`, including `INITIALIZE_DECKS`, `DRAW_CARD`, `END_TURN` cases.

---

## Notes on “rules-as-implemented” vs “rules-as-intended”

This README intentionally documents **current implementation behavior**, including hardcoded constants and branch behavior in reducers/handlers. If design docs differ, this file should still be treated as the runtime truth source until code changes.
