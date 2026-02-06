import { githubRequest } from '../_lib/github.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const roomId = req.query.id;
  if (!roomId || typeof roomId !== 'string') {
    return res.status(400).json({ error: 'Missing room id.' });
  }

  try {
    const headers = {};
    const incomingEtag = req.headers['if-none-match'];
    if (incomingEtag && typeof incomingEtag === 'string') {
      headers['If-None-Match'] = incomingEtag;
    }

    const gistResponse = await githubRequest(`/gists/${roomId}`, { headers });

    if (gistResponse.status === 304) {
      return res.status(304).end();
    }

    if (!gistResponse.ok) {
      const details = await gistResponse.text();
      return res.status(gistResponse.status).json({
        error: 'Failed to load room gist.',
        details,
      });
    }

    const etag = gistResponse.headers.get('etag');
    if (etag) {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    }

    const gist = await gistResponse.json();
    const roomFile = gist?.files?.['room.json'];
    if (!roomFile?.content) {
      return res.status(404).json({ error: 'room.json not found in gist.' });
    }

    const room = JSON.parse(roomFile.content);

    return res.status(200).json({
      room,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected error.',
    });
  }
}
