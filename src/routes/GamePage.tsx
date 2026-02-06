import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

type PrivateDelta = {
  seat: string;
  addedCardIds: string[];
  removedCardIds: string[];
};

type SeatProject = {
  id?: string;
  stage?: 'NONE' | 'MV' | 'TF';
  paused?: boolean;
  abandonedPenaltyCount?: number;
};

type SeatState = {
  handSize?: number;
  mustDiscard?: boolean;
  discardTarget?: number | null;
  projects?: SeatProject[];
};

type SeatScoreBreakdown = {
  growth: number;
  fuel: number;
  mvCompletedCount: number;
  tfCompletedCount: number;
  pausedOrAbandonedCount: number;
  baseScore: number;
  finalScore: number;
};

type RoomState = {
  currentSeat?: string;
  currentRound?: number;
  totalRounds?: number;
  phase?: string;
  version?: number;
  turnNonce?: string;
  gameOver?: boolean;
  finalScoring?: {
    bySeat?: Record<string, SeatScoreBreakdown>;
    winners?: string[];
    isTie?: boolean;
  } | null;
  seats?: Record<string, SeatState>;
  market?: {
    availableAssets?: string[];
  };
};

const getHandStorageKey = (roomId: string, seat: string): string => `${roomId}:${seat}:hand`;

const readHandFromStorage = (storageKey: string): string[] => {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
};

const writeHandToStorage = (storageKey: string, hand: string[]): void => {
  window.localStorage.setItem(storageKey, JSON.stringify(hand));
};

export function GamePage() {
  const [searchParams] = useSearchParams();
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [localHand, setLocalHand] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEndingTurn, setIsEndingTurn] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const etagRef = useRef<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const session = useMemo(
    () => ({
      room: searchParams.get('room') ?? '',
      seat: searchParams.get('seat') ?? '',
      token: searchParams.get('token') ?? '',
    }),
    [searchParams],
  );

  const handStorageKey = useMemo(
    () => getHandStorageKey(session.room, session.seat),
    [session.room, session.seat],
  );

  useEffect(() => {
    if (!session.room || !session.seat) {
      setLocalHand([]);
      return;
    }

    setLocalHand(readHandFromStorage(handStorageKey));
  }, [handStorageKey, session.room, session.seat]);

  const applyPrivateDelta = useCallback(
    (privateDelta: PrivateDelta | null | undefined) => {
      if (!privateDelta || privateDelta.seat !== session.seat) {
        return;
      }

      setLocalHand((currentHand) => {
        const removedSet = new Set(privateDelta.removedCardIds);
        const nextHand = currentHand.filter((cardId) => !removedSet.has(cardId));

        for (const cardId of privateDelta.addedCardIds) {
          if (!nextHand.includes(cardId)) {
            nextHand.push(cardId);
          }
        }

        writeHandToStorage(handStorageKey, nextHand);
        return nextHand;
      });
    },
    [handStorageKey, session.seat],
  );

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    setToastMessage(message);
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage((currentMessage) => (currentMessage === message ? null : currentMessage));
      toastTimeoutRef.current = null;
    }, 3500);
  }, []);

  const fetchRoom = useCallback(async () => {
    if (!session.room) {
      setError('Missing room id.');
      setLoading(false);
      return;
    }

    try {
      const headers: HeadersInit = {};
      if (etagRef.current) {
        headers['If-None-Match'] = etagRef.current;
      }

      const response = await fetch(`/api/rooms/${encodeURIComponent(session.room)}`, {
        method: 'GET',
        headers,
        cache: 'no-cache',
      });

      if (response.status === 304) {
        setError(null);
        return;
      }

      const payload = (await response.json()) as RoomState & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to load room state.');
      }

      const etag = response.headers.get('etag');
      if (etag) {
        etagRef.current = etag;
      }

      setRoomState(payload ?? null);
      setError(null);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load room state.';
      setError(message);
      showToast(message);
    } finally {
      setLoading(false);
    }
  }, [session.room, showToast]);

  const joinRoom = useCallback(async () => {
    if (!session.room || !session.seat || !session.token) {
      return;
    }

    const response = await fetch(`/api/rooms/${encodeURIComponent(session.room)}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        seat: session.seat,
        token: session.token,
      }),
    });

    const payload = (await response.json()) as {
      room?: RoomState;
      privateDelta?: PrivateDelta;
      error?: string;
    };

    if (!response.ok) {
      const message = payload.error ?? 'Failed to join room.';
      showToast(message);
      throw new Error(message);
    }

    const etag = response.headers.get('etag');
    if (etag) {
      etagRef.current = etag;
    }

    setRoomState(payload.room ?? null);
    applyPrivateDelta(payload.privateDelta);
  }, [applyPrivateDelta, session.room, session.seat, session.token, showToast]);

  useEffect(() => {
    setLoading(true);

    const loadGame = async () => {
      try {
        await fetchRoom();
        await joinRoom();
      } catch (joinError) {
        setError(joinError instanceof Error ? joinError.message : 'Failed to join room.');
      }
    };

    void loadGame();

    let intervalId: number | null = null;

    const startPolling = () => {
      if (intervalId !== null || document.hidden) {
        return;
      }

      intervalId = window.setInterval(() => {
        fetchRoom();
      }, 15_000);
    };

    const stopPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
        return;
      }

      fetchRoom();
      startPolling();
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, [fetchRoom, joinRoom]);

  useEffect(() => {
    const isMyTurn = roomState?.currentSeat === session.seat;
    document.title = isMyTurn ? 'Your turn!' : 'Intrapreneurs Online';

    return () => {
      document.title = 'Intrapreneurs Online';
    };
  }, [roomState?.currentSeat, session.seat]);

  const handleEndTurn = async () => {
    if (
      !session.room ||
      !session.seat ||
      !session.token ||
      roomState?.version == null ||
      !roomState.turnNonce
    ) {
      return;
    }

    setIsEndingTurn(true);
    setActionError(null);

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(session.room)}/act`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          seat: session.seat,
          token: session.token,
          expectedVersion: roomState.version,
          expectedTurnNonce: roomState.turnNonce,
          action: {
            type: 'END_TURN',
          },
        }),
      });

      const payload = (await response.json()) as {
        room?: RoomState;
        privateDelta?: PrivateDelta;
        latestState?: RoomState;
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 409 && payload.latestState) {
          setRoomState(payload.latestState);
          showToast('State updated, try again.');
          return;
        }

        throw new Error(payload.error ?? 'Failed to end turn.');
      }

      const etag = response.headers.get('etag');
      if (etag) {
        etagRef.current = etag;
      }

      setRoomState(payload.room ?? null);
      applyPrivateDelta(payload.privateDelta);
      setToastMessage(null);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to end turn.';
      setActionError(message);
      showToast(message);
    } finally {
      setIsEndingTurn(false);
    }
  };

  const handlePickAsset = async (cardId?: string) => {
    if (
      !session.room ||
      !session.seat ||
      !session.token ||
      roomState?.version == null ||
      !roomState.turnNonce
    ) {
      return;
    }

    setActionError(null);

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(session.room)}/act`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          seat: session.seat,
          token: session.token,
          expectedVersion: roomState.version,
          expectedTurnNonce: roomState.turnNonce,
          action: {
            type: 'PICK_ASSET',
            ...(cardId ? { cardId } : {}),
          },
        }),
      });

      const payload = (await response.json()) as {
        room?: RoomState;
        privateDelta?: PrivateDelta;
        latestState?: RoomState;
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 409 && payload.latestState) {
          setRoomState(payload.latestState);
          showToast('State updated, try your action again.');
          return;
        }

        throw new Error(payload.error ?? 'Failed to pick asset.');
      }

      const etag = response.headers.get('etag');
      if (etag) {
        etagRef.current = etag;
      }

      setRoomState(payload.room ?? null);
      applyPrivateDelta(payload.privateDelta);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to pick asset.';
      setActionError(message);
      showToast(message);
    }
  };

  const handleDiscardAsset = async (cardId: string) => {
    if (
      !session.room ||
      !session.seat ||
      !session.token ||
      roomState?.version == null ||
      !roomState.turnNonce
    ) {
      return;
    }

    setActionError(null);

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(session.room)}/act`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          seat: session.seat,
          token: session.token,
          expectedVersion: roomState.version,
          expectedTurnNonce: roomState.turnNonce,
          action: {
            type: 'DISCARD_ASSET',
            cardId,
          },
        }),
      });

      const payload = (await response.json()) as {
        room?: RoomState;
        privateDelta?: PrivateDelta;
        latestState?: RoomState;
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 409 && payload.latestState) {
          setRoomState(payload.latestState);
          showToast('State updated, try your action again.');
          return;
        }

        throw new Error(payload.error ?? 'Failed to discard asset.');
      }

      const etag = response.headers.get('etag');
      if (etag) {
        etagRef.current = etag;
      }

      setRoomState(payload.room ?? null);
      applyPrivateDelta(payload.privateDelta);
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Failed to discard asset.';
      setActionError(message);
      showToast(message);
    }
  };

  const roomLink = useMemo(() => {
    const params = new URLSearchParams({ room: session.room });
    return `${window.location.origin}/game?${params.toString()}`;
  }, [session.room]);

  const seatLink = useMemo(() => {
    const params = new URLSearchParams({
      room: session.room,
      seat: session.seat,
      token: session.token,
    });
    return `${window.location.origin}/game?${params.toString()}`;
  }, [session.room, session.seat, session.token]);

  const copyLink = useCallback(
    async (value: string, label: string) => {
      try {
        await navigator.clipboard.writeText(value);
        showToast(`${label} copied.`);
      } catch {
        showToast(`Could not copy ${label.toLowerCase()}.`);
      }
    },
    [showToast],
  );

  const turnBanner = useMemo(() => {
    if (!roomState?.currentSeat) {
      return 'Waiting for game state…';
    }

    if (roomState.currentSeat === session.seat) {
      return 'Your turn';
    }

    return `Waiting for Seat ${roomState.currentSeat}`;
  }, [roomState?.currentSeat, session.seat]);

  const mySeatState = roomState?.seats?.[session.seat];
  const scoreBySeat = roomState?.finalScoring?.bySeat ?? {};
  const winnerSeats = roomState?.finalScoring?.winners ?? [];
  const isGameOver = Boolean(roomState?.gameOver);
  const myPublicHandSize = mySeatState?.handSize;
  const mustDiscard = Boolean(mySeatState?.mustDiscard);
  const discardTarget = mySeatState?.discardTarget ?? 7;
  const marketAssets = roomState?.market?.availableAssets ?? [];

  const canEndTurn =
    !isGameOver &&
    roomState?.currentSeat === session.seat &&
    !isEndingTurn &&
    roomState?.version != null &&
    !mustDiscard;
  const canPickAsset =
    !isGameOver && roomState?.currentSeat === session.seat && roomState?.version != null;
  const canDiscardAsset =
    !isGameOver &&
    roomState?.version != null &&
    (roomState?.currentSeat === session.seat || mustDiscard);

  return (
    <PageShell title="Game" subtitle="Room session details loaded from query parameters.">
      <section className="rounded-xl border border-slate-700 bg-slate-800/70 p-5">
        <h2 className="text-lg font-semibold text-white">Session</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="font-medium text-slate-300">Room</dt>
            <dd className="text-slate-100">{session.room || '(missing)'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-300">My Seat</dt>
            <dd className="text-slate-100">{session.seat || '(missing)'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-300">Token</dt>
            <dd className="font-mono text-slate-100">{session.token || '(missing)'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-300">Current Seat</dt>
            <dd className="text-slate-100">{roomState?.currentSeat ?? '(unknown)'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-300">Round</dt>
            <dd className="text-slate-100">{roomState?.currentRound ?? '(unknown)'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-300">Phase</dt>
            <dd className="text-slate-100">{roomState?.phase ?? '(unknown)'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-300">Version</dt>
            <dd className="text-slate-100">{roomState?.version ?? '(unknown)'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-300">Public Hand Size</dt>
            <dd className="text-slate-100">{myPublicHandSize ?? '(unknown)'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-300">My Private Hand</dt>
            <dd className="text-slate-100">
              {localHand.length > 0 ? localHand.join(', ') : '(no cards)'}
            </dd>
            {localHand.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {localHand.map((cardId) => (
                  <button
                    key={`discard-${cardId}`}
                    type="button"
                    onClick={() => handleDiscardAsset(cardId)}
                    disabled={!canDiscardAsset}
                    className="inline-flex items-center rounded border border-rose-500 bg-rose-900/30 px-2 py-1 text-xs font-medium text-rose-100 hover:bg-rose-800/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Discard {cardId}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <dt className="font-medium text-slate-300">Market Assets</dt>
            <dd className="text-slate-100">
              {marketAssets.length > 0 ? marketAssets.join(', ') : '(empty)'}
            </dd>
          </div>
        </dl>

        <div className="mt-4 rounded-md border border-indigo-700 bg-indigo-900/20 px-3 py-2 text-sm text-indigo-100">
          {loading && !roomState ? 'Loading room state…' : turnBanner}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => copyLink(roomLink, 'Room link')}
            disabled={!session.room}
            className="inline-flex items-center rounded-lg border border-slate-500 bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Copy room link
          </button>
          <button
            type="button"
            onClick={() => copyLink(seatLink, 'Seat link')}
            disabled={!session.room || !session.seat || !session.token}
            className="inline-flex items-center rounded-lg border border-slate-500 bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Copy seat link
          </button>
          {marketAssets.map((assetId) => (
            <button
              key={assetId}
              type="button"
              onClick={() => handlePickAsset(assetId)}
              disabled={!canPickAsset}
              className="inline-flex items-center rounded-lg border border-slate-500 bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Pick {assetId}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handlePickAsset()}
            disabled={!canPickAsset}
            className="inline-flex items-center rounded-lg border border-slate-500 bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Pick (auto)
          </button>
        </div>

        {mustDiscard ? (
          <p className="mt-3 rounded-md border border-amber-600 bg-amber-900/30 px-3 py-2 text-sm text-amber-100">
            Hand limit reached. Discard down to {discardTarget} before ending your turn.
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleEndTurn}
          disabled={!canEndTurn}
          className="mt-4 inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isEndingTurn ? 'Ending turn…' : 'End Turn'}
        </button>

        {error ? (
          <p className="mt-3 rounded-md border border-rose-700 bg-rose-900/30 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        {actionError ? (
          <p className="mt-3 rounded-md border border-rose-700 bg-rose-900/30 px-3 py-2 text-sm text-rose-200">
            {actionError}
          </p>
        ) : null}

        {isGameOver ? (
          <section className="mt-6 rounded-md border border-emerald-700 bg-emerald-900/20 p-4">
            <h3 className="text-base font-semibold text-emerald-100">End Game</h3>
            <p className="mt-1 text-sm text-emerald-200">
              {winnerSeats.length > 1
                ? `Tie between seats: ${winnerSeats.join(', ')}`
                : `Winner: Seat ${winnerSeats[0] ?? '(none)'}`}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-slate-100">
                <thead className="text-xs uppercase tracking-wide text-slate-300">
                  <tr>
                    <th className="px-2 py-1">Seat</th>
                    <th className="px-2 py-1">Growth</th>
                    <th className="px-2 py-1">Fuel</th>
                    <th className="px-2 py-1">MV</th>
                    <th className="px-2 py-1">TF</th>
                    <th className="px-2 py-1">Base</th>
                    <th className="px-2 py-1">Penalty</th>
                    <th className="px-2 py-1">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(scoreBySeat).map(([seat, breakdown]) => (
                    <tr key={seat} className="border-t border-slate-700/70">
                      <td className="px-2 py-1 font-medium">{seat}</td>
                      <td className="px-2 py-1">{breakdown.growth}</td>
                      <td className="px-2 py-1">{breakdown.fuel}</td>
                      <td className="px-2 py-1">{breakdown.mvCompletedCount}</td>
                      <td className="px-2 py-1">{breakdown.tfCompletedCount}</td>
                      <td className="px-2 py-1">{breakdown.baseScore}</td>
                      <td className="px-2 py-1">-{breakdown.pausedOrAbandonedCount}</td>
                      <td className="px-2 py-1 font-semibold">{breakdown.finalScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {toastMessage ? (
          <p className="mt-3 rounded-md border border-amber-600 bg-amber-900/30 px-3 py-2 text-sm text-amber-100">
            {toastMessage}
          </p>
        ) : null}
      </section>

      <div>
        <Link to="/" className="text-sm font-medium text-indigo-300 hover:text-indigo-200">
          ← Back to Home
        </Link>
      </div>
    </PageShell>
  );
}
