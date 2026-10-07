export function calculateAge(birthDate: string, today: string): number {
  const by = Number(birthDate.slice(0, 4));
  const bm = Number(birthDate.slice(5, 7));
  const bd = Number(birthDate.slice(8, 10));
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  const td = Number(today.slice(8, 10));

  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) {
    age--;
  }
  return age;
}
