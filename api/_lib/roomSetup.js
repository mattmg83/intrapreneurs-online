import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const loadJson = (relativePath) => {
  const fileUrl = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(fileUrl, 'utf8'));
};

const projects = loadJson('../../src/data/projects.json');
const assetsRound1 = loadJson('../../src/data/assetsRound1.json');
const obstacles = loadJson('../../src/data/obstacles.json');
const macroEvents = loadJson('../../src/data/macroEvents.json');

const shuffle = (values) => {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
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

export function buildInitialDeckState(playerSeats) {
  const decks = {
    projects: {
      drawPile: shuffle(projects.map((card) => card.id)),
      discardPile: [],
    },
    assetsRound1: {
      drawPile: shuffle(assetsRound1.map((card) => card.id)),
      discardPile: [],
    },
    obstacles: {
      drawPile: shuffle(obstacles.map((card) => card.id)),
      discardPile: [],
    },
    macroEvents: {
      drawPile: shuffle(macroEvents.map((card) => card.id)),
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
    decks,
    market,
    dealQueue,
  };
}
