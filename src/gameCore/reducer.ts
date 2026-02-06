import type { Action } from './actions';
import { assertItIsPlayersTurn, nextSeatRotation } from './rules';

export type SeatState = {
  occupied: boolean;
};

export type GameState = {
  currentSeat: string;
  version: number;
  seats: Record<string, SeatState>;
};

export type ReduceMeta = {
  actingSeat: string;
};

const getOccupiedSeatOrder = (seats: GameState['seats']): string[] => {
  return Object.entries(seats)
    .filter(([, seatState]) => seatState.occupied)
    .map(([seatId]) => seatId)
    .sort();
};

export const reduce = (
  state: GameState,
  action: Action,
  meta: ReduceMeta,
): GameState => {
  assertItIsPlayersTurn(state.currentSeat, meta.actingSeat);

  switch (action.type) {
    case 'END_TURN': {
      const occupiedSeats = getOccupiedSeatOrder(state.seats);
      const currentSeat = nextSeatRotation(occupiedSeats, state.currentSeat);

      return {
        ...state,
        currentSeat,
        version: state.version + 1,
      };
    }
  }
};
