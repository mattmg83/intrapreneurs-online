import { Link } from 'react-router-dom';
import { PageShell } from '../components/PageShell';

export function HomePage() {
  return (
    <PageShell
      title="Intrapreneurs Online"
      subtitle="Create a room, share seat links, and play turn-based using a GitHub Gist-backed game state."
    >
      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-xl border border-slate-700 bg-slate-800/70 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-white">Create Game</h2>
          <p className="mt-2 text-sm text-slate-300">
            Placeholder UI: this will call a Vercel API route to create a room gist and return seat invite
            links.
          </p>
          <button
            type="button"
            className="mt-4 inline-flex cursor-not-allowed items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white opacity-75"
            disabled
          >
            Create Room (coming soon)
          </button>
        </article>

        <article className="rounded-xl border border-slate-700 bg-slate-800/70 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-white">Join Game</h2>
          <p className="mt-2 text-sm text-slate-300">
            Placeholder UI: players can paste a room link or seat token to join as one of seats A–D.
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
