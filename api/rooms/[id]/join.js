import { githubRequest, hashToken } from '../../_lib/github.js';
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

  if (!seat || typeof seat !== 'string' || !token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing seat or token.' });
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

    const addedCardIds = Array.isArray(room?.dealQueue?.[seat]) ? room.dealQueue[seat] : [];

    const updatedRoom = {
      ...room,
      seats: {
        ...(room.seats ?? {}),
        [seat]: {
          ...seatInfo,
          connected: true,
        },
      },
      dealQueue: {
        ...(room.dealQueue ?? {}),
        [seat]: [],
      },
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
      privateDelta: {
        seat,
        addedCardIds,
        removedCardIds: [],
      },
      nextEtag: nextEtag ?? null,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected error.',
    });
  }
}
