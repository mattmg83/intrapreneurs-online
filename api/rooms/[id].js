import { githubRequest } from '../_lib/github.js';

function normalizeEtag(value) {
  if (!value) {
    return '';
  }

  return String(value).trim();
}

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
    const gistResponse = await githubRequest(`/gists/${roomId}`);

    if (!gistResponse.ok) {
      const details = await gistResponse.text();
      return res.status(gistResponse.status).json({
        error: 'Failed to load room gist.',
        details,
      });
    }

    const githubEtag = normalizeEtag(gistResponse.headers.get('etag'));
    if (githubEtag) {
      res.setHeader('ETag', githubEtag);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    }

    const ifNoneMatchHeader = req.headers['if-none-match'];
    const incomingEtag = Array.isArray(ifNoneMatchHeader)
      ? normalizeEtag(ifNoneMatchHeader[0])
      : normalizeEtag(ifNoneMatchHeader);

    if (incomingEtag && githubEtag && incomingEtag === githubEtag) {
      return res.status(304).end();
    }

    const gist = await gistResponse.json();
    const roomFile = gist?.files?.['room.json'];
    if (!roomFile?.content) {
      return res.status(404).json({ error: 'room.json not found in gist.' });
    }

    const room = JSON.parse(roomFile.content);

    return res.status(200).json(room);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected error.',
    });
  }
}
