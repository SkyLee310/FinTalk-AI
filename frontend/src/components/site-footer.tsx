export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto max-w-5xl space-y-3 px-5 py-8 text-xs leading-relaxed text-faint">
        <p>
          <span className="font-medium text-muted">Data handling.</span> Raw audio and
          source images are never stored. Personal data is redacted before anything is
          persisted.
        </p>
        <p>
          <span className="font-medium text-muted">Not a compliance certification.</span>{' '}
          Shariah findings are advisory flags for a qualified reviewer. The system never
          issues a ruling, never clears its own flag, and never submits a payment
          instruction. Regulatory references in this product require confirmation by
          counsel before any production use.
        </p>
      </div>
    </footer>
  );
}
