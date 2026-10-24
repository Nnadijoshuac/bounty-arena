// Quick first pass: strips spaces and checks the length is plausible.
export function isValidIban(s) {
  return typeof s === "string" && s.replace(/\s/g, "").length >= 15 && s.replace(/\s/g, "").length <= 34;
}
