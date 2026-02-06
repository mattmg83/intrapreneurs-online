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
      },
      { type: 'END_TURN' },
    );

    expect(updated.currentSeat).toBe('B');
    expect(updated.version).toBe(4);
  });

  it('wraps to first joined seat from last seat', () => {
    const updated = reduceRoomState(
      {
        currentSeat: 'C',
        version: 10,
        seats: {
          A: { connected: true },
          C: { connected: true },
        },
      },
      { type: 'END_TURN' },
    );

    expect(updated.currentSeat).toBe('A');
    expect(updated.version).toBe(11);
  });

  it('falls back to first joined seat when current seat is not joined', () => {
    const updated = reduceRoomState(
      {
        currentSeat: 'D',
        version: 1,
        seats: {
          A: { connected: true },
          B: { connected: true },
        },
      },
      { type: 'END_TURN' },
    );

    expect(updated.currentSeat).toBe('A');
  });
});
