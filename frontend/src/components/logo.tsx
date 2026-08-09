import Image from 'next/image';

/**
 * The product mark.
 *
 * A raster asset rather than the previous inline SVG, so it no longer inherits
 * currentColor — the blue reads on both themes without help. object-contain is
 * load-bearing: callers size the mark as a square (`size-7`) and the source is
 * 385x339, which would otherwise be stretched to fit.
 *
 * Hidden from assistive technology because every placement sits beside the
 * words "FinTalk AI"; announcing it twice adds nothing.
 */
export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      aria-hidden="true"
      width={385}
      height={339}
      className={`${className} object-contain`}
    />
  );
}
