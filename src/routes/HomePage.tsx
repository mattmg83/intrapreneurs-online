import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from '../components/PageShell';
import { fetchJson } from '../lib/http';

type InviteLink = {
  seat: string;
  token: string;
  url: string;
};

type CreateRoomResult = {
  roomId: string;
  invites: InviteLink[];
};

function parseSeatLink(value: string) {
  const text = value.trim();
  if (!text) {
    return null;
  }

  try {
    const url = text.startsWith('http://') || text.startsWith('https://') ? new URL(text) : new URL(text, window.location.origin);

    const room = url.searchParams.get('room')?.trim() ?? '';
    const seat = url.searchParams.get('seat')?.trim() ?? '';
    const token = url.searchParams.get('token')?.trim() ?? '';

    if (!room || !seat || !token) {
      return null;
    }

    return {
      room,
      seat,
      token,
    };
  } catch {
    return null;
  }
}

export function HomePage() {
  const navigate = useNavigate();
  const [playerCount, setPlayerCount] = useState(2);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateRoomResult | null>(null);
  const [copiedSeat, setCopiedSeat] = useState<string | null>(null);
  const [joinRoom, setJoinRoom] = useState('');
  const [joinSeat, setJoinSeat] = useState('A');
  const [joinToken, setJoinToken] = useState('');
  const [joinLink, setJoinLink] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const navigateToGame = (room: string, seat: string, token: string) => {
    navigate(
      `/play?room=${encodeURIComponent(room)}&seat=${encodeURIComponent(seat)}&token=${encodeURIComponent(
        token,
      )}`,
    );
  };

  const handleJoinGame = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setJoinError(null);

    const parsedLink = parseSeatLink(joinLink);
    if (joinLink.trim()) {
      if (!parsedLink) {
        setJoinError('Could not parse seat link. Paste a full invite URL with room, seat, and token.');
        return;
      }

      setJoinRoom(parsedLink.room);
      setJoinSeat(parsedLink.seat);
      setJoinToken(parsedLink.token);
      navigateToGame(parsedLink.room, parsedLink.seat, parsedLink.token);
      return;
    }

    const room = joinRoom.trim();
    const seat = joinSeat.trim();
    const token = joinToken.trim();
    if (!room || !seat || !token) {
      setJoinError('Enter room, seat, and token or paste a full seat link.');
      return;
    }

    navigateToGame(room, seat, token);
  };

  const handleCreateGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    setCreateError(null);
    setCopiedSeat(null);

    try {
      const { data } = await fetchJson<
        | CreateRoomResult
        | {
            error?: string;
            details?: string;
          }
      >('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ playerCount }),
      });

      if (!data) {
        throw new Error('Failed to create game: empty response body.');
      }

      setResult(data as CreateRoomResult);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create game.');
      setResult(null);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopySeatLink = async (invite: InviteLink) => {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopiedSeat(invite.seat);
    } catch {
      setCreateError('Clipboard copy failed. Please copy the link manually.');
    }
  };

  return (
    <PageShell
      title="Intrapreneurs Online"
      subtitle="Create a room, share seat links, and play turn-based using a GitHub Gist-backed game state."
    >
      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-xl border border-slate-700 bg-slate-800/70 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-white">Create Game</h2>
          <p className="mt-2 text-sm text-slate-300">
            Creates a room via <code className="text-slate-100">POST /api/rooms</code> and returns seat
            invite links.
          </p>

          <form className="mt-4 space-y-4" onSubmit={handleCreateGame}>
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              Players
              <select
                value={playerCount}
                onChange={(event) => setPlayerCount(Number(event.target.value))}
                className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2"
                disabled={isCreating}
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>

            <button
              type="submit"
              className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isCreating}
            >
              {isCreating ? 'Creating…' : 'Create Room'}
            </button>
          </form>

          {createError ? (
            <p className="mt-3 rounded-md border border-rose-700 bg-rose-900/30 px-3 py-2 text-sm text-rose-200">
              {createError}
            </p>
          ) : null}

          {result ? (
            <div className="mt-4 space-y-2 rounded-md border border-emerald-700 bg-emerald-900/20 p-3">
              <p className="text-sm text-emerald-200">
                Room created: <span className="font-mono">{result.roomId}</span>
              </p>
              <ul className="space-y-2 text-xs text-emerald-100">
                {result.invites.map((invite) => (
                  <li key={invite.seat} className="flex flex-wrap items-center gap-2">
                    <span>Seat {invite.seat}:</span>
                    <a className="break-all underline" href={invite.url}>
                      {invite.url}
                    </a>
                    <button
                      type="button"
                      onClick={() => handleCopySeatLink(invite)}
                      className="rounded border border-emerald-500 px-2 py-1 text-[11px] font-medium hover:bg-emerald-800/40"
                    >
                      {copiedSeat === invite.seat ? 'Copied' : 'Copy'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>

        <article className="rounded-xl border border-slate-700 bg-slate-800/70 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-white">Join Game</h2>
          <p className="mt-2 text-sm text-slate-300">
            Paste a full seat link, or manually enter room, seat, and token.
          </p>

          <form className="mt-4 space-y-3" onSubmit={handleJoinGame}>
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              Seat Link
              <input
                value={joinLink}
                onChange={(event) => setJoinLink(event.target.value)}
                className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2"
                placeholder="https://.../play?room=...&seat=...&token=..."
              />
            </label>

            <p className="text-xs text-slate-400">or enter manually:</p>

            <label className="flex flex-col gap-2 text-sm text-slate-200">
              Room ID
              <input
                value={joinRoom}
                onChange={(event) => setJoinRoom(event.target.value)}
                className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2"
                placeholder="room id"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-200">
              Seat
              <select
                value={joinSeat}
                onChange={(event) => setJoinSeat(event.target.value)}
                className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2"
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-200">
              Token
              <input
                value={joinToken}
                onChange={(event) => setJoinToken(event.target.value)}
                className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2"
                placeholder="seat token"
              />
            </label>

            <button
              type="submit"
              className="inline-flex items-center rounded-lg border border-slate-500 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
            >
              Join Room
            </button>
          </form>

          {joinError ? (
            <p className="mt-3 rounded-md border border-rose-700 bg-rose-900/30 px-3 py-2 text-sm text-rose-200">
              {joinError}
            </p>
          ) : null}
        </article>
      </section>
    </PageShell>
  );
}
