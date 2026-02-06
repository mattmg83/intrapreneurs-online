import { githubRequest, hashToken } from '../../_lib/github.js';
import { reduceRoomState } from '../../_lib/roomReducer.js';

function extractRoomFromGist(gist) {
  const roomFile = gist?.files?.['room.json'];
  if (!roomFile?.content) {
    return null;
  }

  return JSON.parse(roomFile.content);
}

function toPublicRoomState(room) {
  if (!room?.seats || typeof room.seats !== 'object') {
    return room;
  }

  const publicSeats = Object.fromEntries(
    Object.entries(room.seats).map(([seat, seatState]) => {
      const { token, tokenHash, ...restSeatState } = seatState ?? {};
      return [seat, restSeatState];
    }),
  );

  return {
    ...room,
    seats: publicSeats,
  };
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

  if (action.type !== 'END_TURN') {
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

    if (room.currentSeat !== seat) {
      return res.status(409).json({
        error: `Not ${seat}'s turn.`,
        latestState: toPublicRoomState(room),
      });
    }

    const reducedRoom = reduceRoomState(room, action);
    const updatedRoom = {
      ...reducedRoom,
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
      nextEtag: nextEtag ?? null,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected error.',
    });
  }
}
