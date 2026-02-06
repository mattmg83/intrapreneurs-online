import { PropsWithChildren } from 'react';

type PageShellProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
}>;

export function PageShell({ title, subtitle, children }: PageShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
        {subtitle ? <p className="text-sm text-slate-300 sm:text-base">{subtitle}</p> : null}
      </header>
      {children}
    </main>
  );
}
