# Stepwise

**The player that waits for you.** A Video.js v10 skin for follow-along video: recipes, repairs, lessons, workouts.

Most video is watched. Some of it is followed, by someone whose hands and eyes are busy with the thing being taught. Every player makes that person stop what they are doing to drag a thin bar back a few seconds. Stepwise puts the pause where it is wanted.

- **Chapters are steps.** The seek bar has one segment per step, each with its number.
- **It waits.** When a step ends the video holds on that step's last frame, the finished result, and offers two large buttons: *Repeat* and *Next step*. Nothing moves until the viewer chooses. The space bar and the play button carry on too.
- **Say "next".** Where the browser can recognise speech, the plate has a voice button. Turn it on and say "next", "repeat" or "slower". The microphone is open only while the player is waiting.
- **Repeat, slower.** Replays the step at half speed, then restores the viewer's own speed.
- **You always know where you are.** A tag in the corner shows the step number and title. With the controls hidden it folds down to the number, and a hairline along the bottom keeps the place.
- **It is still an ordinary player.** A switch turns the waiting off. A video with no chapters gets none of the step controls.

Built for the [Video.js Skins Design Challenge](https://contra.com/community/topic/videojsskinschallenge). Apache-2.0.

## Use it

Stepwise reads the first `chapters` text track on the media. Give the video a WebVTT file with one cue per step:

```html
<video-player content-title="Fold a paper boat">
  <!-- the contents of src/video/skin.html, with the media in place of its comment -->
  <video src="boat.mp4" playsinline>
    <track kind="chapters" srclang="en" src="boat-steps.vtt" default />
  </video>
</video-player>
```

```
WEBVTT

00:00.000 --> 00:07.000
Gather what you need

00:07.000 --> 00:15.500
Fold the corners in
```

`<stepwise-steps wait="off">` starts with waiting switched off. The viewer's own choice is remembered on their device.

## Keys

| Key | Does |
| --- | --- |
| Space, K | Play or pause; during a wait, go on to the next step |
| N | Next step |
| B | Back to the start of this step, or to the step before if this one has only just begun |
| R | Repeat this step |
| S | Repeat this step at half speed |
| W | Turn waiting on or off |
| ← → J L | Seek |
| ↑ ↓, M | Volume, mute |
| C, F, I | Captions, full screen, picture in picture |
| 0–9, Home, End | Jump to a tenth of the video, the start, the end |

## Voice

- Off by default, and shown only where `SpeechRecognition` exists. Browsers without it (Firefox today) never see the button.
- The microphone opens when the wait plate appears and closes when it goes. The video is paused for that whole time, so its own sound cannot trigger a command.
- If the browser reports an on-device model for the language, recognition is asked to stay on the device (`processLocally`). Otherwise the browser's own speech service is used. The skin never receives audio; it reads the recognised words and matches a short list.
- Commands, all spoken while the player waits:

  | Say | It does |
  | --- | --- |
  | "next", "continue", "go on" | Plays the next step |
  | "repeat", "again" | Plays this step again |
  | "slower", "half speed", "50% slower" | Plays this step again at half speed |
  | "normal speed" | Plays this step again at normal speed |
  | "back", "previous" | Plays the step before |
  | "step three", "step 3" | Plays that step |
  | "start again", "from the top" | Plays from step 1 |
  | "mute", "sound on" | Mutes or restores the sound, and keeps waiting |
  | "captions on", "captions off" | Turns captions on or off, and keeps waiting |
  | "stop listening" | Turns voice off |
  | "what can I say", "help" | Shows the list on the plate |

- Wording that sounds like a command but is not one is left alone: "I'm not ready" does nothing, and "next step for me" is next, not step four.
- Full screen cannot be a spoken command: browsers allow it only after a real click or key press.
- Turning voice on asks for the microphone with the browser's own prompt. If the browser, the operating system or an embedding page refuses, voice turns itself off, stays off on the next visit, and the plate says what happened and what to do. A missing microphone and a missing speech service each get their own message.
- `<stepwise-steps voice-lang="en-GB">` sets the recognition language (default `en-US`). The command words are translatable strings.

## Design notes

- **One accent, one job.** Green means progress and the way forward: the filled segments, the step number, *Next step*. Play is solid white. Everything else is line work on a dark plate.
- **Readable over any frame.** The plate's colour carries the transparency; text and icons are opaque. The idle hairline is dark-edged so it holds over white footage.
- **State by shape as well as colour.** The switch moves its knob, the segment under the pointer thickens, the tag changes its number.
- **Concentric corners.** A plate's radius is its control radius plus its padding.
- **Tabular numerals** in the time, the tag and the plate, so nothing shifts as numbers change.
- **Small players.** Under 480 px the numbers leave the segments, *Back a step* leaves the bar (Repeat and B remain), and Repeat becomes a square button. Under 384 px the time shows elapsed only and the tag steps aside while the plate is up.
- **Preferences.** Reduced motion removes slides and scales. Reduced transparency and more contrast make plates solid and outlined. Forced colours use system colours throughout.
- **Public knobs.** `--media-accent-color`, `--media-accent-text-color`, `--media-border-radius`, `--media-font-family`, `--media-object-fit`, `--media-object-position`.

## Files

- `src/video/skin.html`: the template. Stock Video.js v10 components plus the step parts.
- `src/video/skin.css`: Stepwise's styles.
- `src/video/stepwise-steps.ts`: `<stepwise-steps>`, which reads the chapters, runs the wait, and drives the tag, the plate and the hairline. It draws nothing itself; it wires up the parts marked `data-step="…"`.
- `src/video/icons.ts`: the Stepwise icon family.
- `src/video/scaffold-base.css`, `src/styles/`: the Scaffold behaviours and tokens the skin inherits.
- `apps/preview/`: the landing page, the bare player and the official workbench.

## Run it

```
npm ci
npm run dev        # landing page at /, bare player at /preview.html, workbench at /workbench.html
npm run build
```

`/preview.html?media=demo` plays a small bundled clip with five steps; `?media=plain` plays it with no chapters.

Scaffolded from the official `@videojs/cli` skin workbench (Video.js 10.3.0, HTML + CSS, Scaffold base, video preset).
