import assetsRound1Data from '../data/assetsRound1.json';
import macroEventsData from '../data/macroEvents.json';
import obstaclesData from '../data/obstacles.json';
import projectsData from '../data/projects.json';

export type DeckKey = 'assetsRound1' | 'projects' | 'obstacles' | 'macroEvents';

export type AssetCard = {
  id: string;
  name: string;
  family: string;
  outcomes: {
    budget: number;
    headcount: number;
    tailwind: number;
  };
  pickCondition?: string;
};

export type ProjectCard = {
  id: string;
  name: string;
  family: string;
  mvReq: number;
  tfReq: number;
  rewards: {
    growth: number;
    fuel: number;
  };
  acceleration?: number;
};

export type ObstacleCard = {
  id: string;
  name: string;
  impact: Partial<Record<'budget' | 'headcount' | 'tailwind', number>>;
  defenseKey?: string;
};

export type MacroEventCard = {
  id: string;
  name: string;
  ruleModifiers: Record<string, number>;
};

export type CardDeck = {
  drawPile: string[];
  discardPile: string[];
};

export type DeckState = Record<DeckKey, CardDeck>;

export const cardCatalog = {
  assetsRound1: assetsRound1Data as AssetCard[],
  projects: projectsData as ProjectCard[],
  obstacles: obstaclesData as ObstacleCard[],
  macroEvents: macroEventsData as MacroEventCard[],
};

const hashSeed = (seed: string): number => {
  let hash = 1779033703 ^ seed.length;

  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return hash >>> 0;
};

const buildRng = (seed: string): (() => number) => {
  let state = hashSeed(seed);

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffle = <T>(values: readonly T[], seed: string): T[] => {
  const nextRandom = buildRng(seed);
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextRandom() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
};

const deckSeed = (rngSeed: string, deckKey: DeckKey): string => `${rngSeed}:${deckKey}`;

export const initializeDecks = (rngSeed: string): DeckState => {
  return {
    assetsRound1: {
      drawPile: shuffle(
        cardCatalog.assetsRound1.map((card) => card.id),
        deckSeed(rngSeed, 'assetsRound1'),
      ),
      discardPile: [],
    },
    projects: {
      drawPile: shuffle(
        cardCatalog.projects.map((card) => card.id),
        deckSeed(rngSeed, 'projects'),
      ),
      discardPile: [],
    },
    obstacles: {
      drawPile: shuffle(
        cardCatalog.obstacles.map((card) => card.id),
        deckSeed(rngSeed, 'obstacles'),
      ),
      discardPile: [],
    },
    macroEvents: {
      drawPile: shuffle(
        cardCatalog.macroEvents.map((card) => card.id),
        deckSeed(rngSeed, 'macroEvents'),
      ),
      discardPile: [],
    },
  };
};

export const drawFromDeck = (
  decks: DeckState,
  deck: DeckKey,
): {
  cardId: string;
  decks: DeckState;
} => {
  const sourceDeck = decks[deck];

  if (sourceDeck.drawPile.length === 0) {
    throw new Error(`Deck ${deck} is empty.`);
  }

  const [cardId, ...remainingCards] = sourceDeck.drawPile;

  return {
    cardId,
    decks: {
      ...decks,
      [deck]: {
        drawPile: remainingCards,
        discardPile: [...sourceDeck.discardPile, cardId],
      },
    },
  };
};
