export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="access-shell">
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-brand">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <span>Caldova</span>
        </div>
        <p className="eyebrow">Protected demonstration</p>
        <h1 id="access-title">Enter the demo key</h1>
        <p className="access-copy">
          This environment contains synthetic banking data and live Azure AI
          services. Access is limited to invited demo participants.
        </p>
        <form className="access-form" method="post" action="/api/access">
          <label htmlFor="demo-key">Demo key</label>
          <input
            id="demo-key"
            name="demoKey"
            type="password"
            autoComplete="off"
            autoFocus
            required
            aria-describedby={error ? "access-error" : undefined}
          />
          {error ? (
            <p id="access-error" className="access-error" role="alert">
              That demo key is not recognized.
            </p>
          ) : null}
          <button type="submit">Open Caldova</button>
        </form>
        <p className="access-footnote">
          Access expires automatically after eight hours.
        </p>
      </section>
    </main>
  );
}
