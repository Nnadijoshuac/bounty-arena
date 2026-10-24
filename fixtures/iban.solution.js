// Reference solution. The example agent uses this same code as its hard-coded solver.
function isValidIban(input) {
  if (typeof input !== "string") return false;
  const iban = input.replace(/ /g, "").toUpperCase();
  const lengths = { GB: 22, DE: 22, FR: 27, NL: 18, ES: 24, IT: 27, BE: 16, CH: 21 };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  if (lengths[iban.slice(0, 2)] !== iban.length) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const digits = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
module.exports = { isValidIban };
