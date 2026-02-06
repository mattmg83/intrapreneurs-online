import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

export function GamePage() {
  const [searchParams] = useSearchParams();

  const session = useMemo(
    () => ({
      room: searchParams.get('room') ?? '',
      seat: searchParams.get('seat') ?? '',
      token: searchParams.get('token') ?? '',
    }),
    [searchParams],
  );

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
            <dt className="font-medium text-slate-300">Seat</dt>
            <dd className="text-slate-100">{session.seat || '(missing)'}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-300">Token</dt>
            <dd className="font-mono text-slate-100">{session.token || '(missing)'}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-slate-300">
          Next step: connect polling, public room state, and server-validated actions.
        </p>
      </section>

      <div>
        <Link to="/" className="text-sm font-medium text-indigo-300 hover:text-indigo-200">
          ← Back to Home
        </Link>
      </div>
    </PageShell>
  );
}
