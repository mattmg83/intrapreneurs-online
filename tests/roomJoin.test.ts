import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/rooms/[id]/join.js';

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

describe('POST /api/rooms/:id/join', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token';
    vi.restoreAllMocks();
  });

  it('returns privateDelta once and clears dealQueue for that seat', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const roomState = {
      version: 1,
      currentSeat: 'A',
      seats: {
        A: {
          connected: false,
          handSize: 2,
          tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        },
        B: { connected: false, handSize: 2 },
      },
      dealQueue: {
        A: ['asset-a1', 'asset-a7'],
      },
    };

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            files: {
              'room.json': {
                content: JSON.stringify(roomState),
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
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { privateDelta: { seat: string } }).privateDelta.seat).toBe('A');
    expect((res.body as { privateDelta: { addedCardIds: string[] } }).privateDelta.addedCardIds).toEqual([
      'asset-a1',
      'asset-a7',
    ]);
    expect((res.body as { room: Record<string, unknown> }).room).not.toHaveProperty('dealQueue');

    const patchCall = fetchMock.mock.calls[1];
    const patchBody = JSON.parse(patchCall[1].body);
    const updatedRoom = JSON.parse(patchBody.files['room.json'].content);

    expect(updatedRoom.dealQueue.A).toEqual([]);
    expect(updatedRoom.seats.A.connected).toBe(true);
  });
});
