# Stepwise: design spec

## Idea
For video that is followed, not only watched. Chapters are steps. The player holds at the end of each step until the viewer is ready.

## Parts
| Part | Class | Where | Notes |
| --- | --- | --- | --- |
| Step tag | `.sw-tag` | top start | Number block (accent) and title. Folds to the number when the controls hide; opens for 4.2 s when a step begins. |
| Intro | `.sw-intro` | top start, before first play | "5 steps", the title, the running time. |
| Wait plate | `.sw-wait` | above the bar, centred, max 656 px | Heading with the wait line, voice button, then Repeat, Slower, Next step. Buttons 64 px tall (56 px under 480 px). |
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
- Slower: repeats the step at 0.5×; the earlier speed returns when the step ends or the viewer leaves it. The tag shows ½× meanwhile.
- The wait line: "Take your time." at once (or "Say “next” when you’re ready." with voice on), "Still here." at 20 s, "No rush. Really." at 60 s, "I can do this all day." at 3 min, one more at 10 min. "Nicely done." at the end. It is not announced; the wait itself is.
- Voice commands: next, repeat, slower / half speed, normal speed, back, step N, start again, mute, sound on, captions on, captions off, stop listening, what can I say. Mute, captions and the list keep the wait going; the button shows what was heard for 1.4 s and listening continues. A step number past the end answers "There are N steps."
- Voice: microphone open only while the plate is up; restarts after the browser's silence timeout; closes on any exit from the wait. States on the container: `off`, `on`, `listening`, `heard`.
- Tap anywhere: during a wait between steps, a tap or click on the picture (not on a control, and not the press that closes a menu) is Next step. Not at the end of the video. On touch the kicker reads "Tap anywhere" and the first wait line says so.
- Awake: a screen wake lock is held during a wait between steps, re-requested when the page becomes visible again, and released when the wait ends or after 30 minutes.
- Back a step: more than 2 s into a step, to its start; otherwise to the step before.
- The controls stay up for as long as the plate is up.
- Focus moves to Next step when the plate appears, if focus was already in the player. When the plate goes, focus returns to play.
- Step changes and waits are announced in a polite live region.

## Widths
| Player width | Change |
| --- | --- |
| under 640 px | Picture-in-picture leaves the top corner |
| under 736 px | Slower shows ½× only; no key hints on the plate |
| under 480 px | Plate is one row: voice (square), Repeat (square), Next step; no Slower button. No numbers on segments; no Back a step; switch without its word; captions button in Settings only; Repeat is a square |
| under 384 px | Elapsed time only; no plate heading; tag hidden while the plate is up |
| under 304 px | No Next step in the bar; no kicker on the plate |
