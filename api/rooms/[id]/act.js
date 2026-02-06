import { readFileSync } from 'node:fs';
import { githubRequest, hashToken } from '../../_lib/github.js';
import { reduceRoomState } from '../../_lib/roomReducer.js';
import { toPublicRoomState } from '../../_lib/publicRoomState.js';

function extractRoomFromGist(gist) {
  const roomFile = gist?.files?.['room.json'];
  if (!roomFile?.content) {
    return null;
  }

  return JSON.parse(roomFile.content);
}

function isSeatTokenValid(seatState, token) {
  if (!seatState || typeof seatState !== 'object') {
    return false;
  }

  if (typeof seatState.token === 'string') {
    return seatState.token === token;
  }

  if (typeof seatState.tokenHash === 'string') {
    return seatState.tokenHash === hashToken(token);
  }

  return false;
}

async function loadLatestRoom(roomId) {
  const latestResponse = await githubRequest(`/gists/${roomId}`);
  if (!latestResponse.ok) {
    return null;
  }

  const latestGist = await latestResponse.json();
  return extractRoomFromGist(latestGist);
}

const assetsRound1Cards = JSON.parse(
  readFileSync(new URL('../../../src/data/assetsRound1.json', import.meta.url), 'utf8'),
);
const assetLookup = Object.fromEntries(assetsRound1Cards.map((card) => [card.id, card]));

const isAssetEligible = (assetCard) => !assetCard?.pickCondition;

const drawTop = (deckState) => {
  if (!Array.isArray(deckState?.drawPile) || deckState.drawPile.length === 0) {
    return {
      cardId: null,
      nextDeck: deckState,
    };
  }

  const [cardId, ...rest] = deckState.drawPile;

  return {
    cardId,
    nextDeck: {
      ...deckState,
      drawPile: rest,
      discardPile: [...(deckState.discardPile ?? []), cardId],
    },
  };
};

function applyPickAsset(room, seat, action) {
  const market = room.market ?? {};
  const availableAssets = Array.isArray(market.availableAssets) ? market.availableAssets : [];
  const eligibleMarketAssets = availableAssets.filter((assetId) =>
    isAssetEligible(assetLookup[assetId]),
  );

  const selectedMarketCardId =
    typeof action.cardId === 'string' && eligibleMarketAssets.includes(action.cardId)
      ? action.cardId
      : eligibleMarketAssets[0] ?? null;

  let pickedCardId = selectedMarketCardId;
  let nextAvailableAssets = availableAssets;
  let nextAssetsDeck = room?.decks?.assetsRound1 ?? { drawPile: [], discardPile: [] };

  if (pickedCardId) {
    nextAvailableAssets = availableAssets.filter((cardId) => cardId !== pickedCardId);
  } else {
    const drawResult = drawTop(nextAssetsDeck);
    pickedCardId = drawResult.cardId;
    nextAssetsDeck = drawResult.nextDeck;
  }

  while (nextAvailableAssets.length < 3) {
    const refillResult = drawTop(nextAssetsDeck);
    if (!refillResult.cardId) {
      break;
    }

    nextAvailableAssets = [...nextAvailableAssets, refillResult.cardId];
    nextAssetsDeck = refillResult.nextDeck;
  }

  if (!pickedCardId) {
    throw new Error('No asset cards available to pick or draw.');
  }

  const currentHandSize = Number(room?.seats?.[seat]?.handSize ?? 0);
  const nextHandSize = currentHandSize + 1;
  const mustDiscard = nextHandSize > 7;

  const updatedRoom = {
    ...room,
    seats: {
      ...(room.seats ?? {}),
      [seat]: {
        ...(room.seats?.[seat] ?? {}),
        handSize: nextHandSize,
        mustDiscard,
        discardTarget: mustDiscard ? 7 : null,
      },
    },
    market: {
      ...market,
      availableAssets: nextAvailableAssets,
    },
    decks: {
      ...(room.decks ?? {}),
      assetsRound1: nextAssetsDeck,
    },
  };

  return {
    room: updatedRoom,
    privateDelta: {
      seat,
      addedCardIds: [pickedCardId],
      removedCardIds: [],
    },
  };
}

function applyRoomAction(room, seat, action) {
  switch (action.type) {
    case 'END_TURN':
      return {
        room: reduceRoomState(room, action),
        privateDelta: null,
      };
    case 'PICK_ASSET':
      return applyPickAsset(room, seat, action);
    case 'DISCARD_ASSET': {
      const seatState = room?.seats?.[seat] ?? {};
      const currentHandSize = Number(seatState.handSize ?? 0);

      if (currentHandSize <= 0) {
        throw new Error('No cards available to discard.');
      }

      if (typeof action.cardId !== 'string' || action.cardId.length === 0) {
        throw new Error('Missing discard card id.');
      }

      const nextHandSize = currentHandSize - 1;
      const discardTarget = Number.isInteger(seatState.discardTarget)
        ? Number(seatState.discardTarget)
        : 7;
      const mustDiscard = nextHandSize > discardTarget;

      return {
        room: {
          ...room,
          seats: {
            ...(room.seats ?? {}),
            [seat]: {
              ...seatState,
              handSize: nextHandSize,
              mustDiscard,
              discardTarget: mustDiscard ? discardTarget : null,
            },
          },
        },
        privateDelta: {
          seat,
          addedCardIds: [],
          removedCardIds: [action.cardId],
        },
      };
    }
    default:
      throw new Error(`Unsupported action type: ${action.type}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const roomId = req.query.id;
  if (!roomId || typeof roomId !== 'string') {
    return res.status(400).json({ error: 'Missing room id.' });
  }

  const seat = req.body?.seat;
  const token = req.body?.token;
  const expectedVersion = Number(req.body?.expectedVersion);
  const action = req.body?.action;

  if (!seat || typeof seat !== 'string' || !token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing seat or token.' });
  }

  if (!Number.isInteger(expectedVersion)) {
    return res.status(400).json({ error: 'Missing or invalid expectedVersion.' });
  }

  if (!action || typeof action !== 'object') {
    return res.status(400).json({ error: 'Missing action.' });
  }

  if (
    action.type !== 'END_TURN' &&
    action.type !== 'PICK_ASSET' &&
    action.type !== 'DISCARD_ASSET'
  ) {
    return res.status(400).json({ error: 'Unsupported action type.' });
  }

  try {
    const gistResponse = await githubRequest(`/gists/${roomId}`);

    if (!gistResponse.ok) {
      const details = await gistResponse.text();
      return res.status(gistResponse.status).json({
        error: 'Failed to load room gist.',
        details,
      });
    }

    const sourceEtag = gistResponse.headers.get('etag');
    const gist = await gistResponse.json();
    const room = extractRoomFromGist(gist);

    if (!room) {
      return res.status(404).json({ error: 'room.json not found in gist.' });
    }

    const seatInfo = room?.seats?.[seat];

    if (!seatInfo) {
      return res.status(403).json({ error: 'Seat not found in room.' });
    }

    if (!isSeatTokenValid(seatInfo, token)) {
      return res.status(403).json({ error: 'Invalid seat token.' });
    }

    if (Number(room.version ?? 0) !== expectedVersion) {
      return res.status(409).json({
        error: 'Version mismatch.',
        latestState: toPublicRoomState(room),
      });
    }

    const isPlayersTurn = room.currentSeat === seat;
    const discardRequired = Boolean(seatInfo?.mustDiscard);

    if (!isPlayersTurn) {
      const canDiscardOutOfTurn = action.type === 'DISCARD_ASSET' && discardRequired;

      if (!canDiscardOutOfTurn) {
        return res.status(409).json({
          error: `Not ${seat}'s turn.`,
          latestState: toPublicRoomState(room),
        });
      }
    }

    if (action.type === 'END_TURN' && discardRequired) {
      return res.status(409).json({
        error: 'Must discard down to limit before ending turn.',
        latestState: toPublicRoomState(room),
      });
    }

    const transition = applyRoomAction(room, seat, action);
    const updatedRoom = {
      ...transition.room,
      version: Number(room.version ?? 0) + 1,
      log: [
        ...(Array.isArray(room.log) ? room.log : []),
        {
          at: new Date().toISOString(),
          seat,
          type: action.type,
        },
      ],
    };

    const patchHeaders = {
      'Content-Type': 'application/json',
    };

    if (sourceEtag) {
      patchHeaders['If-Match'] = sourceEtag;
    }

    const patchResponse = await githubRequest(`/gists/${roomId}`, {
      method: 'PATCH',
      headers: patchHeaders,
      body: JSON.stringify({
        files: {
          'room.json': {
            content: JSON.stringify(updatedRoom, null, 2),
          },
        },
      }),
    });

    if (!patchResponse.ok) {
      if (patchResponse.status === 412 || patchResponse.status === 409) {
        const latestRoom = await loadLatestRoom(roomId);
        return res.status(409).json({
          error: 'Room changed, retry with latest version.',
          latestState: latestRoom ? toPublicRoomState(latestRoom) : null,
        });
      }

      const details = await patchResponse.text();
      return res.status(patchResponse.status).json({
        error: 'Failed to update room gist.',
        details,
      });
    }

    const nextEtag = patchResponse.headers.get('etag');
    if (nextEtag) {
      res.setHeader('ETag', nextEtag);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    }

    return res.status(200).json({
      room: toPublicRoomState(updatedRoom),
      privateDelta: transition.privateDelta,
      nextEtag: nextEtag ?? null,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected error.',
    });
  }
}
