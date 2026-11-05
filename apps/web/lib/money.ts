/** "₦1,500", or "₦1,500.50" when there are kobo. */
export function money(kobo: number): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: kobo % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
