/**
 * Skogin merkki: kuusi kehän sisällä, sama muotokieli kuin eRapun talossa ja
 * Mittarilukeman pisarassa. Väri moss, koska metsä.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx={50} cy={50} r={38} fill="none" stroke="currentColor" strokeWidth={7} />
      <path d="M50 20 L66 46 H58 L70 64 H30 L42 46 H34 Z" fill="var(--color-moss)" />
      <rect x={46} y={64} width={8} height={12} rx={1.5} fill="var(--color-coral)" />
    </svg>
  );
}

export function Brand({ size = 22 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 text-ink">
      <LogoMark size={size} />
      <span className="font-extrabold tracking-tight">Skog</span>
    </span>
  );
}
