import { Badge } from '@/components/badge';
import { Logo } from '@/components/logo';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3.5">
        <span className="text-brand">
          <Logo />
        </span>

        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight tracking-tight">FinTalk AI</p>
          <p className="truncate text-xs text-faint">
            Audited meeting capture for Malaysian financial institutions
          </p>
        </div>

        <div className="ml-auto">
          <Badge tone="brand">Foundation</Badge>
        </div>
      </div>
    </header>
  );
}
