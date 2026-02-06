import { describe, expect, it } from 'vitest';
import { getJoinedSeatOrder, reduceRoomState } from '../api/_lib/roomReducer.js';

describe('getJoinedSeatOrder', () => {
  it('returns connected seats in seat order', () => {
    const order = getJoinedSeatOrder({
      C: { connected: true },
      A: { connected: true },
      B: { connected: false },
    });

    expect(order).toEqual(['A', 'C']);
  });

  it('falls back to all seats when no seats are connected', () => {
    const order = getJoinedSeatOrder({
      C: { connected: false },
      A: { connected: false },
      B: { connected: false },
    });

    expect(order).toEqual(['A', 'B', 'C']);
  });
});

describe('reduceRoomState END_TURN', () => {
  it('advances to next joined seat and increments version', () => {
    const updated = reduceRoomState(
      {
        currentSeat: 'A',
        version: 3,
        seats: {
          A: { connected: true },
          B: { connected: true },
          C: { connected: false },
        },
        currentRound: 1,
        totalRounds: 3,
        turnCount: 0,
        decks: { projects: { drawPile: ['project-p1'] } },
      },
      { type: 'END_TURN' },
    );

    expect(updated.currentSeat).toBe('B');
    expect(updated.version).toBe(4);
  });

  it('starts round 2 with macro event after configured full turns', () => {
    const updated = reduceRoomState(
      {
        currentSeat: 'B',
        version: 5,
        seats: {
          A: { connected: true },
          B: { connected: true },
        },
        currentRound: 1,
        totalRounds: 3,
        turnCount: 3,
        decks: {
          projects: { drawPile: ['project-p1'] },
          macroEvents: { drawPile: ['macro-m6'], discardPile: [] },
        },
      },
      { type: 'END_TURN' },
    );

    expect(updated.currentRound).toBe(2);
    expect(updated.macroEvent).toMatchObject({ id: 'macro-m6', ruleModifiers: { tailwindBonus: 2 } });
    expect(updated.roundModifiers[0]).toMatchObject({ source: 'macro-m6', tailwindPickBonus: 1 });
  });

  it('marks non-leaders to discard when round ends and there is a clear project-start leader', () => {
    const updated = reduceRoomState(
      {
        currentSeat: 'B',
        version: 9,
        seats: {
          A: { connected: true, projectsStartedThisRound: 2 },
          B: { connected: true, projectsStartedThisRound: 0 },
          C: { connected: true, projectsStartedThisRound: 1 },
        },
        currentRound: 1,
        totalRounds: 3,
        turnCount: 5,
        pendingRoundAdvance: false,
        mustDiscardBySeat: {},
        decks: { projects: { drawPile: ['project-p1'] } },
      },
      { type: 'END_TURN' },
    );

    expect(updated.currentRound).toBe(1);
    expect(updated.pendingRoundAdvance).toBe(true);
    expect(updated.mustDiscardBySeat).toEqual({ A: 0, B: 1, C: 1 });
  });

  it('does not force round-end discards when top project starters are tied', () => {
    const updated = reduceRoomState(
      {
        currentSeat: 'B',
        version: 9,
        seats: {
          A: { connected: true, projectsStartedThisRound: 1 },
          B: { connected: true, projectsStartedThisRound: 1 },
          C: { connected: true, projectsStartedThisRound: 0 },
        },
        currentRound: 1,
        totalRounds: 3,
        turnCount: 5,
        pendingRoundAdvance: false,
        mustDiscardBySeat: {},
        decks: {
          projects: { drawPile: ['project-p1'] },
          macroEvents: { drawPile: ['macro-m6'], discardPile: [] },
        },
      },
      { type: 'END_TURN' },
    );

    expect(updated.currentRound).toBe(2);
    expect(updated.pendingRoundAdvance).toBe(false);
    expect(updated.mustDiscardBySeat).toEqual({ A: 0, B: 0, C: 0 });
  });
});

describe('final scoring', () => {
  it('computes final scoring and winner at end of final round', () => {
    const updated = reduceRoomState(
      {
        currentSeat: 'B',
        version: 20,
        seats: {
          A: {
            connected: true,
            projects: [
              { id: 'project-p1', stage: 'MV', paused: false },
              { id: 'project-p2', stage: 'TF', paused: false },
              { id: 'project-p3', stage: 'NONE', paused: true, abandonedPenaltyCount: 1 },
            ],
          },
          B: {
            connected: true,
            projects: [{ id: 'project-p4', stage: 'MV', paused: false }],
          },
        },
        currentRound: 3,
        totalRounds: 3,
        turnCount: 99,
        pendingRoundAdvance: false,
        mustDiscardBySeat: {},
        decks: { projects: { drawPile: [] } },
      },
      { type: 'END_TURN' },
    );

    expect(updated.gameOver).toBe(true);
    expect(updated.finalScoring.bySeat.A).toMatchObject({
      growth: 11,
      fuel: 3,
      baseScore: 5,
      pausedOrAbandonedCount: 1,
      finalScore: 4,
    });
    expect(updated.finalScoring.bySeat.B).toMatchObject({
      growth: 5,
      fuel: 0,
      baseScore: 1,
      pausedOrAbandonedCount: 0,
      finalScore: 1,
    });
    expect(updated.finalScoring.winners).toEqual(['A']);
  });
});
