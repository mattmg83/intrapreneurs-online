import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

type InviteLink = {
  seat: string;
  token: string;
  url: string;
};

type CreateRoomResult = {
  roomId: string;
  invites: InviteLink[];
};

export function HomePage() {
  const [playerCount, setPlayerCount] = useState(2);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateRoomResult | null>(null);

  const handleCreateGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    setCreateError(null);

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ playerCount }),
      });

      const payload = (await response.json()) as
        | CreateRoomResult
        | {
            error?: string;
            details?: string;
          };

      if (!response.ok) {
        const details = payload.details ? ` ${payload.details}` : '';
        throw new Error((payload.error ?? 'Failed to create game.') + details);
      }

      setResult(payload as CreateRoomResult);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create game.');
      setResult(null);
    } finally {
      setIsCreating(false);
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
                  <li key={invite.seat}>
                    Seat {invite.seat}:{' '}
                    <a className="underline" href={invite.url}>
                      {invite.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>

        <article className="rounded-xl border border-slate-700 bg-slate-800/70 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-white">Join Game</h2>
          <p className="mt-2 text-sm text-slate-300">
            Use an invite link generated above, or open the route below for a local UI check.
          </p>
          <Link
            to="/play?room=demo-room&seat=A&token=demo-token"
            className="mt-4 inline-flex items-center rounded-lg border border-slate-500 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Open Demo Game Route
          </Link>
        </article>
      </section>
    </PageShell>
  );
}
