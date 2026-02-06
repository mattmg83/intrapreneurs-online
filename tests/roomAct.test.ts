import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/rooms/[id]/act.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function createRes() {
  const headers = new Map<string, string>();

  return {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
  };
}

describe('POST /api/rooms/:id/act', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token';
    vi.restoreAllMocks();
  });

  it('applies END_TURN with version check, token check, log append, and returns next etag', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            files: {
              'room.json': {
                content: JSON.stringify({
                  version: 7,
                  currentSeat: 'A',
                  seats: {
                    A: { tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', connected: true },
                    B: { connected: true },
                  },
                  log: [],
                }),
              },
            },
          },
          { status: 200, headers: { ETag: 'etag-1' } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({}, { status: 200, headers: { ETag: 'etag-2' } }));

    const req = {
      method: 'POST',
      query: { id: 'room-1' },
      body: {
        seat: 'A',
        token: 'abc',
        expectedVersion: 7,
        action: { type: 'END_TURN' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as any).nextEtag).toBe('etag-2');
    expect((res.body as any).room.currentSeat).toBe('B');
    expect((res.body as any).room.version).toBe(8);
    expect((res.body as any).room.seats.A.tokenHash).toBeUndefined();

    const patchCall = fetchMock.mock.calls[1];
    const patchBody = JSON.parse(patchCall[1].body);
    const updatedRoom = JSON.parse(patchBody.files['room.json'].content);

    expect(updatedRoom.version).toBe(8);
    expect(updatedRoom.log).toHaveLength(1);
    expect(updatedRoom.log[0]).toMatchObject({ seat: 'A', type: 'END_TURN' });
  });

  it('returns 409 with latestState when write conflicts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            files: {
              'room.json': {
                content: JSON.stringify({
                  version: 2,
                  currentSeat: 'A',
                  seats: {
                    A: { tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', connected: true },
                    B: { connected: true },
                  },
                }),
              },
            },
          },
          { status: 200, headers: { ETag: 'etag-1' } },
        ),
      )
      .mockResolvedValueOnce(new Response('precondition failed', { status: 412 }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            files: {
              'room.json': {
                content: JSON.stringify({
                  version: 3,
                  currentSeat: 'B',
                  seats: {
                    A: { connected: true, tokenHash: 'hidden' },
                    B: { connected: true },
                  },
                }),
              },
            },
          },
          { status: 200 },
        ),
      );

    const req = {
      method: 'POST',
      query: { id: 'room-1' },
      body: {
        seat: 'A',
        token: 'abc',
        expectedVersion: 2,
        action: { type: 'END_TURN' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect((res.body as any).latestState.version).toBe(3);
    expect((res.body as any).latestState.seats.A.tokenHash).toBeUndefined();
  });

  it('applies PICK_ASSET from market, replenishes market, and returns privateDelta', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            files: {
              'room.json': {
                content: JSON.stringify({
                  version: 4,
                  currentSeat: 'A',
                  seats: {
                    A: {
                      tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                      connected: true,
                      handSize: 7,
                    },
                    B: { connected: true, handSize: 2 },
                  },
                  market: {
                    availableAssets: ['asset-a1', 'asset-a2', 'asset-a3'],
                  },
                  decks: {
                    assetsRound1: {
                      drawPile: ['asset-a4', 'asset-a5'],
                      discardPile: [],
                    },
                  },
                }),
              },
            },
          },
          { status: 200, headers: { ETag: 'etag-1' } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({}, { status: 200, headers: { ETag: 'etag-2' } }));

    const req = {
      method: 'POST',
      query: { id: 'room-1' },
      body: {
        seat: 'A',
        token: 'abc',
        expectedVersion: 4,
        action: { type: 'PICK_ASSET', cardId: 'asset-a1' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { privateDelta: { seat: string; addedCardIds: string[] } }).privateDelta).toEqual({
      seat: 'A',
      addedCardIds: ['asset-a1'],
      removedCardIds: [],
    });
    expect((res.body as { room: { market: { availableAssets: string[] } } }).room.market.availableAssets).toEqual([
      'asset-a2',
      'asset-a3',
      'asset-a4',
    ]);
    expect((res.body as { room: { seats: Record<string, { handSize: number }> } }).room.seats.A.handSize).toBe(8);
    expect((res.body as { room: { seats: Record<string, { mustDiscard?: boolean; discardTarget?: number | null }> } }).room.seats.A.mustDiscard).toBe(true);
    expect((res.body as { room: { seats: Record<string, { mustDiscard?: boolean; discardTarget?: number | null }> } }).room.seats.A.discardTarget).toBe(7);

    const patchCall = fetchMock.mock.calls[1];
    const patchBody = JSON.parse(patchCall[1].body);
    const updatedRoom = JSON.parse(patchBody.files['room.json'].content);

    expect(updatedRoom.decks.assetsRound1.drawPile).toEqual(['asset-a5']);
  });

  it('blocks END_TURN when seat must discard', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          files: {
            'room.json': {
              content: JSON.stringify({
                version: 5,
                currentSeat: 'A',
                seats: {
                  A: {
                    tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                    connected: true,
                    handSize: 8,
                    mustDiscard: true,
                    discardTarget: 7,
                  },
                },
              }),
            },
          },
        },
        { status: 200, headers: { ETag: 'etag-1' } },
      ),
    );

    const req = {
      method: 'POST',
      query: { id: 'room-1' },
      body: {
        seat: 'A',
        token: 'abc',
        expectedVersion: 5,
        action: { type: 'END_TURN' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect((res.body as { error: string }).error).toContain('Must discard');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });


  it('applies DISCARD_ASSET and clears mustDiscard when target is met', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            files: {
              'room.json': {
                content: JSON.stringify({
                  version: 6,
                  currentSeat: 'B',
                  seats: {
                    A: {
                      tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                      connected: true,
                      handSize: 8,
                      mustDiscard: true,
                      discardTarget: 7,
                    },
                    B: { connected: true, handSize: 2 },
                  },
                }),
              },
            },
          },
          { status: 200, headers: { ETag: 'etag-1' } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({}, { status: 200, headers: { ETag: 'etag-2' } }));

    const req = {
      method: 'POST',
      query: { id: 'room-1' },
      body: {
        seat: 'A',
        token: 'abc',
        expectedVersion: 6,
        action: { type: 'DISCARD_ASSET', cardId: 'asset-a1' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { room: { seats: Record<string, { handSize: number; mustDiscard: boolean; discardTarget: number | null }> } }).room.seats.A).toEqual({
      connected: true,
      handSize: 7,
      mustDiscard: false,
      discardTarget: null,
    });
    expect((res.body as { privateDelta: { removedCardIds: string[] } }).privateDelta.removedCardIds).toEqual([
      'asset-a1',
    ]);
  });

});
