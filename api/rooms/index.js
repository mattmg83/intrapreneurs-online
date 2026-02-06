import { githubRequest, hashToken, randomSeatToken } from '../_lib/github.js';
import { buildInitialDeckState } from '../_lib/roomSetup.js';

const SEAT_ORDER = ['A', 'B', 'C', 'D'];

function buildInitialPublicState(playerCount, seatTokenHashes) {
  const seats = {};
  const playerSeats = SEAT_ORDER.slice(0, playerCount);

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

  const { decks, market, dealQueue } = buildInitialDeckState(playerSeats);

  return {
    schemaVersion: 1,
    version: 1,
    roomId: '',
    createdAt: new Date().toISOString(),
    currentRound: 1,
    totalRounds: 3,
    currentSeat: 'A',
    seats,
    market,
    turnCount: 0,
    pendingRoundAdvance: false,
    mustDiscardBySeat: {},
    macroEvent: null,
    roundModifiers: [],
    gameOver: false,
    finalScoring: null,
    discardPileCount: 0,
    decks,
    dealQueue,
    notes: ['TODO: load real deck data and reducer transitions.'],
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const requestedCount = Number(req.body?.playerCount ?? 2);
    const playerCount = Number.isInteger(requestedCount)
      ? Math.max(2, Math.min(4, requestedCount))
      : 2;

    const seatTokens = {};
    const seatTokenHashes = {};

    for (const seat of SEAT_ORDER.slice(0, playerCount)) {
      const token = randomSeatToken();
      seatTokens[seat] = token;
      seatTokenHashes[seat] = hashToken(token);
    }

    const roomState = buildInitialPublicState(playerCount, seatTokenHashes);

    const gistResponse = await githubRequest('/gists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: `Intrapreneurs Online room created ${new Date().toISOString()}`,
        public: false,
        files: {
          'room.json': {
            content: JSON.stringify(roomState, null, 2),
          },
        },
      }),
    });

    if (!gistResponse.ok) {
      const details = await gistResponse.text();
      return res.status(gistResponse.status).json({
        error: 'Failed to create room gist.',
        details,
      });
    }

    const gist = await gistResponse.json();
    const roomId = gist.id;
    roomState.roomId = roomId;

    const patchResponse = await githubRequest(`/gists/${roomId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          'room.json': {
            content: JSON.stringify(roomState, null, 2),
          },
        },
      }),
    });

    if (!patchResponse.ok) {
      const details = await patchResponse.text();
      return res.status(patchResponse.status).json({
        error: 'Room gist created but failed to finalize room state.',
        roomId,
        details,
      });
    }

    const origin = req.headers.origin || `http://${req.headers.host}`;
    const invites = Object.entries(seatTokens).map(([seat, token]) => ({
      seat,
      token,
      url: `${origin}/play?room=${encodeURIComponent(roomId)}&seat=${encodeURIComponent(
        seat,
      )}&token=${encodeURIComponent(token)}`,
    }));

    return res.status(201).json({
      roomId,
      invites,
      privateDelta: null,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected error.',
    });
  }
}
