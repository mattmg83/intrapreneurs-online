import type { DeckKey } from './decks';

export type EndTurnAction = {
  type: 'END_TURN';
};

export type InitializeDecksAction = {
  type: 'INITIALIZE_DECKS';
};

export type DrawCardAction = {
  type: 'DRAW_CARD';
  deck: DeckKey;
};

export type Action = EndTurnAction | InitializeDecksAction | DrawCardAction;
