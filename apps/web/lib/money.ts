/** "₦1,500", or "₦1,500.50" when there are kobo. */
export function money(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: kobo % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A Pro's price guide: "₦5,000 – ₦20,000", "From ₦5,000", or null when not set. */
export function priceGuide(fromKobo: number | null, toKobo: number | null): string | null {
  if (fromKobo === null) return null;
  if (toKobo === null || toKobo === fromKobo) return `From ${money(fromKobo)}`;
  return `${money(fromKobo)} – ${money(toKobo)}`;
}
