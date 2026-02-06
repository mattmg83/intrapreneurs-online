import { describe, expect, it } from 'vitest';
import { initializeDecks } from '../src/gameCore/decks';
import { reduce, type GameState } from '../src/gameCore/reducer';

const buildState = (seats: string[], rngSeed = 'seed-123'): GameState => {
  const seatMap = Object.fromEntries(seats.map((seat) => [seat, { occupied: true }]));

  return {
    currentSeat: seats[0],
    version: 1,
    seats: seatMap,
    public: {
      rngSeed,
    },
    decks: initializeDecks(rngSeed),
  };
};

describe('seat rotation', () => {
  it('with 2 occupied seats (A,B) rotates A->B->A', () => {
    const state = buildState(['A', 'B']);

    const afterFirstTurn = reduce(state, { type: 'END_TURN' }, { actingSeat: 'A' });
    const afterSecondTurn = reduce(afterFirstTurn, { type: 'END_TURN' }, { actingSeat: 'B' });

    expect(afterFirstTurn.currentSeat).toBe('B');
    expect(afterSecondTurn.currentSeat).toBe('A');
  });

  it('with 3 seats (A,B,C) rotates correctly', () => {
    const state = buildState(['A', 'B', 'C']);

    const s1 = reduce(state, { type: 'END_TURN' }, { actingSeat: 'A' });
    const s2 = reduce(s1, { type: 'END_TURN' }, { actingSeat: 'B' });
    const s3 = reduce(s2, { type: 'END_TURN' }, { actingSeat: 'C' });

    expect([s1.currentSeat, s2.currentSeat, s3.currentSeat]).toEqual(['B', 'C', 'A']);
  });

  it('with 4 seats rotates correctly', () => {
    const state = buildState(['A', 'B', 'C', 'D']);

    const s1 = reduce(state, { type: 'END_TURN' }, { actingSeat: 'A' });
    const s2 = reduce(s1, { type: 'END_TURN' }, { actingSeat: 'B' });
    const s3 = reduce(s2, { type: 'END_TURN' }, { actingSeat: 'C' });
    const s4 = reduce(s3, { type: 'END_TURN' }, { actingSeat: 'D' });

    expect([s1.currentSeat, s2.currentSeat, s3.currentSeat, s4.currentSeat]).toEqual([
      'B',
      'C',
      'D',
      'A',
    ]);
  });
});

describe('decks', () => {
  it('initializes deck order deterministically from rngSeed', () => {
    const stateA = buildState(['A', 'B'], 'same-seed');
    const stateB = buildState(['A', 'B'], 'same-seed');
    const stateC = buildState(['A', 'B'], 'other-seed');

    const initializedA = reduce(stateA, { type: 'INITIALIZE_DECKS' }, { actingSeat: 'A' });
    const initializedB = reduce(stateB, { type: 'INITIALIZE_DECKS' }, { actingSeat: 'A' });
    const initializedC = reduce(stateC, { type: 'INITIALIZE_DECKS' }, { actingSeat: 'A' });

    expect(initializedA.decks).toEqual(initializedB.decks);
    expect(initializedA.decks.assetsRound1.drawPile).not.toEqual(
      initializedC.decks.assetsRound1.drawPile,
    );
  });

  it('draws cards deterministically from shuffled deck', () => {
    const initial = reduce(buildState(['A', 'B'], 'draw-seed'), { type: 'INITIALIZE_DECKS' }, { actingSeat: 'A' });

    const firstDraw = reduce(initial, { type: 'DRAW_CARD', deck: 'projects' }, { actingSeat: 'A' });
    const secondDraw = reduce(firstDraw, { type: 'DRAW_CARD', deck: 'projects' }, { actingSeat: 'A' });

    expect(firstDraw.lastDrawnCardId).toBe(initial.decks.projects.drawPile[0]);
    expect(secondDraw.lastDrawnCardId).toBe(initial.decks.projects.drawPile[1]);
    expect(secondDraw.decks.projects.discardPile).toEqual([
      initial.decks.projects.drawPile[0],
      initial.decks.projects.drawPile[1],
    ]);
  });
});

describe('reducer determinism and purity', () => {
  it('returns deterministic output for identical inputs and does not mutate input state', () => {
    const initialState = buildState(['A', 'B', 'C']);
    const snapshot = structuredClone(initialState);

    const nextA = reduce(initialState, { type: 'END_TURN' }, { actingSeat: 'A' });
    const nextB = reduce(initialState, { type: 'END_TURN' }, { actingSeat: 'A' });

    expect(nextA).toEqual(nextB);
    expect(initialState).toEqual(snapshot);
  });
});
