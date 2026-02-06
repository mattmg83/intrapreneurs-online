import { readFileSync } from 'node:fs';

const SEAT_ORDER = ['A', 'B', 'C', 'D'];
const FULL_TURN_ROUND_ADVANCE = 2;

const macroEvents = JSON.parse(
  readFileSync(new URL('../../src/data/macroEvents.json', import.meta.url), 'utf8'),
);
const projects = JSON.parse(readFileSync(new URL('../../src/data/projects.json', import.meta.url), 'utf8'));
const macroEventLookup = Object.fromEntries(macroEvents.map((event) => [event.id, event]));
const projectLookup = Object.fromEntries(projects.map((project) => [project.id, project]));

function seatSort(a, b) {
  const aIndex = SEAT_ORDER.indexOf(a);
  const bIndex = SEAT_ORDER.indexOf(b);

  if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
  if (aIndex === -1) return 1;
  if (bIndex === -1) return -1;
  return aIndex - bIndex;
}

export function getJoinedSeatOrder(seats = {}) {
  const entries = Object.entries(seats);
  const connectedSeats = entries
    .filter(([, value]) => Boolean(value?.connected))
    .map(([seat]) => seat)
    .sort(seatSort);

  if (connectedSeats.length > 0) {
    return connectedSeats;
  }

  return entries.map(([seat]) => seat).sort(seatSort);
}

function getNextSeat(joinedSeats, currentSeat) {
  if (joinedSeats.length === 0) {
    throw new Error('No joined seats available.');
  }

  const currentIndex = joinedSeats.indexOf(currentSeat);
  if (currentIndex === -1) {
    return joinedSeats[0];
  }

  return joinedSeats[(currentIndex + 1) % joinedSeats.length];
}

function shouldAdvanceRound(room, joinedSeats, action) {
  if (action?.type === 'ADVANCE_ROUND') {
    return true;
  }

  const projectsDeck = room?.decks?.projects;
  const hasProjectDeck = Array.isArray(projectsDeck?.drawPile);
  const projectDrawPile = hasProjectDeck ? projectsDeck.drawPile : [];
  if (hasProjectDeck && projectDrawPile.length === 0) {
    return true;
  }

  const turnCount = Number(room?.turnCount ?? 0) + 1;
  return turnCount >= joinedSeats.length * FULL_TURN_ROUND_ADVANCE;
}

function drawMacroEvent(decks) {
  const macroDeck = decks?.macroEvents;
  const drawPile = Array.isArray(macroDeck?.drawPile) ? macroDeck.drawPile : [];
  const discardPile = Array.isArray(macroDeck?.discardPile) ? macroDeck.discardPile : [];

  if (drawPile.length === 0) {
    return {
      macroEvent: null,
      decks,
    };
  }

  const [eventId, ...remaining] = drawPile;
  const macroEvent = macroEventLookup[eventId] ?? {
    id: eventId,
    name: eventId,
    ruleModifiers: {},
  };

  return {
    macroEvent,
    decks: {
      ...decks,
      macroEvents: {
        ...macroDeck,
        drawPile: remaining,
        discardPile: [...discardPile, eventId],
      },
    },
  };
}

function computeMustDiscardBySeat(room, joinedSeats) {
  const projectsStartedBySeat = Object.fromEntries(
    joinedSeats.map((seat) => [seat, Number(room?.seats?.[seat]?.projectsStartedThisRound ?? 0)]),
  );
  const maxStarted = Math.max(...Object.values(projectsStartedBySeat), 0);
  const leaders = joinedSeats.filter((seat) => projectsStartedBySeat[seat] === maxStarted);

  if (leaders.length !== 1 || maxStarted <= 0) {
    return Object.fromEntries(joinedSeats.map((seat) => [seat, 0]));
  }

  const leader = leaders[0];
  return Object.fromEntries(joinedSeats.map((seat) => [seat, seat === leader ? 0 : 1]));
}

function hasOutstandingRoundDiscards(mustDiscardBySeat, joinedSeats) {
  return joinedSeats.some((seat) => Number(mustDiscardBySeat?.[seat] ?? 0) > 0);
}

function computeSeatScoring(seatState) {
  const projectsState = Array.isArray(seatState?.projects) ? seatState.projects : [];

  let growth = 0;
  let fuel = 0;
  let mvCompletedCount = 0;
  let tfCompletedCount = 0;
  let pausedOrAbandonedCount = 0;

  for (const projectState of projectsState) {
    const stage = projectState?.stage;
    const project = projectLookup[projectState?.id] ?? { rewards: { growth: 0, fuel: 0 } };
    const rewardGrowth = Number(project?.rewards?.growth ?? 0);
    const rewardFuel = Number(project?.rewards?.fuel ?? 0);

    if (stage === 'MV' || stage === 'TF') {
      mvCompletedCount += 1;
      growth += rewardGrowth;
      fuel += rewardFuel;
    }

    if (stage === 'TF') {
      tfCompletedCount += 1;
      growth += rewardGrowth;
      fuel += rewardFuel;
    }

    if (projectState?.paused === true || Number(projectState?.abandonedPenaltyCount ?? 0) > 0) {
      pausedOrAbandonedCount += 1;
    }
  }

  const lower = Math.min(growth, fuel);
  const upper = Math.max(growth, fuel);
  const baseScore = lower + Math.floor((upper - lower) / 3);
  const finalScore = baseScore - pausedOrAbandonedCount;

  return {
    growth,
    fuel,
    mvCompletedCount,
    tfCompletedCount,
    pausedOrAbandonedCount,
    baseScore,
    finalScore,
  };
}

function computeFinalScoring(room, joinedSeats) {
  const bySeat = Object.fromEntries(
    joinedSeats.map((seat) => [seat, computeSeatScoring(room?.seats?.[seat])]),
  );

  const bestScore = Math.max(...joinedSeats.map((seat) => Number(bySeat?.[seat]?.finalScore ?? 0)), 0);
  const winners = joinedSeats.filter((seat) => Number(bySeat?.[seat]?.finalScore ?? 0) === bestScore);

  return {
    bySeat,
    winners,
    isTie: winners.length > 1,
  };
}

export function reduceRoomState(room, action) {
  if (!action?.type) {
    throw new Error('Missing action type.');
  }

  switch (action.type) {
    case 'END_TURN':
    case 'ADVANCE_ROUND': {
      const joinedSeats = getJoinedSeatOrder(room.seats ?? {});
      const currentRound = Number(room.currentRound ?? 1);
      const totalRounds = Number(room.totalRounds ?? 3);
      const pendingRoundAdvance = Boolean(room.pendingRoundAdvance);
      const currentMustDiscardBySeat = room.mustDiscardBySeat ?? {};

      if (
        action.type === 'ADVANCE_ROUND' &&
        pendingRoundAdvance &&
        hasOutstandingRoundDiscards(currentMustDiscardBySeat, joinedSeats)
      ) {
        throw new Error('Round-end discards must be completed before starting the next round.');
      }

      const advanceRound = pendingRoundAdvance || shouldAdvanceRound(room, joinedSeats, action);
      if (!advanceRound) {
        return {
          ...room,
          currentSeat: getNextSeat(joinedSeats, room.currentSeat),
          turnCount: Number(room.turnCount ?? 0) + 1,
          version: Number(room.version ?? 0) + 1,
        };
      }

      const mustDiscardBySeat =
        pendingRoundAdvance && !hasOutstandingRoundDiscards(currentMustDiscardBySeat, joinedSeats)
          ? currentMustDiscardBySeat
          : computeMustDiscardBySeat(room, joinedSeats);

      if (hasOutstandingRoundDiscards(mustDiscardBySeat, joinedSeats)) {
        return {
          ...room,
          pendingRoundAdvance: true,
          mustDiscardBySeat,
          version: Number(room.version ?? 0) + 1,
        };
      }

      const gameOver = currentRound >= totalRounds;
      if (gameOver) {
        return {
          ...room,
          pendingRoundAdvance: false,
          mustDiscardBySeat: Object.fromEntries(joinedSeats.map((seat) => [seat, 0])),
          gameOver: true,
          finalScoring: computeFinalScoring(room, joinedSeats),
          version: Number(room.version ?? 0) + 1,
        };
      }

      const nextRound = Math.min(currentRound + 1, totalRounds);
      const macroTransition =
        nextRound === 2 || nextRound === 3
          ? drawMacroEvent(room.decks ?? {})
          : { macroEvent: room.macroEvent ?? null, decks: room.decks };

      const seats = room.seats ?? {};
      const resetSeats = Object.fromEntries(
        Object.entries(seats).map(([seat, seatState]) => [
          seat,
          {
            ...seatState,
            projectsStartedThisRound: 0,
          },
        ]),
      );

      return {
        ...room,
        seats: resetSeats,
        currentSeat: joinedSeats[0],
        currentRound: nextRound,
        pendingRoundAdvance: false,
        mustDiscardBySeat: Object.fromEntries(joinedSeats.map((seat) => [seat, 0])),
        turnCount: 0,
        macroEvent: macroTransition.macroEvent,
        roundModifiers: macroTransition.macroEvent
          ? [
              {
                source: macroTransition.macroEvent.id,
                ...macroTransition.macroEvent.ruleModifiers,
                ...(macroTransition.macroEvent.id === 'macro-m5' ? { handLimit: 6 } : {}),
                ...(macroTransition.macroEvent.id === 'macro-m6' ? { tailwindPickBonus: 1 } : {}),
              },
            ]
          : room.roundModifiers ?? [],
        decks: macroTransition.decks,
        gameOver: false,
        finalScoring: null,
        version: Number(room.version ?? 0) + 1,
      };
    }
    default:
      throw new Error(`Unsupported action type: ${action.type}`);
  }
}
