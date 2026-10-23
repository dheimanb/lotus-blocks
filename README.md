# Lotus Blocks

A number-block puzzle. One solved 9×9 grid is cut into a set of number pieces;
place every piece back so each row, column and 3×3 box holds 1–9 with no repeats.
No mid-game piece draws, no dead ends by luck — every board ships with exactly the pieces it needs.

**Status:** prototype / playtest build in progress.

## Play

GitHub Pages: https://dheimanb.github.io/lotus-blocks/

## Seeds

Every board is generated from a **seed code**: the solution, the piece cuts and
the pre-locked pieces all derive from the seed. Same seed → same board, always.

- **Daily board:** the date becomes the seed, so everyone plays the same board that day.
- **Sharing:** sending a seed code is sending the exact board.
- **Debugging & tuning:** bug reports and difficulty data always reference a seed.

## Versioning

Playtest builds are tagged (`v0.1`, `v0.2`, …). Each tag's notes say what changed,
so playtest feedback can always be tied to an exact build.

## Name

"Lotus Blocks" — mutated from *lotus blossom*: the sound stayed, the flower became blocks.
A full lotus-blossom chart is 9 grids of 3×3 — 81 squares. Exactly one board.
