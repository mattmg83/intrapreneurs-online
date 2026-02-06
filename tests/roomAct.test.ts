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
});
