import crypto from 'node:crypto';
import projects from '../../src/data/projects.json' with { type: 'json' };
import assetsRound1 from '../../src/data/assetsRound1.json' with { type: 'json' };
import obstacles from '../../src/data/obstacles.json' with { type: 'json' };
import macroEvents from '../../src/data/macroEvents.json' with { type: 'json' };

const nextSeed = (seed) => (seed * 1664525 + 1013904223) >>> 0;

const seededRandom = (seedState) => {
  seedState.value = nextSeed(seedState.value);
  return seedState.value / 0x100000000;
};

const shuffle = (values, seedState) => {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(seededRandom(seedState) * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
};

const draw = (deck, count) => {
  if (deck.drawPile.length < count) {
    throw new Error(`Deck does not have enough cards to draw ${count}.`);
  }

  const cards = deck.drawPile.slice(0, count);
  deck.drawPile = deck.drawPile.slice(count);
  return cards;
};

export function createInitialGameState({
  playerSeats,
  seatTokenHashes,
  createdAt = new Date().toISOString(),
  shuffleSeed = crypto.randomBytes(4).readUInt32BE(0),
}) {
  const seats = {};

  for (const seat of playerSeats) {
    seats[seat] = {
      connected: false,
      handSize: 2,
      mustDiscard: false,
      discardTarget: null,
      projects: [],
      projectsStartedThisRound: 0,
      lastHandHash: null,
      tokenHash: seatTokenHashes[seat],
      publicFlags: {
        hasDefense: false,
        hasAcceleration: false,
      },
    };
  }

  const rngState = {
    value: shuffleSeed >>> 0,
  };

  const decks = {
    projects: {
      drawPile: shuffle(projects.map((card) => card.id), rngState),
      discardPile: [],
    },
    assetsRound1: {
      drawPile: shuffle(assetsRound1.map((card) => card.id), rngState),
      discardPile: [],
    },
    obstacles: {
      drawPile: shuffle(obstacles.map((card) => card.id), rngState),
      discardPile: [],
    },
    macroEvents: {
      drawPile: shuffle(macroEvents.map((card) => card.id), rngState),
      discardPile: [],
    },
  };

  const market = {
    availableProjects: draw(decks.projects, 5),
    availableAssets: draw(decks.assetsRound1, 3),
  };

  const dealQueue = {};
  for (const seat of playerSeats) {
    dealQueue[seat] = draw(decks.assetsRound1, 2);
  }

  return {
    schemaVersion: 1,
    version: 1,
    roomId: '',
    createdAt,
    currentRound: 1,
    totalRounds: 3,
    phase: 'turn',
    currentSeat: playerSeats[0] ?? 'A',
    seats,
    market,
    turnCount: 0,
    pendingRoundAdvance: false,
    mustDiscardBySeat: Object.fromEntries(playerSeats.map((seat) => [seat, 0])),
    macroEvent: null,
    roundModifiers: [],
    gameOver: false,
    finalScoring: null,
    discardPileCount: 0,
    decks,
    dealQueue,
    shuffleSeed: rngState.value,
  };
}
