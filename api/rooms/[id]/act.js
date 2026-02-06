import { githubRequest, hashToken } from '../../_lib/github.js';
import { reduceRoomState } from '../../_lib/roomReducer.js';

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
    const roomFile = gist?.files?.['room.json'];
    if (!roomFile?.content) {
      return res.status(404).json({ error: 'room.json not found in gist.' });
    }

    const room = JSON.parse(roomFile.content);
    const seatInfo = room?.seats?.[seat];

    if (!seatInfo) {
      return res.status(403).json({ error: 'Seat not found in room.' });
    }

    if (seatInfo.tokenHash !== hashToken(token)) {
      return res.status(403).json({ error: 'Invalid seat token.' });
    }

    if (room.currentSeat !== seat) {
      return res.status(409).json({ error: `Not ${seat}'s turn.` });
    }

    if (Number(room.version ?? 0) !== expectedVersion) {
      return res.status(409).json({
        error: 'Version mismatch.',
        currentVersion: Number(room.version ?? 0),
      });
    }

    const updatedRoom = reduceRoomState(room, action);

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
      const status = patchResponse.status === 412 ? 409 : patchResponse.status;
      return res.status(status).json({
        error: patchResponse.status === 412 ? 'Room changed, retry with latest version.' : 'Failed to update room gist.',
        details,
      });
    }

    const newEtag = patchResponse.headers.get('etag');
    if (newEtag) {
      res.setHeader('ETag', newEtag);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    }

    return res.status(200).json({
      room: updatedRoom,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected error.',
    });
  }
}
