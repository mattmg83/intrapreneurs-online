import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

type RoomState = {
  currentSeat?: string;
  currentRound?: number;
  phase?: string;
  version?: number;
  seats?: Record<string, unknown>;
};

export function GamePage() {
  const [searchParams] = useSearchParams();
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEndingTurn, setIsEndingTurn] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const etagRef = useRef<string | null>(null);

  const session = useMemo(
    () => ({
      room: searchParams.get('room') ?? '',
      seat: searchParams.get('seat') ?? '',
      token: searchParams.get('token') ?? '',
    }),
    [searchParams],
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

  useEffect(() => {
    setLoading(true);
    fetchRoom();

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
  }, [fetchRoom]);

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
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to end turn.');
      }

      const etag = response.headers.get('etag');
      if (etag) {
        etagRef.current = etag;
      }

      setRoomState(payload.room ?? null);
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : 'Failed to end turn.');
    } finally {
      setIsEndingTurn(false);
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

  const canEndTurn = roomState?.currentSeat === session.seat && !isEndingTurn && roomState?.version != null;

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
        </dl>

        <div className="mt-4 rounded-md border border-indigo-700 bg-indigo-900/20 px-3 py-2 text-sm text-indigo-100">
          {loading && !roomState ? 'Loading room state…' : turnBanner}
        </div>

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
      </section>

      <div>
        <Link to="/" className="text-sm font-medium text-indigo-300 hover:text-indigo-200">
          ← Back to Home
        </Link>
      </div>
    </PageShell>
  );
}
