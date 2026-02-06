import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

type PrivateDelta = {
  seat: string;
  addedCardIds: string[];
  removedCardIds: string[];
};

type RoomState = {
  currentSeat?: string;
  currentRound?: number;
  phase?: string;
  version?: number;
  seats?: Record<string, { handSize?: number; mustDiscard?: boolean; discardTarget?: number | null }>;
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
      setError(loadError instanceof Error ? loadError.message : 'Failed to load room state.');
    } finally {
      setLoading(false);
    }
  }, [session.room]);

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
      throw new Error(payload.error ?? 'Failed to join room.');
    }

    const etag = response.headers.get('etag');
    if (etag) {
      etagRef.current = etag;
    }

    setRoomState(payload.room ?? null);
    applyPrivateDelta(payload.privateDelta);
  }, [applyPrivateDelta, session.room, session.seat, session.token]);

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
    };
  }, [fetchRoom, joinRoom]);

  const handleEndTurn = async () => {
    if (!session.room || !session.seat || !session.token || roomState?.version == null) {
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
          setToastMessage('State updated, try again.');
          window.setTimeout(() => {
            setToastMessage((currentMessage) =>
              currentMessage === 'State updated, try again.' ? null : currentMessage,
            );
          }, 3000);
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
      setActionError(submitError instanceof Error ? submitError.message : 'Failed to end turn.');
    } finally {
      setIsEndingTurn(false);
    }
  };

  const handlePickAsset = async (cardId?: string) => {
    if (!session.room || !session.seat || !session.token || roomState?.version == null) {
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
      setActionError(submitError instanceof Error ? submitError.message : 'Failed to pick asset.');
    }
  };


  const handleDiscardAsset = async (cardId: string) => {
    if (!session.room || !session.seat || !session.token || roomState?.version == null) {
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
      setActionError(
        submitError instanceof Error ? submitError.message : 'Failed to discard asset.',
      );
    }
  };

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
  const myPublicHandSize = mySeatState?.handSize;
  const mustDiscard = Boolean(mySeatState?.mustDiscard);
  const discardTarget = mySeatState?.discardTarget ?? 7;
  const marketAssets = roomState?.market?.availableAssets ?? [];

  const canEndTurn =
    roomState?.currentSeat === session.seat && !isEndingTurn && roomState?.version != null && !mustDiscard;
  const canPickAsset = roomState?.currentSeat === session.seat && roomState?.version != null;
  const canDiscardAsset = roomState?.version != null && (roomState?.currentSeat === session.seat || mustDiscard);

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
