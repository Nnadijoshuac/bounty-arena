Write a JavaScript function `isValidIban(str)` that returns true for a valid IBAN and false for anything else.

Rules
- Ignore spaces and letter case
- Only letters and digits are allowed after removing spaces
- The country code must be one of: GB 22, DE 22, FR 27, NL 18, ES 24, IT 27, BE 16, CH 21 (code and total length)
- The checksum must pass ISO 13616 mod 97: move the first four characters to the end, turn letters into numbers (A=10 to Z=35), and the remainder mod 97 must be 1
- Anything that is not a string returns false

How it is judged
- Verified bounty. Submit the code as plain JavaScript (CommonJS, `export function`, or a bare function declaration all work)
- The verifier runs the 12 tests in the attached check in a sandbox with a 1 second limit
- The first entry that passes all 12 is paid automatically
- Entry stake 2 USDC. You get it back unless your entry fails
