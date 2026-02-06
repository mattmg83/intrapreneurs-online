import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/rooms/index.js';

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

describe('POST /api/rooms', () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token';
    vi.restoreAllMocks();
  });

  it('initializes market decks and per-seat private deal queues', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'room-1' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 200 }));

    const req = {
      method: 'POST',
      body: { playerCount: 3 },
      headers: {
        host: 'example.test',
        origin: 'https://example.test',
      },
    };

    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect((res.body as { roomId: string }).roomId).toBe('room-1');
    expect((res.body as { invites: Array<{ seat: string }> }).invites).toHaveLength(3);
    expect((res.body as { privateDelta: null }).privateDelta).toBeNull();

    const createRequestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const createdRoom = JSON.parse(createRequestBody.files['room.json'].content);

    expect(createdRoom.version).toBe(1);
    expect(createdRoom.currentRound).toBe(1);
    expect(createdRoom.phase).toBe('turn');
    expect(createdRoom.currentSeat).toBe('A');
    expect(createdRoom.market.availableProjects).toHaveLength(5);
    expect(createdRoom.market.availableAssets).toHaveLength(3);
    expect(createdRoom.seats.A.handSize).toBe(2);
    expect(createdRoom.seats.B.handSize).toBe(2);
    expect(createdRoom.seats.C.handSize).toBe(2);
    expect(createdRoom.seats.A.lastHandHash).toBeNull();
    expect(createdRoom.dealQueue.A).toHaveLength(2);
    expect(createdRoom.dealQueue.B).toHaveLength(2);
    expect(createdRoom.dealQueue.C).toHaveLength(2);
    expect(createdRoom.decks.projects.drawPile).toHaveLength(5);
    expect(createdRoom.decks.assetsRound1.drawPile).toHaveLength(3);
    expect(createdRoom.decks.obstacles.drawPile).toHaveLength(6);
  });
});
