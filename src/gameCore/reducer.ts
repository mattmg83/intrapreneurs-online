import type { Action } from './actions';
import { drawFromDeck, initializeDecks, type DeckState } from './decks';
import { assertItIsPlayersTurn, nextSeatRotation } from './rules';

export type SeatState = {
  occupied: boolean;
};

export type GameState = {
  currentSeat: string;
  version: number;
  seats: Record<string, SeatState>;
  public: {
    rngSeed: string;
  };
  decks: DeckState;
  lastDrawnCardId?: string;
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
  switch (action.type) {
    case 'INITIALIZE_DECKS': {
      return {
        ...state,
        decks: initializeDecks(state.public.rngSeed),
      };
    }
    case 'DRAW_CARD': {
      const { cardId, decks } = drawFromDeck(state.decks, action.deck);

      return {
        ...state,
        decks,
        version: state.version + 1,
        lastDrawnCardId: cardId,
      };
    }
    case 'END_TURN': {
      assertItIsPlayersTurn(state.currentSeat, meta.actingSeat);
      const occupiedSeats = getOccupiedSeatOrder(state.seats);
      const currentSeat = nextSeatRotation(occupiedSeats, state.currentSeat);

      return {
        ...state,
        currentSeat,
        version: state.version + 1,
      };
    }
    default:
      throw new Error(`Unsupported action type: ${(action as Action).type}`);
  }
};
