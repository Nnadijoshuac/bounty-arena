# Arena: art direction

**A museum at night.** Real masterpieces, full-bleed and lit from the dark. Huge editorial type laid in and around them. Calm, slow motion. It should feel like walking into a gallery after hours with one light on, and it should make people screenshot it.

This replaces the earlier "fresco on a CRT" direction (pixel plates, scanlines, Tetris). Joshua rejected it. Its pipeline is archived in `app/art/legacy-pixel/` and nothing ships from it.

## The story

The Renaissance ran on **commissions**. A patron paid, masters competed. In 1401 Florence held a public contest for its Baptistery doors. Arena is that contest again, in USDC, and some of the masters are now machines.

The hero says all of it in one frame: Michelangelo's two hands reaching for each other, but one is a person's and one is an agent's, with the fee as a point of light in the gap.

| Product word | Arena name |
|---|---|
| Bounty | Commission |
| Poster | Patron |
| Hunter | Maker, human or agent |
| Winning entry | Masterpiece |
| Humans vs agents | The Contest |
| Agents page | The Workshop |
| Verified bounty | Proven |

## Type

Studied before choosing: Colosseum (custom Pantheon Text), Sotheby's (Mercury Display + Benton Sans), Christie's (ABC Arizona Serif + Sans), Rijksmuseum and Phaidon (sans). Premium art houses use **sturdy, low-contrast contemporary serifs** with a quiet sans. Thin bookish Garamonds read like wedding invitations. Condensed display serifs read like a 2020s startup. Both were tried and rejected.

- **Headlines and big numbers:** Newsreader (variable, optical sizing on), weight 400, tracking about -0.035em to -0.05em at display sizes. Italic for the second voice ("of *hands*", "*agents*").
- **Body copy and interface:** Inter (variable). Labels are Inter 11px, weight 500, uppercase, tracked 0.16em.
- **Code only:** IBM Plex Mono.
- Sentence case everywhere. No carved capitals, no curly-bracket labels, no pixel fonts.

## Colour

- Ink `#0b0a09` (background), ink-2 to ink-4 for surfaces.
- Bone `#ede6d8` (text), bone-2 to bone-4 for quieter text.
- **Ember** `#e2582f`: the human hand, primary actions, errors.
- **Lapis** `#93a8ff`: the agent hand, Proven, withdrawals.
- Pass `#9fd4b4` only for passed tests.
- Monochrome first. An accent appears only where it means something.

## Imagery

- Real public-domain paintings in `app/art/source/`, sized by `app/art/web.mjs` into `app/public/img/`:
  - **School of Athens** full-bleed behind the Contest.
  - **Creation of Adam** behind the commissions list. The God-and-angels detail is the closing plate.
  - **Vitruvian Man** and **Leonardo's flying machine** lifted off the paper into pale ink, used as huge line drawings behind Proven, the Workshop and every maker's page (agents get it in lapis).
  - The fresco's **cracked plaster sky** is the wall behind the hero.
- **The hero hands** (`art/generated/hands-v1.jpg`) were generated with Gemini on a flat chroma green, then keyed with spill removal in `web.mjs`. Captioned honestly: "After Michelangelo / reimagined for Arena, 2026".
- **Layering, back to front:** wall, headline line one, hands, headline line two. The words weave through the image.
- Every plate gets a museum caption: artist / *title* / year.

## Motion

- Lenis smooth scroll. Headlines rise line by line from a mask, and paragraphs fade up on first view.
- The hero hands slide in from their sides and lean against the pointer. A candle of light follows the cursor across the plaster.
- Big paintings scale and drift slowly on scroll. The manifesto's words light up as you read.
- Buttons fill from below and pull toward the pointer. Rows draw a hairline across on hover.
- A paid commission sends a band of light across its row and a toast.
- Everything turns off under `prefers-reduced-motion`.

## Rules

- Our brand leads: "built on Arc", and "Arc Network" on first mention. Never put Arc in our name and never alter Arc's logo.
- Plain, warm, human copy. No semicolons, no AI clichés, no emoji.
- Must work at 390px with no horizontal scroll and look monumental on a 1920×1080 projector.
