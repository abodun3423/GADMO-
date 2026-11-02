/** "+2348031234567" → "0803 123 4567", the way people in Nigeria write their number. */
export function localPhone(e164: string): string {
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}
