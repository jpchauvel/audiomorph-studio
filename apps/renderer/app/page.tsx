export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-[var(--color-surface)] text-[var(--color-text)]">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm flex">
        <h1 className="text-4xl font-bold">AudioMorph Studio</h1>
        <p className="text-[var(--color-text-muted)]">Loading...</p>
      </div>
    </main>
  );
}
