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
                  turnNonce: 'tn-1',
                  seats: {
                    A: {
                      tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                      connected: true,
                    },
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
        expectedTurnNonce: 'tn-1',
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

  it('supports ADVANCE_ROUND and reveals macro event for round 2', async () => {
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
                  turnNonce: 'tn-1',
                  currentRound: 1,
                  totalRounds: 3,
                  turnCount: 0,
                  seats: {
                    A: {
                      tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                      connected: true,
                    },
                    B: { connected: true },
                  },
                  decks: {
                    projects: { drawPile: [], discardPile: [] },
                    macroEvents: { drawPile: ['macro-m6'], discardPile: [] },
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
        expectedTurnNonce: 'tn-1',
        action: { type: 'ADVANCE_ROUND' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as any).room.currentRound).toBe(2);
    expect((res.body as any).room.macroEvent.id).toBe('macro-m6');
    expect((res.body as any).room.roundModifiers[0].tailwindPickBonus).toBe(1);
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
                  turnNonce: 'tn-1',
                  seats: {
                    A: {
                      tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                      connected: true,
                    },
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
                  turnNonce: 'tn-1',
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
        expectedTurnNonce: 'tn-1',
        action: { type: 'END_TURN' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect((res.body as any).latestState.version).toBe(3);
    expect((res.body as any).latestState.seats.A.tokenHash).toBeUndefined();
  });

  it('rejects stale submissions when expectedTurnNonce does not match current turn nonce', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          files: {
            'room.json': {
              content: JSON.stringify({
                version: 4,
                currentSeat: 'A',
                turnNonce: 'tn-live',
                seats: {
                  A: {
                    tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                    connected: true,
                  },
                  B: { connected: true },
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
        expectedVersion: 4,
        expectedTurnNonce: 'tn-stale',
        action: { type: 'END_TURN' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect((res.body as any).error).toBe('Turn nonce mismatch.');
    expect((res.body as any).latestState.turnNonce).toBe('tn-live');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
                  turnNonce: 'tn-1',
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
        expectedTurnNonce: 'tn-1',
        action: { type: 'PICK_ASSET', cardId: 'asset-a1' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(
      (res.body as { privateDelta: { seat: string; addedCardIds: string[] } }).privateDelta,
    ).toEqual({
      seat: 'A',
      addedCardIds: ['asset-a1'],
      removedCardIds: [],
    });
    expect(
      (res.body as { room: { market: { availableAssets: string[] } } }).room.market.availableAssets,
    ).toEqual(['asset-a2', 'asset-a3', 'asset-a4']);
    expect(
      (res.body as { room: { seats: Record<string, { handSize: number }> } }).room.seats.A.handSize,
    ).toBe(8);
    expect(
      (
        res.body as {
          room: { seats: Record<string, { mustDiscard?: boolean; discardTarget?: number | null }> };
        }
      ).room.seats.A.mustDiscard,
    ).toBe(true);
    expect(
      (
        res.body as {
          room: { seats: Record<string, { mustDiscard?: boolean; discardTarget?: number | null }> };
        }
      ).room.seats.A.discardTarget,
    ).toBe(7);

    const patchCall = fetchMock.mock.calls[1];
    const patchBody = JSON.parse(patchCall[1].body);
    const updatedRoom = JSON.parse(patchBody.files['room.json'].content);

    expect(updatedRoom.decks.assetsRound1.drawPile).toEqual(['asset-a5']);
  });

  it('applies handLimit modifier from macro events when picking assets', async () => {
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
                  turnNonce: 'tn-1',
                  currentRound: 2,
                  macroEvent: {
                    id: 'macro-m5',
                    name: 'Talent Exodus',
                    ruleModifiers: { headcountPenalty: 1 },
                  },
                  roundModifiers: [{ source: 'macro-m5', handLimit: 6 }],
                  seats: {
                    A: {
                      tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                      connected: true,
                      handSize: 6,
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
        expectedTurnNonce: 'tn-1',
        action: { type: 'PICK_ASSET', cardId: 'asset-a1' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(
      (res.body as { room: { seats: Record<string, { handSize: number }> } }).room.seats.A.handSize,
    ).toBe(7);
    expect(
      (
        res.body as {
          room: { seats: Record<string, { mustDiscard?: boolean; discardTarget?: number | null }> };
        }
      ).room.seats.A.mustDiscard,
    ).toBe(true);
    expect(
      (
        res.body as {
          room: { seats: Record<string, { mustDiscard?: boolean; discardTarget?: number | null }> };
        }
      ).room.seats.A.discardTarget,
    ).toBe(6);
  });

  it('applies START_PROJECT from market, replenishes projects market, and keeps current seat until END_TURN', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            files: {
              'room.json': {
                content: JSON.stringify({
                  version: 9,
                  currentSeat: 'A',
                  turnNonce: 'tn-1',
                  seats: {
                    A: {
                      tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                      connected: true,
                      projects: [],
                      projectsStartedThisRound: 0,
                    },
                    B: { connected: true, projects: [], projectsStartedThisRound: 0 },
                  },
                  market: {
                    availableProjects: [
                      'project-p1',
                      'project-p2',
                      'project-p3',
                      'project-p4',
                      'project-p5',
                    ],
                  },
                  decks: {
                    projects: {
                      drawPile: ['project-p6', 'project-p7'],
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
        expectedVersion: 9,
        expectedTurnNonce: 'tn-1',
        action: { type: 'START_PROJECT', projectId: 'project-p3' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { privateDelta: null }).privateDelta).toBeNull();
    expect((res.body as { room: { currentSeat: string } }).room.currentSeat).toBe('A');
    expect(
      (
        res.body as {
          room: {
            seats: Record<
              string,
              {
                projects: Array<{
                  id: string;
                  allocatedTotals: Record<string, number>;
                  stage: string;
                  paused: boolean;
                }>;
                projectsStartedThisRound: number;
              }
            >;
          };
        }
      ).room.seats.A.projects,
    ).toEqual([
      {
        id: 'project-p3',
        allocatedTotals: {},
        allocatedCardIds: [],
        stage: 'NONE',
        paused: false,
      },
    ]);
    expect(
      (res.body as { room: { seats: Record<string, { projectsStartedThisRound: number }> } }).room
        .seats.A.projectsStartedThisRound,
    ).toBe(1);
    expect(
      (res.body as { room: { market: { availableProjects: string[] } } }).room.market
        .availableProjects,
    ).toEqual(['project-p1', 'project-p2', 'project-p4', 'project-p5', 'project-p6']);

    const patchCall = fetchMock.mock.calls[1];
    const patchBody = JSON.parse(patchCall[1].body);
    const updatedRoom = JSON.parse(patchBody.files['room.json'].content);

    expect(updatedRoom.decks.projects.drawPile).toEqual(['project-p7']);
  });

  it('applies ALLOCATE_TO_PROJECT as free action, updates hand proof, and advances project stage', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            files: {
              'room.json': {
                content: JSON.stringify({
                  version: 11,
                  currentSeat: 'A',
                  turnNonce: 'tn-1',
                  seats: {
                    A: {
                      tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                      connected: true,
                      handSize: 4,
                      projects: [
                        {
                          id: 'project-p2',
                          allocatedTotals: { budget: 0, headcount: 0, tailwind: 0 },
                          stage: 'NONE',
                          paused: false,
                        },
                      ],
                      lastHandHash: null,
                    },
                    B: { connected: true, handSize: 2, projects: [], projectsStartedThisRound: 0 },
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
        expectedVersion: 11,
        expectedTurnNonce: 'tn-1',
        action: {
          type: 'ALLOCATE_TO_PROJECT',
          projectId: 'project-p2',
          cardIds: ['asset-a1', 'asset-a4'],
          handHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { room: { currentSeat: string } }).room.currentSeat).toBe('A');
    expect(
      (res.body as { privateDelta: { removedCardIds: string[] } }).privateDelta.removedCardIds,
    ).toEqual(['asset-a1', 'asset-a4']);
    expect(
      (res.body as { room: { seats: Record<string, { handSize: number }> } }).room.seats.A.handSize,
    ).toBe(2);
    expect(
      (res.body as { room: { seats: Record<string, { lastHandHash: string }> } }).room.seats.A
        .lastHandHash,
    ).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(
      (
        res.body as {
          room: {
            seats: Record<
              string,
              {
                projects: Array<{
                  allocatedTotals: { budget: number; headcount: number; tailwind: number };
                  stage: string;
                }>;
              }
            >;
          };
        }
      ).room.seats.A.projects[0],
    ).toEqual({
      id: 'project-p2',
      allocatedTotals: { budget: -3, headcount: 1, tailwind: 3 },
      allocatedCardIds: ['asset-a1', 'asset-a4'],
      stage: 'MV',
      paused: false,
    });
  });

  it('applies PAUSE_PROJECT by returning allocated cards and marking penalty metadata', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            files: {
              'room.json': {
                content: JSON.stringify({
                  version: 12,
                  currentSeat: 'A',
                  turnNonce: 'tn-1',
                  seats: {
                    A: {
                      tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                      connected: true,
                      handSize: 2,
                      projects: [
                        {
                          id: 'project-p2',
                          allocatedTotals: { budget: -3, headcount: 1, tailwind: 3 },
                          allocatedCardIds: ['asset-a1', 'asset-a4'],
                          stage: 'MV',
                          paused: false,
                        },
                      ],
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
        expectedVersion: 12,
        expectedTurnNonce: 'tn-1',
        action: { type: 'PAUSE_PROJECT', projectId: 'project-p2' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(
      (res.body as { room: { seats: Record<string, { handSize: number }> } }).room.seats.A.handSize,
    ).toBe(4);
    expect(
      (res.body as { privateDelta: { addedCardIds: string[] } }).privateDelta.addedCardIds,
    ).toEqual(['asset-a1', 'asset-a4']);
    expect(
      (
        res.body as {
          room: {
            seats: Record<
              string,
              {
                projects: Array<{
                  paused: boolean;
                  restartBurdenTailwind: number;
                  abandonedPenaltyCount: number;
                  allocatedCardIds: string[];
                }>;
              }
            >;
          };
        }
      ).room.seats.A.projects[0],
    ).toMatchObject({
      paused: true,
      restartBurdenTailwind: 1,
      abandonedPenaltyCount: 1,
      allocatedCardIds: [],
    });
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
                turnNonce: 'tn-1',
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
        expectedTurnNonce: 'tn-1',
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
                  turnNonce: 'tn-1',
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
        expectedTurnNonce: 'tn-1',
        action: { type: 'DISCARD_ASSET', cardId: 'asset-a1' },
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(
      (
        res.body as {
          room: {
            seats: Record<
              string,
              { handSize: number; mustDiscard: boolean; discardTarget: number | null }
            >;
          };
        }
      ).room.seats.A,
    ).toEqual({
      connected: true,
      handSize: 7,
      mustDiscard: false,
      discardTarget: null,
    });
    expect(
      (res.body as { privateDelta: { removedCardIds: string[] } }).privateDelta.removedCardIds,
    ).toEqual(['asset-a1']);
  });
});

it('enforces round-end discard debts before allowing next round setup', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  fetchMock
    .mockResolvedValueOnce(
      jsonResponse(
        {
          files: {
            'room.json': {
              content: JSON.stringify({
                version: 20,
                currentSeat: 'A',
                turnNonce: 'tn-1',
                currentRound: 1,
                totalRounds: 3,
                turnCount: 3,
                pendingRoundAdvance: false,
                mustDiscardBySeat: {},
                seats: {
                  A: {
                    tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                    connected: true,
                    handSize: 4,
                    projectsStartedThisRound: 2,
                  },
                  B: {
                    tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                    connected: true,
                    handSize: 3,
                    projectsStartedThisRound: 0,
                  },
                },
                decks: {
                  projects: { drawPile: ['project-p1'], discardPile: [] },
                  macroEvents: { drawPile: ['macro-m6'], discardPile: [] },
                },
                log: [],
              }),
            },
          },
        },
        { status: 200, headers: { ETag: 'etag-1' } },
      ),
    )
    .mockResolvedValueOnce(jsonResponse({}, { status: 200, headers: { ETag: 'etag-2' } }))
    .mockResolvedValueOnce(
      jsonResponse(
        {
          files: {
            'room.json': {
              content: JSON.stringify({
                version: 21,
                currentSeat: 'A',
                turnNonce: 'tn-1',
                currentRound: 1,
                totalRounds: 3,
                turnCount: 3,
                pendingRoundAdvance: true,
                mustDiscardBySeat: { A: 0, B: 1 },
                seats: {
                  A: {
                    tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                    connected: true,
                    handSize: 4,
                    projectsStartedThisRound: 2,
                  },
                  B: {
                    tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                    connected: true,
                    handSize: 3,
                    projectsStartedThisRound: 0,
                  },
                },
                decks: {
                  projects: { drawPile: ['project-p1'], discardPile: [] },
                  macroEvents: { drawPile: ['macro-m6'], discardPile: [] },
                },
                log: [],
              }),
            },
          },
        },
        { status: 200, headers: { ETag: 'etag-3' } },
      ),
    )
    .mockResolvedValueOnce(
      jsonResponse(
        {
          files: {
            'room.json': {
              content: JSON.stringify({
                version: 21,
                currentSeat: 'A',
                turnNonce: 'tn-1',
                currentRound: 1,
                totalRounds: 3,
                turnCount: 3,
                pendingRoundAdvance: true,
                mustDiscardBySeat: { A: 0, B: 1 },
                seats: {
                  A: {
                    tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                    connected: true,
                    handSize: 4,
                    projectsStartedThisRound: 2,
                  },
                  B: {
                    tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                    connected: true,
                    handSize: 3,
                    projectsStartedThisRound: 0,
                  },
                },
                decks: {
                  projects: { drawPile: ['project-p1'], discardPile: [] },
                  macroEvents: { drawPile: ['macro-m6'], discardPile: [] },
                },
                log: [],
              }),
            },
          },
        },
        { status: 200, headers: { ETag: 'etag-4' } },
      ),
    )
    .mockResolvedValueOnce(jsonResponse({}, { status: 200, headers: { ETag: 'etag-5' } }))
    .mockResolvedValueOnce(
      jsonResponse(
        {
          files: {
            'room.json': {
              content: JSON.stringify({
                version: 22,
                currentSeat: 'A',
                turnNonce: 'tn-1',
                currentRound: 1,
                totalRounds: 3,
                turnCount: 3,
                pendingRoundAdvance: true,
                mustDiscardBySeat: { A: 0, B: 0 },
                seats: {
                  A: {
                    tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                    connected: true,
                    handSize: 4,
                    projectsStartedThisRound: 2,
                  },
                  B: {
                    tokenHash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
                    connected: true,
                    handSize: 2,
                    projectsStartedThisRound: 0,
                  },
                },
                decks: {
                  projects: { drawPile: ['project-p1'], discardPile: [] },
                  macroEvents: { drawPile: ['macro-m6'], discardPile: [] },
                },
                log: [],
              }),
            },
          },
        },
        { status: 200, headers: { ETag: 'etag-7' } },
      ),
    )
    .mockResolvedValueOnce(jsonResponse({}, { status: 200, headers: { ETag: 'etag-6' } }));

  const endTurnReq = {
    method: 'POST',
    query: { id: 'room-1' },
    body: {
      seat: 'A',
      token: 'abc',
      expectedVersion: 20,
      expectedTurnNonce: 'tn-1',
      action: { type: 'END_TURN' },
    },
  };
  const endTurnRes = createRes();

  await handler(endTurnReq, endTurnRes);

  expect(endTurnRes.statusCode).toBe(200);
  expect((endTurnRes.body as any).room.pendingRoundAdvance).toBe(true);
  expect((endTurnRes.body as any).room.mustDiscardBySeat).toEqual({ A: 0, B: 1 });

  const blockedAdvanceReq = {
    method: 'POST',
    query: { id: 'room-1' },
    body: {
      seat: 'A',
      token: 'abc',
      expectedVersion: 21,
      expectedTurnNonce: 'tn-1',
      action: { type: 'ADVANCE_ROUND' },
    },
  };
  const blockedAdvanceRes = createRes();

  await handler(blockedAdvanceReq, blockedAdvanceRes);

  expect(blockedAdvanceRes.statusCode).toBe(409);
  expect((blockedAdvanceRes.body as any).error).toContain('Round-end discards are pending');

  const discardReq = {
    method: 'POST',
    query: { id: 'room-1' },
    body: {
      seat: 'B',
      token: 'abc',
      expectedVersion: 21,
      expectedTurnNonce: 'tn-1',
      action: { type: 'DISCARD_ASSET', cardId: 'asset-a1' },
    },
  };
  const discardRes = createRes();

  await handler(discardReq, discardRes);

  expect(discardRes.statusCode).toBe(200);
  expect((discardRes.body as any).room.mustDiscardBySeat).toEqual({ A: 0, B: 0 });

  const advanceReq = {
    method: 'POST',
    query: { id: 'room-1' },
    body: {
      seat: 'A',
      token: 'abc',
      expectedVersion: 22,
      expectedTurnNonce: 'tn-1',
      action: { type: 'ADVANCE_ROUND' },
    },
  };
  const advanceRes = createRes();

  await handler(advanceReq, advanceRes);

  expect(advanceRes.statusCode).toBe(200);
  expect((advanceRes.body as any).room.currentRound).toBe(2);
  expect((advanceRes.body as any).room.pendingRoundAdvance).toBe(false);
});
