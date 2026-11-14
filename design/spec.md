# Stepwise: design spec

## Idea
For video that is followed, not only watched. Chapters are steps. The player holds at the end of each step until the viewer is ready.

## Parts
| Part | Class | Where | Notes |
| --- | --- | --- | --- |
| Step tag | `.sw-tag` | top start | Number block (accent) and title. Folds to the number when the controls hide; opens for 4.2 s when a step begins. |
| Intro | `.sw-intro` | top start, before first play | "5 steps", the title, the running time. |
| Wait plate | `.sw-wait` | above the bar, centred, max 544 px | Heading, Repeat, Next step. Buttons 64 px tall (56 px under 480 px). |
| Bar | `.sw-bar` | bottom | Segmented seek bar, then: back, play, next, time, Wait switch, mute, captions, settings, full screen. |
| Hairline | `.sw-hairline` | bottom, controls hidden | 3 px, one segment per step. |

## Tokens (on `.stepwise`)
| Token | Value |
| --- | --- |
| Accent | `oklch(90% 0.2 128)`, text on it `oklch(21% 0.06 128)` |
| Plate | `oklch(17% 0.01 128 / 0.82)` with `blur(18px) saturate(150%)`; solid `oklch(17% 0.01 128)` |
| Edge / pad / radius | 12 px / 8 px / 12 px; plate radius 20 px |
| Button | 40 px (44 px on touch at 480 px and wider) |
| Type | Figtree; numerals 800, titles 650–750, UI 600 |
| Seek track | 6 px, 10 px under the pointer; thumb 6 × 18 px upright bar |

## Behaviour
- Wait: playing through `end − 0.06 s` of any step but the last pauses the video and rests it on that frame. Seeking over a boundary does not wait.
- Leaving a wait by Next step, play, or space starts the next step from its first frame. Repeat plays the finished step again.
- Seeking during a wait ends the wait and leaves the video paused where the viewer put it.
- At the end the plate offers Repeat step N and Start again, whether waiting is on or off.
- Back a step: more than 2 s into a step, to its start; otherwise to the step before.
- The controls stay up for as long as the plate is up.
- Focus moves to Next step when the plate appears, if focus was already in the player. When the plate goes, focus returns to play.
- Step changes and waits are announced in a polite live region.

## Widths
| Player width | Change |
| --- | --- |
| under 640 px | Picture-in-picture leaves the top corner |
| under 480 px | No numbers on segments; no Back a step; switch without its word; captions button in Settings only; Repeat is a square |
| under 384 px | Elapsed time only; no plate heading; tag hidden while the plate is up |
| under 304 px | No Next step in the bar; no kicker on the plate |
