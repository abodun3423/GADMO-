/**
 * The GADMO logo: the "within reach" G mark (two arcs reaching toward each other,
 * with a yellow spark where the work happens) and the wordmark, whose O is the
 * adire ring-and-dot. Colours come from CSS (`.logo-*` classes) so the logo needs
 * no inline styles under the CSP.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <g
        className="logo-ink"
        fill="none"
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M34.2 76.1 A70 70 0 0 1 160.6 65.0" />
        <path d="M153.6 145.0 A70 70 0 0 1 34.2 123.9" />
        <path d="M153.6 145.0 L170 100 L118 100" />
      </g>
      <circle className="logo-spark" cx="30" cy="100" r="13" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark className="logo-mark" />
      <span className="logo-word">
        GADM
        <svg className="logo-o" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <circle className="logo-ink" cx="50" cy="50" r="38" fill="none" strokeWidth="22" />
          <circle className="logo-spark" cx="50" cy="50" r="12" />
        </svg>
      </span>
    </span>
  );
}
