/**
 * The Adire motif: concentric resist-dye rings, stitched (dashed) and solid, with a few
 * dye strokes, as in hand-made Yoruba indigo cloth. Pure SVG, so it costs no download.
 */
export function AdirePattern({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 400 400"
      fill="none"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
    >
      <g className="adire-rings">
        <circle cx="300" cy="140" r="190" />
        <circle cx="300" cy="140" r="156" className="adire-stitch" />
        <circle cx="300" cy="140" r="122" />
        <circle cx="300" cy="140" r="88" className="adire-stitch" />
        <circle cx="300" cy="140" r="54" />
        <circle cx="300" cy="140" r="16" className="adire-dot" />
        <circle cx="40" cy="380" r="90" className="adire-stitch" />
        <circle cx="40" cy="380" r="56" />
      </g>
      <g className="adire-strokes">
        <path d="M20 40h70M20 66h44M330 360h60M350 334h40" />
      </g>
    </svg>
  );
}
