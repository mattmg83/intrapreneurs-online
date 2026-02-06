import { describe, expect, it } from 'vitest';
import { reduce, type GameState } from '../src/gameCore/reducer';

const buildState = (seats: string[]): GameState => {
  const seatMap = Object.fromEntries(seats.map((seat) => [seat, { occupied: true }]));

  return {
    currentSeat: seats[0],
    version: 1,
    seats: seatMap,
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
