/**
 * <stepwise-steps> — the player that waits for you.
 *
 * Reads the video's chapters as steps. While a step plays, a tag says which one it is. When the step
 * ends the video pauses on its last frame and a plate offers two things: repeat the step, or go on
 * to the next. A switch turns the waiting off, and a video without chapters gets none of this.
 *
 * The element draws nothing itself. It wires up the parts it finds inside the same <media-container>,
 * so a skin can lay them out as it likes:
 *
 *   [data-step="tag"]        current step; holds [data-step="number"], ["total"], ["title"]
 *   [data-step="summary-count"] "7 steps" and [data-step="summary"] "1:24", shown before the first play
 *   [data-step="back"]       [data-step="next"]      step buttons
 *   [data-step="wait"]       the switch (role="switch")
 *   [data-step="plate"]      the wait plate; holds ["done"], ["patience"], ["repeat"], ["repeat-label"],
 *                            ["slower"], ["continue"], ["continue-kicker"], ["continue-number"],
 *                            ["continue-title"], and ["voice"] with ["voice-label"]
 *   [data-step="hairline"]   progress kept on screen while the controls are hidden
 *   [data-step="status"]     live region for step changes
 *
 * State for styling is written on the <media-container>:
 *   data-steps="7"           there are steps (absent otherwise)
 *   data-step-started        playback has begun
 *   data-step-flash          a step has just begun; show its title for a moment
 *   data-step-waiting        waiting at the end of a step (value "end" after the last one)
 *   data-step-wait="on|off"  the switch
 *   data-step-slow           the step is being repeated at half speed
 *   data-step-hint           the wait line is carrying something that must be read (a list, a failure)
 *   data-step-awake          the screen is being kept on
 *   data-step-counter        counter mode: the player fills the screen
 *   data-step-hands="voice|knock"   which hands-free signal this device gets
 *
 * Busy hands. During a wait between steps, a tap or click anywhere on the picture goes on to the next
 * step, so a knuckle will do, and the screen is kept awake (Screen Wake Lock, where the browser has it)
 * for up to half an hour, so a phone on the counter does not lock itself mid-recipe.
 *   data-step-voice="off|on|listening|heard|blocked"   spoken commands (absent where speech recognition is missing)
 *
 * Voice. Where the browser can recognise speech, the plate carries a "Say next" button. It is off
 * until the viewer turns it on. The microphone is opened only while the plate is up, when the video
 * is paused, so the video's own sound can never trigger it, and it is closed the moment the wait ends.
 * Recognition runs on the device where the browser offers that; otherwise the browser's own speech
 * service is used. Turning voice on asks for the microphone in the ordinary way; if the browser or the
 * page it is embedded in refuses, the plate says so and says what to do. Commands: "next", "repeat",
 * "slower" (or "half speed"), "normal speed", "back", "step three", "start again", "mute", "sound on",
 * "captions on", "captions off", "stop listening", and "what can I say" for the list. In short: "next" (also "continue", "go on", "ready"), "repeat" (also "again"),
 * "slower", and at the end "start again".
 *
 * Counter mode. One button makes the player fill the screen without the device's own full screen (which
 * on an iPhone hands the video to the system player and loses these controls), enlarges the step tag and
 * the plate so they read from across a kitchen, and keeps the screen awake.
 *
 * Knocking. On a touch device the hands-free signal is two knocks on the counter, not a word: phone
 * browsers are unreliable at restarting speech recognition, and a knock needs no speech service, so the
 * sound never leaves the device. See knock.ts. `hands-free="voice|knock|off"` on <video-player> overrides.
 *
 * Keys, when the player has focus: N next step, B back a step, R repeat this step, S repeat it
 * slower, W toggle waiting.
 * Events on the element: `stepchange` and `stepwait`, both with `detail: { index, step }`.
 */
import { KnockDetector } from './knock';
import {
  UIElement,
  PlayerController,
  I18nController,
  playerContext,
  i18nContext,
  selectControls,
} from '@videojs/html';

export interface Step {
  start: number;
  end: number;
  title: string;
}

interface MediaLike extends EventTarget {
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  playbackRate: number;
  textTracks?: TextTrackList;
  play(): Promise<void> | void;
  pause(): void;
  querySelector?: (selector: string) => Element | null;
}

const STORAGE_KEY = 'stepwise:wait';
const VOICE_KEY = 'stepwise:voice';
/** How long a wait keeps the screen awake before letting the device sleep after all. */
const AWAKE_MS = 30 * 60 * 1000;
/** How long to leave between closing the microphone and playing sound again. */
const MIC_SETTLE_MS = 350;
/** Speed of a slower repeat. */
const SLOW_RATE = 0.5;
/** What the plate says as a wait goes on: seconds into the wait, translation key, English. */
const PATIENCE: ReadonlyArray<readonly [number, string, string]> = [
  [0, 'stepwise.patience.0', 'Take your time.'],
  [20, 'stepwise.patience.1', 'Still here.'],
  [60, 'stepwise.patience.2', 'No rush. Really.'],
  [180, 'stepwise.patience.3', 'I can do this all day.'],
  [600, 'stepwise.patience.4', 'Ten minutes. We are both very patient.'],
];

/** The parts of the Web Speech API this element uses. */
interface Recognizer extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognizerClass {
  new (): Recognizer;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
}
interface RecognitionResultEvent extends Event {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

/** Step numbers as words. Sound-alikes ("to", "for") are left out on purpose: "next step for me" is not step 4. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

/** The part of a screen wake lock this element uses. */
interface WakeSentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface Command {
  /** What to show as heard. */
  word: string;
  run: () => void;
  /** The wait goes on afterwards, and so does listening. */
  stay?: boolean;
}

function recognizerClass(): RecognizerClass | null {
  const scope = globalThis as unknown as { SpeechRecognition?: RecognizerClass; webkitSpeechRecognition?: RecognizerClass };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}
/** How close to the end of a step the video stops, in seconds. Near enough to be the step's last picture. */
const HOLD_BEFORE_END = 0.06;
/** How long a new step's title stays up while the controls are hidden. */
const FLASH_MS = 4200;
/** "Back a step" within this many seconds of a step's start goes to the step before. */
const BACK_THRESHOLD = 2;

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !('tagName' in el)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export class StepwiseStepsElement extends UIElement {
  #controls = new PlayerController(this, playerContext, selectControls);
  #i18n = new I18nController(this, i18nContext);

  #disconnect: AbortController | null = null;
  #root: HTMLElement | null = null;
  #media: MediaLike | null = null;
  #chapters: TextTrack | null = null;
  #steps: Step[] = [];
  #index = -1;
  #waiting = -1; // index of the step just finished, or -1
  #ended = false;
  #wait = true;
  #previous = 0; // time at the last check, to tell playing through a boundary from seeking over it
  #ownSeek = false;
  #frame = 0;
  #flashTimer = 0;
  #pollTimer = 0;
  #releaseLock: (() => void) | null = null;
  #parts: Record<string, HTMLElement | null> = {};
  #segments: HTMLElement[] = [];
  #patienceTimers: number[] = [];
  #slowIndex = -1; // step being repeated slowly, or -1
  #restoreRate = 1;
  #voice = false;
  #recognizer: Recognizer | null = null;
  #listenToken = 0;
  #heardTimer = 0;
  #wakeLock: WakeSentinel | null = null;
  #wakeUntil = 0;
  #wakeTimer = 0;
  #menuWasOpen = false;
  #micClosedAt = -Infinity;
  #playTimer = 0;
  #hands: 'voice' | 'knock' | null = null;
  #audio: AudioContext | null = null;
  #knockStream: MediaStream | null = null;
  #knockSource: MediaStreamAudioSourceNode | null = null;
  #knockFrame = 0;
  #counter = false;
  #pageOverflow = '';
  #pageScroll: [number, number] = [0, 0];

  /** The steps, in order. Empty when the video has no chapters. */
  get steps(): readonly Step[] {
    return this.#steps;
  }
  /** Index of the step being played, or -1. */
  get index(): number {
    return this.#index;
  }
  /** Whether the player is holding at the end of a step. */
  get waiting(): boolean {
    return this.#waiting !== -1;
  }
  /** Whether the player pauses after each step. */
  get wait(): boolean {
    return this.#wait;
  }
  set wait(value: boolean) {
    this.#setWait(value, true);
  }

  connectedCallback() {
    super.connectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;

    this.#root = (this.closest('media-container') ?? this.closest('video-player')) as HTMLElement | null;
    if (!this.#root) return;
    const root = this.#root;

    for (const name of [
      'tag', 'number', 'total', 'title', 'summary', 'summary-count', 'back', 'next', 'wait', 'plate', 'done', 'repeat',
      'repeat-label', 'continue', 'continue-kicker', 'continue-number', 'continue-title', 'hairline', 'status',
      'patience', 'slower', 'voice', 'voice-label', 'counter', 'counter-label',
    ]) {
      this.#parts[name] = root.querySelector(`[data-step="${name}"]`);
    }

    // The switch: an attribute sets the default, the viewer's last choice wins.
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* private mode, or storage switched off */
    }
    this.#setWait(stored ? stored !== 'off' : this.getAttribute('wait') !== 'off', false);

    this.#parts.back?.addEventListener('click', () => this.back(), { signal });
    this.#parts.next?.addEventListener('click', () => this.next(), { signal });
    this.#parts.wait?.addEventListener('click', () => this.#setWait(!this.#wait, true), { signal });
    this.#parts.repeat?.addEventListener('click', () => this.repeat(), { signal });
    this.#parts.continue?.addEventListener('click', () => this.continue(), { signal });
    this.#parts.slower?.addEventListener('click', () => this.repeat(true), { signal });
    this.#parts.voice?.addEventListener('click', () => this.#setVoice(!this.#voice, true), { signal });

    // Hands-free is offered only where the device can do it, and in the form it does best.
    const asked = this.getAttribute('hands-free') ?? this.closest('video-player')?.getAttribute('hands-free') ?? null;
    const canKnock = !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined';
    const canSpeak = !!recognizerClass();
    this.#hands =
      asked === 'off'
        ? null
        : asked === 'knock' && canKnock
          ? 'knock'
          : asked === 'voice' && canSpeak
            ? 'voice'
            : this.#touch && canKnock
              ? 'knock'
              : canSpeak
                ? 'voice'
                : canKnock
                  ? 'knock'
                  : null;
    if (this.#hands && this.#parts.voice) {
      root.setAttribute('data-step-hands', this.#hands);
      this.#parts.voice.hidden = false;
      this.#parts.voice.setAttribute(
        'title',
        this.#hands === 'knock'
          ? this.#translate('stepwise.knock.promise', 'Listens only while the player is waiting; the sound stays on this device')
          : this.#translate('stepwise.voice.promise', 'Listens only while the player is waiting')
      );
      let voice: string | null = null;
      try {
        voice = localStorage.getItem(VOICE_KEY);
      } catch {
        /* as above */
      }
      this.#setVoice(voice === 'on', false);
    }
    this.#parts.counter?.addEventListener('click', () => this.#setCounter(!this.#counter), { signal });
    root.addEventListener('keydown', this.#onKeyDown, { signal });
    root.addEventListener('pointerdown', this.#onPointerDown, { signal, capture: true });
    root.addEventListener('click', this.#onTap, { signal });
    document.addEventListener('visibilitychange', this.#onVisibility, { signal });

    this.#attachMedia();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    cancelAnimationFrame(this.#frame);
    clearTimeout(this.#flashTimer);
    clearTimeout(this.#pollTimer);
    clearTimeout(this.#heardTimer);
    clearTimeout(this.#playTimer);
    this.#clearPatience();
    this.#stopListening();
    if (this.#counter) this.#setCounter(false);
    this.#letSleep();
    void this.#audio?.close().catch(() => undefined);
    this.#audio = null;
    this.#releaseLock?.();
    this.#releaseLock = null;
    this.#chapters = null;
    this.#media = null;
  }

  // ---------------------------------------------------------------- public

  /** Go to the next step. */
  next(): void {
    const media = this.#media;
    const step = this.#steps[this.#index + 1];
    if (!media || !step) return;
    this.#leaveWait();
    this.#seek(step.start);
  }

  /** Go to the start of this step, or to the step before when this one has only just begun. */
  back(): void {
    const media = this.#media;
    if (!media || !this.#steps.length) return;
    const at = Math.max(this.#index, 0);
    const current = this.#steps[at];
    const target = media.currentTime - current.start > BACK_THRESHOLD || at === 0 ? current : this.#steps[at - 1];
    this.#leaveWait();
    this.#seek(target.start);
  }

  /** Start playback, leaving a moment after the microphone closes (see where a command is heard). */
  #play() {
    const media = this.#media;
    if (!media) return;
    if (this.#recognizer || this.#knockStream) this.#stopListening();
    const wait = Math.max(0, MIC_SETTLE_MS - (performance.now() - this.#micClosedAt));
    clearTimeout(this.#playTimer);
    const start = () => void Promise.resolve(media.play()).catch(() => undefined);
    if (wait > 0) this.#playTimer = window.setTimeout(start, wait);
    else start();
  }

  /** Play from the start of the step at `index` (0-based). */
  goTo(index: number): void {
    const media = this.#media;
    const step = this.#steps[index];
    if (!media || !step) return;
    this.#leaveWait();
    this.#setSlow(-1);
    this.#seek(step.start);
    this.#play();
  }

  /** Play this step again from its start; `slow` plays it at half speed, for this once. */
  repeat(slow = false): void {
    const media = this.#media;
    if (!media || !this.#steps.length) return;
    const at = this.#waiting !== -1 ? this.#waiting : Math.max(this.#index, 0);
    this.#leaveWait();
    this.#setSlow(slow ? at : -1);
    this.#seek(this.#steps[at].start);
    this.#say(
      slow
        ? this.#format('stepwise.status.slower', 'Repeating step {n} at half speed', at + 1)
        : this.#format('stepwise.status.repeat', 'Repeating step {n}', at + 1)
    );
    this.#play();
  }

  /** Half speed for one step. Whatever speed the viewer had chosen comes back when the step is over. */
  #setSlow(index: number) {
    const media = this.#media;
    if (!media) return;
    if (index !== -1) {
      if (this.#slowIndex === -1) this.#restoreRate = media.playbackRate || 1;
      media.playbackRate = SLOW_RATE;
    } else if (this.#slowIndex !== -1) {
      media.playbackRate = this.#restoreRate;
    }
    this.#slowIndex = index;
    this.#root?.toggleAttribute('data-step-slow', index !== -1);
  }

  /** Leave the wait and play on. After the last step, start again from the top. */
  continue(): void {
    const media = this.#media;
    if (!media) return;
    if (this.#ended) {
      this.#leaveWait();
      this.#seek(0);
    }
    // The `play` handler moves to the next step's first frame and clears the wait.
    this.#play();
  }

  // ---------------------------------------------------------------- media and chapters

  #findMedia(): MediaLike | null {
    const root = this.#root;
    if (!root) return null;
    const direct = root.querySelector(':scope > video, :scope > audio, :scope > [slot="media"]');
    const candidate = (direct ?? root.querySelector('video, audio, mux-video, hls-video, hlsjs-video')) as MediaLike | null;
    if (!candidate) return null;
    if ('textTracks' in candidate && candidate.textTracks) return candidate;
    const inner =
      candidate.querySelector?.('video') ?? (candidate as unknown as Element).shadowRoot?.querySelector('video');
    return (inner as unknown as MediaLike) ?? candidate;
  }

  #attachMedia() {
    const signal = this.#disconnect?.signal;
    if (!signal || signal.aborted) return;
    const media = this.#findMedia();
    if (!media) {
      // The media component may still be upgrading.
      setTimeout(() => this.isConnected && !this.#media && this.#attachMedia(), 250);
      return;
    }
    this.#media = media;
    this.#previous = media.currentTime || 0;

    const tracks = media.textTracks;
    tracks?.addEventListener?.('addtrack', () => this.#pickChapters(), { signal });
    tracks?.addEventListener?.('removetrack', () => this.#pickChapters(), { signal });
    tracks?.addEventListener?.('change', () => this.#pickChapters(), { signal });
    media.addEventListener('loadedmetadata', () => this.#pickChapters(), { signal });
    media.addEventListener('durationchange', () => this.#readSteps(), { signal });
    media.addEventListener('emptied', () => this.#reset(), { signal });

    media.addEventListener('play', this.#onPlay, { signal });
    media.addEventListener('playing', this.#onPlaying, { signal });
    media.addEventListener('pause', this.#onPause, { signal });
    media.addEventListener('ended', this.#onEnded, { signal });
    media.addEventListener('seeking', this.#onSeeking, { signal });
    media.addEventListener('seeked', this.#onSeeked, { signal });
    media.addEventListener('timeupdate', this.#onTimeUpdate, { signal });

    this.#pickChapters();
    if (!media.paused) this.#onPlaying();
  }

  #pickChapters() {
    const list = this.#media?.textTracks;
    let chapters: TextTrack | null = null;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].kind === 'chapters') {
          chapters = list[i];
          break;
        }
      }
    }
    // A disabled track loads no cues.
    if (chapters && chapters.mode === 'disabled') chapters.mode = 'hidden';
    if (chapters !== this.#chapters) {
      this.#chapters?.removeEventListener('cuechange', this.#onCueChange);
      this.#chapters = chapters;
      chapters?.addEventListener('cuechange', this.#onCueChange);
    }
    this.#readSteps();
    // Cues can arrive a moment after the track does, and nothing fires when they do.
    clearTimeout(this.#pollTimer);
    if (chapters && !this.#steps.length) this.#poll(40);
  }

  #poll(left: number) {
    this.#pollTimer = window.setTimeout(() => {
      if (!this.isConnected || this.#steps.length) return;
      this.#readSteps();
      if (!this.#steps.length && left > 0) this.#poll(left - 1);
    }, 250);
  }

  #onCueChange = () => {
    if (!this.#steps.length) this.#readSteps();
  };

  #readSteps() {
    const cues = this.#chapters?.cues;
    const steps: Step[] = [];
    if (cues) {
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i] as VTTCue;
        steps.push({ start: cue.startTime, end: cue.endTime, title: (cue.text ?? '').replace(/<[^>]+>/g, '').trim() });
      }
      steps.sort((a, b) => a.start - b.start);
      // A step runs until the next one begins, whatever its cue says.
      for (let i = 0; i < steps.length - 1; i++) steps[i].end = steps[i + 1].start;
      const duration = this.#media?.duration;
      if (steps.length && duration && Number.isFinite(duration)) steps[steps.length - 1].end = duration;
    }
    const same =
      steps.length === this.#steps.length &&
      steps.every((s, i) => s.start === this.#steps[i].start && s.end === this.#steps[i].end && s.title === this.#steps[i].title);
    if (same) {
      this.#renderSummary();
      return;
    }
    this.#steps = steps;
    this.#index = -1;
    const root = this.#root;
    if (root) {
      if (steps.length > 1) root.setAttribute('data-steps', String(steps.length));
      else root.removeAttribute('data-steps');
    }
    this.#renderHairline();
    this.#renderSummary();
    this.#sync(false);
  }

  #reset() {
    this.#leaveWait();
    this.#steps = [];
    this.#index = -1;
    this.#root?.removeAttribute('data-steps');
    this.#root?.removeAttribute('data-step-started');
    this.#renderHairline();
  }

  /** There is something to step through: two steps or more. */
  get #active(): boolean {
    return this.#steps.length > 1;
  }

  #indexAt(time: number): number {
    const steps = this.#steps;
    let at = -1;
    for (let i = 0; i < steps.length; i++) {
      if (time >= steps[i].start - 0.001) at = i;
      else break;
    }
    return Math.max(at, steps.length ? 0 : -1);
  }

  // ---------------------------------------------------------------- playback

  #onPlay = () => {
    const media = this.#media;
    if (!media) return;
    this.#root?.toggleAttribute('data-step-started', true);
    if (this.#waiting !== -1 && !this.#ended) {
      // Leaving a wait by any route (the plate, the play button, the space bar) starts the next step.
      const next = this.#steps[this.#waiting + 1];
      this.#leaveWait();
      if (next && media.currentTime < next.start) this.#seek(next.start);
    } else if (this.#ended) {
      this.#leaveWait();
    }
  };

  #onPlaying = () => {
    this.#previous = this.#media?.currentTime ?? 0;
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(this.#tick);
    this.#flash();
  };

  #onPause = () => {
    cancelAnimationFrame(this.#frame);
    this.#sync(false);
  };

  #onEnded = () => {
    cancelAnimationFrame(this.#frame);
    if (!this.#active) return;
    this.#ended = true;
    this.#enterWait(this.#steps.length - 1);
  };

  #onSeeking = () => {
    if (this.#ownSeek) return;
    // The viewer moved somewhere else; the wait is over, and playback stays as they left it.
    if (this.#waiting !== -1) this.#leaveWait();
  };

  #onSeeked = () => {
    this.#ownSeek = false;
    this.#previous = this.#media?.currentTime ?? 0;
    this.#sync(false);
  };

  #onTimeUpdate = () => {
    const media = this.#media;
    if (!media) return;
    if (media.currentTime > 0) this.#root?.toggleAttribute('data-step-started', true);
    // Frames stop in a background tab while the video plays on; this event keeps coming, so a step
    // still ends where it should, a fraction of a second late at worst.
    this.#sync(!media.paused && !media.ended);
  };

  /** While playing: watch for the end of the step, and keep the readouts current. */
  #tick = () => {
    const media = this.#media;
    if (!media || media.paused || media.ended) return;
    this.#frame = requestAnimationFrame(this.#tick);
    this.#sync(true);
  };

  #sync(playing: boolean) {
    const media = this.#media;
    if (!media) return;
    const now = media.currentTime;

    if (playing && this.#wait && this.#active && this.#waiting === -1 && !media.seeking && !this.#ownSeek) {
      const from = this.#indexAt(this.#previous);
      const step = this.#steps[from];
      const stop = step ? step.end - HOLD_BEFORE_END : Infinity;
      const natural = now >= this.#previous && now - this.#previous < 1.5;
      if (step && from < this.#steps.length - 1 && natural && this.#previous < stop && now >= stop) {
        media.pause();
        cancelAnimationFrame(this.#frame);
        // Rest on the step's own last picture, not the first of the next.
        this.#seek(Math.max(step.start, stop));
        this.#previous = stop;
        this.#enterWait(from);
        this.#render(from, 1);
        return;
      }
    }
    this.#previous = now;

    const index = this.#waiting !== -1 ? this.#waiting : this.#indexAt(now);
    this.#render(index, -1);
  }

  #seek(time: number) {
    const media = this.#media;
    if (!media) return;
    this.#ownSeek = true;
    this.#previous = time;
    media.currentTime = time;
    // Some media elements settle a seek to the current position without events.
    setTimeout(() => {
      if (!this.#media?.seeking) this.#ownSeek = false;
    }, 400);
  }

  // ---------------------------------------------------------------- waiting

  #enterWait(index: number) {
    const root = this.#root;
    const plate = this.#parts.plate;
    if (!root) return;
    this.#waiting = index;
    this.#setSlow(-1);
    root.setAttribute('data-step-waiting', this.#ended ? 'end' : 'step');
    this.#renderPlate();
    this.#startPatience();
    if (this.#voice && !(this.#hands === 'knock' && this.#ended)) void this.#listen();
    if (!this.#ended) this.#wakeUntil = Math.max(this.#wakeUntil, Date.now() + AWAKE_MS);
    void this.#stayAwake();
    if (plate) plate.inert = false;
    // Deciding takes as long as it takes: hold the controls while the plate is up.
    this.#releaseLock ??= this.#controls.value?.requestControlsLock?.() ?? null;

    const step = this.#steps[index];
    const next = this.#steps[index + 1];
    const said = this.#ended
      ? this.#translate('stepwise.status.end', 'All steps done.')
      : `${this.#format('stepwise.status.done', 'Step {n} done.', index + 1)} ${this.#translate('stepwise.status.waiting', 'Waiting.')} ${
          next ? `${this.#translate('stepwise.next', 'Next step')}: ${next.title}.` : ''
        }`;
    this.#say(
      !this.#voice
        ? said
        : this.#hands === 'knock'
          ? `${said} ${this.#translate('stepwise.status.knock', 'Listening for two knocks.')}`
          : `${said} ${this.#translate('stepwise.status.voice', 'Listening for “next”.')}`
    );

    // A keyboard user already inside the player lands on the way forward.
    if (root.contains(document.activeElement) && !root.querySelector('media-menu[data-open]')) {
      this.#parts.continue?.focus({ preventScroll: true });
    }
    this.dispatchEvent(new CustomEvent('stepwait', { detail: { index, step } }));
  }

  #leaveWait() {
    const root = this.#root;
    const plate = this.#parts.plate;
    if (this.#waiting === -1 && !this.#ended) return;
    const hadFocus = !!plate && plate.contains(document.activeElement);
    this.#waiting = -1;
    this.#ended = false;
    this.#clearPatience();
    this.#stopListening();
    root?.removeAttribute('data-step-hint');
    root?.removeAttribute('data-step-waiting');
    if (plate) plate.inert = true;
    this.#releaseLock?.();
    this.#releaseLock = null;
    // Focus was on a button that has just gone; hand it to the play button rather than drop it.
    if (hadFocus) (root?.querySelector('.sw-play') as HTMLElement | null)?.focus({ preventScroll: true });
    if (!this.#wantsAwake) this.#letSleep();
  }

  #setWait(on: boolean, fromViewer: boolean) {
    this.#wait = on;
    this.#root?.setAttribute('data-step-wait', on ? 'on' : 'off');
    this.#parts.wait?.setAttribute('aria-checked', String(on));
    this.#parts.wait?.setAttribute('aria-label', this.#translate('stepwise.wait.label', 'Wait after each step'));
    if (!fromViewer) return;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* not kept; the switch still works for this visit */
    }
    this.#say(
      on
        ? this.#translate('stepwise.wait.on', 'Waiting after each step: on')
        : this.#translate('stepwise.wait.off', 'Waiting after each step: off')
    );
    // Switched off in the middle of a wait: carry on.
    if (!on && this.#waiting !== -1 && !this.#ended) this.continue();
  }

  // ---------------------------------------------------------------- the wait line

  /** A line under the heading that changes as the wait goes on. Company, not a countdown. */
  #startPatience() {
    this.#clearPatience();
    this.#root?.removeAttribute('data-step-hint');
    const line = this.#parts.patience;
    if (!line) return;
    if (this.#ended) {
      line.textContent = this.#translate('stepwise.patience.end', 'Nicely done.');
      return;
    }
    for (const [after, key, fallback] of PATIENCE) {
      const show = () => {
        line.textContent =
          after === 0 && this.#voice
            ? this.#hands === 'knock'
              ? this.#translate('stepwise.patience.knock', 'Knock twice on the counter to go on.')
              : this.#translate('stepwise.patience.voice', 'Say “next”, “repeat”, “slower” or “back”.')
            : after === 0 && this.#touch
              ? this.#translate('stepwise.patience.touch', 'Take your time. Tap anywhere to go on.')
              : this.#translate(key, fallback);
      };
      if (after === 0) show();
      else this.#patienceTimers.push(window.setTimeout(show, after * 1000));
    }
  }

  #clearPatience() {
    for (const timer of this.#patienceTimers) clearTimeout(timer);
    this.#patienceTimers = [];
  }

  // ---------------------------------------------------------------- voice

  #setVoice(on: boolean, fromViewer: boolean) {
    this.#voice = on;
    this.#parts.voice?.setAttribute('aria-pressed', String(on));
    this.#voiceState(on ? 'on' : 'off');
    // The first line of a wait mentions voice only while voice is on.
    if (!on && this.#waiting !== -1) this.#startPatience();
    if (!fromViewer) return;
    try {
      localStorage.setItem(VOICE_KEY, on ? 'on' : 'off');
    } catch {
      /* not kept */
    }
    if (on && this.#hands === 'knock') {
      // Made here, inside the tap, so that phones let it run later without another tap.
      try {
        this.#audio ??= new AudioContext();
        if (this.#waiting === -1) void this.#audio.suspend().catch(() => undefined);
      } catch {
        /* #listenForKnocks reports it */
      }
    }
    if (on && this.#waiting !== -1) {
      this.#startPatience();
      void this.#listen(true);
    } else if (!on) {
      this.#stopListening();
      this.#say(this.#hands === 'knock' ? this.#translate('stepwise.knock.off', 'Knock listening off') : this.#translate('stepwise.voice.off', 'Voice off'));
    }
  }

  #voiceState(state: 'off' | 'on' | 'listening' | 'heard' | 'blocked', heard = '') {
    const root = this.#root;
    const label = this.#parts['voice-label'];
    if (!root || !this.#parts.voice || this.#parts.voice.hidden) return;
    root.setAttribute('data-step-voice', state);
    if (!label) return;
    const knock = this.#hands === 'knock';
    label.textContent =
      state === 'listening'
        ? this.#translate('stepwise.voice.listening', 'Listening')
        : state === 'heard'
          ? knock
            ? heard
            : `${this.#translate('stepwise.voice.heard', 'Heard')} “${heard}”`
          : knock
            ? this.#translate('stepwise.knock.say', 'Knock twice')
            : this.#translate('stepwise.voice.say', 'Say “next”');
  }

  /** Open the microphone for this wait. */
  async #listen(announce = false) {
    if (this.#hands === 'knock') return this.#listenForKnocks(announce);
    const Recognition = recognizerClass();
    if (!Recognition || this.#waiting === -1) return;
    this.#stopListening();
    const token = ++this.#listenToken;
    const lang = this.getAttribute('voice-lang') || 'en-US';

    // Keep the audio on the device where the browser can.
    let local = false;
    try {
      local = (await Recognition.available?.({ langs: [lang], processLocally: true })) === 'available';
    } catch {
      local = false;
    }
    if (token !== this.#listenToken || this.#waiting === -1 || !this.#voice) return;

    // The viewer has just pressed the button: ask for the microphone in the ordinary way, so the
    // browser shows its own prompt and a refusal can be told apart from a missing speech service.
    // Nothing is recorded; the stream is closed as soon as the answer is known.
    if (announce && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
      } catch (error) {
        const name = (error as DOMException)?.name;
        if (token !== this.#listenToken) return;
        if (name === 'NotAllowedError' || name === 'SecurityError') return this.#voiceFailed('blocked');
        if (name === 'NotFoundError' || name === 'OverconstrainedError') return this.#voiceFailed('nomic');
        // Anything else: let the recogniser try, and report what it finds.
      }
      if (token !== this.#listenToken || this.#waiting === -1 || !this.#voice) return;
    }

    const recognizer = new Recognition();
    recognizer.lang = lang;
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 3;
    if (local) recognizer.processLocally = true;
    let acted = false;

    recognizer.addEventListener('start', () => {
      if (token === this.#listenToken) {
        this.#voiceState('listening');
        // Said aloud only when the viewer has just switched voice on; at the start of a wait the
        // wait's own announcement says that the player is listening.
        if (announce) {
          this.#showHint(
            this.#translate('stepwise.voice.promise.on', 'The mic is open only while the player waits. Say “next”, “repeat”, “slower” or “back”.')
          );
        }
      }
    });
    let handled = -1; // results up to this index have already produced a command
    recognizer.addEventListener('result', (event) => {
      if (token !== this.#listenToken || acted) return;
      const { results, resultIndex } = event as RecognitionResultEvent;
      let said = '';
      const from = Math.max(resultIndex, handled + 1);
      for (let i = from; i < results.length; i++) {
        for (let j = 0; j < results[i].length; j++) said += ` ${results[i][j].transcript}`;
      }
      const command = said ? this.#command(said.toLowerCase()) : null;
      if (!command) return;
      handled = results.length - 1;
      this.#voiceState('heard', command.word);
      clearTimeout(this.#heardTimer);
      if (command.stay) {
        // Something that does not end the wait: do it, show what was heard, and go on listening.
        command.run();
        this.#heardTimer = window.setTimeout(() => {
          if (token === this.#listenToken) this.#voiceState('listening');
        }, 1400);
        return;
      }
      acted = true;
      // Close the microphone before the video plays again. A phone that is still recording when
      // playback resumes can send the sound to its call speaker or drop it, and a Bluetooth headset
      // has to see the microphone gone before it goes back from call mode to music.
      let done = false;
      const go = () => {
        if (done || token !== this.#listenToken) return;
        done = true;
        command.run();
      };
      recognizer.addEventListener('end', () => window.setTimeout(go, MIC_SETTLE_MS), { once: true });
      this.#recognizer = null;
      this.#micClosedAt = performance.now();
      try {
        recognizer.abort();
      } catch {
        /* already stopped */
      }
      this.#heardTimer = window.setTimeout(go, 1500); // in case `end` never comes
    });
    recognizer.addEventListener('error', (event) => {
      if (token !== this.#listenToken) return;
      const error = (event as Event & { error?: string }).error;
      if (error === 'no-speech' || error === 'aborted') return; // `end` follows, and listening resumes
      this.#voiceFailed(
        error === 'not-allowed' ? 'blocked' : error === 'audio-capture' ? 'nomic' : 'unavailable'
      );
    });
    recognizer.addEventListener('end', () => {
      // Browsers end a session after a silence. While the wait lasts, keep listening.
      if (token !== this.#listenToken || acted || this.#waiting === -1 || !this.#voice) return;
      window.setTimeout(() => {
        if (token === this.#listenToken && this.#waiting !== -1 && this.#voice) void this.#listen();
      }, 250);
    });

    this.#recognizer = recognizer;
    try {
      recognizer.start();
    } catch {
      this.#recognizer = null;
    }
  }

  /**
   * Open the microphone for this wait and listen for two knocks. The sound is measured here, in the
   * page, and goes nowhere: only its loudness is looked at, a few dozen times a second.
   */
  async #listenForKnocks(announce: boolean) {
    if (this.#waiting === -1) return;
    this.#stopListening();
    const token = ++this.#listenToken;
    let stream: MediaStream;
    try {
      // The phone's own tidying-up of the sound (echo, noise, level) is what would blur a knock.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (error) {
      if (token !== this.#listenToken) return;
      const name = (error as DOMException)?.name;
      return this.#voiceFailed(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nomic' : 'blocked');
    }
    const drop = () => {
      for (const track of stream.getTracks()) track.stop();
    };
    if (token !== this.#listenToken || this.#waiting === -1 || !this.#voice) return drop();

    try {
      this.#audio ??= new AudioContext();
      if (this.#audio.state !== 'running') await this.#audio.resume();
    } catch {
      drop();
      if (token === this.#listenToken) this.#voiceFailed('unavailable');
      return;
    }
    if (token !== this.#listenToken || this.#waiting === -1 || !this.#voice) return drop();

    const audio = this.#audio;
    let source: MediaStreamAudioSourceNode;
    let analyser: AnalyserNode;
    try {
      source = audio.createMediaStreamSource(stream);
      analyser = audio.createAnalyser();
      // A sixth of a second of sound is kept on hand, so a slow frame cannot drop a knock.
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser); // and nowhere else: nothing is played back or recorded
    } catch {
      drop();
      this.#voiceFailed('unavailable');
      return;
    }
    this.#knockStream = stream;
    this.#knockSource = source;

    const rate = audio.sampleRate;
    const slice = Math.max(128, Math.round(rate / 100)); // the sound is weighed about 10 ms at a time
    const samples = new Float32Array(analyser.fftSize);
    const detector = new KnockDetector();
    let readTo = audio.currentTime; // everything before this moment has been weighed
    let relabel = 0;
    this.#voiceState('listening');
    if (announce) {
      this.#showHint(
        this.#translate('stepwise.knock.promise.on', 'Knock twice on the counter to go on. The mic is open only while the player waits, and the sound stays on this device.')
      );
    }

    const heard = (event: 'knock' | 'double') => {
      clearTimeout(relabel);
      if (event === 'knock') {
        // Show that a knock landed, so the next one is knocked with confidence.
        this.#voiceState('heard', this.#translate('stepwise.knock.one', 'Knock…'));
        relabel = window.setTimeout(() => {
          if (token === this.#listenToken) this.#voiceState('listening');
        }, 1100);
        return;
      }
      this.#voiceState('heard', this.#translate('stepwise.knock.two', 'Knock, knock'));
      // Same order as for a spoken word: microphone closed first, then sound.
      this.#closeKnocks();
      this.#heardTimer = window.setTimeout(() => {
        if (this.#waiting !== -1) this.continue();
      }, MIC_SETTLE_MS);
    };

    const read = () => {
      if (token !== this.#listenToken) return;
      this.#knockFrame = requestAnimationFrame(read);
      // Only the sound that arrived since the last look is weighed, in even slices, whatever the
      // screen's frame rate is doing.
      const now = audio.currentTime;
      const arrived = Math.round((now - readTo) * rate);
      if (arrived < slice) return;
      const fresh = Math.min(arrived - (arrived % slice), samples.length - (samples.length % slice));
      const tail = Math.min(arrived - fresh, samples.length - fresh); // newest samples, left for next time
      analyser.getFloatTimeDomainData(samples);
      const from = samples.length - tail - fresh;
      const start = now - (tail + fresh) / rate;
      readTo = now - tail / rate;
      for (let offset = 0; offset < fresh; offset += slice) {
        let peak = 0;
        for (let i = from + offset; i < from + offset + slice; i++) {
          const value = Math.abs(samples[i]);
          if (value > peak) peak = value;
        }
        const event = detector.push(peak, (start + (offset + slice) / rate) * 1000);
        if (event) heard(event);
        if (event === 'double') return;
      }
    };
    this.#knockFrame = requestAnimationFrame(read);
  }

  /** Close the microphone used for knocks, and let the audio system rest. */
  #closeKnocks() {
    cancelAnimationFrame(this.#knockFrame);
    const stream = this.#knockStream;
    if (!stream) return;
    this.#listenToken++;
    this.#knockStream = null;
    this.#micClosedAt = performance.now();
    try {
      this.#knockSource?.disconnect();
    } catch {
      /* already gone */
    }
    this.#knockSource = null;
    for (const track of stream.getTracks()) track.stop();
    void this.#audio?.suspend().catch(() => undefined);
  }

  /** Voice could not start. Switch it off, keep it off next time, and say why and what to do. */
  #voiceFailed(reason: 'blocked' | 'nomic' | 'unavailable') {
    this.#listenToken++;
    this.#recognizer = null;
    this.#setVoice(false, false);
    try {
      localStorage.setItem(VOICE_KEY, 'off');
    } catch {
      /* not kept */
    }
    const [short, hint] =
      reason === 'blocked'
        ? [
            this.#translate('stepwise.voice.blocked', 'Mic blocked'),
            this.#translate(
              'stepwise.voice.blocked.hint',
              this.#hands === 'knock'
                ? 'Allow the microphone for this site to use knocks. A tap anywhere still goes on.'
                : 'Allow the microphone for this site, or open this page in Chrome or Safari.'
            ),
          ]
        : reason === 'nomic'
          ? [
              this.#translate('stepwise.voice.nomic', 'No microphone'),
              this.#touch
                ? this.#translate('stepwise.voice.nomic.touch', 'No microphone was found. A tap anywhere still goes on.')
                : this.#translate('stepwise.voice.nomic.hint', 'No microphone was found. Next step and the space bar still work.'),
            ]
          : this.#hands === 'knock'
            ? [
                this.#translate('stepwise.knock.unavailable', 'Can’t listen'),
                this.#translate('stepwise.knock.unavailable.hint', 'This browser can’t listen for knocks right now. A tap anywhere still goes on.'),
              ]
            : [
              this.#translate('stepwise.voice.unavailable', 'Voice unavailable'),
              this.#translate('stepwise.voice.unavailable.hint', 'This browser can’t recognise speech right now. Next step and the space bar still work.'),
              ];
    this.#root?.setAttribute('data-step-voice', 'blocked');
    const label = this.#parts['voice-label'];
    if (label) label.textContent = short;
    // The explanation takes the wait line's place for the rest of this wait.
    this.#showHint(hint);
    this.#say(`${short}. ${hint}`);
  }

  #stopListening() {
    this.#listenToken++;
    clearTimeout(this.#heardTimer);
    this.#closeKnocks();
    const recognizer = this.#recognizer;
    this.#recognizer = null;
    if (recognizer) this.#micClosedAt = performance.now();
    try {
      recognizer?.abort();
    } catch {
      /* already stopped */
    }
    if (this.#voice) this.#voiceState('on');
  }

  /**
   * The command in what was said, if any. Order matters where phrases overlap: "go back to step two"
   * is a step number, "start again" is not "again", "repeat it slower" is slower.
   */
  #command(said: string): Command | null {
    const has = (key: string, fallback: string) => {
      const words = this.#translate(key, fallback).split('|');
      return words.find((word) => new RegExp(`(^|[^\\p{L}\\d])${word.trim()}([^\\p{L}\\d]|$)`, 'u').test(said))?.trim();
    };
    const at = this.#waiting;

    const help = has('stepwise.voice.words.help', 'what can i say|what can you do|help|commands');
    if (help) return { word: help, stay: true, run: () => this.#showHint(this.#translate('stepwise.voice.list', 'Say: next · repeat · slower · back · step 3 · start again · mute · captions on · stop listening')) };

    const quiet = has('stepwise.voice.words.stop', 'stop listening|voice off|mic off|microphone off');
    if (quiet) return { word: quiet, stay: true, run: () => this.#setVoice(false, true) };

    // "step three", "step 3", "go to step number two".
    const stepWord = this.#translate('stepwise.voice.words.step', 'step');
    const numbered = new RegExp(`(^|[^\\p{L}])${stepWord}\\s+(?:number\\s+)?(\\d{1,2}|[\\p{L}]+)`, 'u').exec(said);
    if (numbered) {
      const n = /^\d+$/.test(numbered[2]) ? Number(numbered[2]) : NUMBER_WORDS[numbered[2]];
      if (n && n <= this.#steps.length) return { word: `${stepWord} ${n}`, run: () => this.goTo(n - 1) };
      if (n) return { word: `${stepWord} ${n}?`, stay: true, run: () => this.#showHint(this.#format('stepwise.voice.nostep', 'There are {n} steps.', this.#steps.length)) };
    }

    const slower = has('stepwise.voice.words.slower', 'slower|slowly|slow|half speed|half the speed|50%|50 percent|fifty percent');
    if (slower) return { word: slower, run: () => this.repeat(true) };

    const normal = has('stepwise.voice.words.normal', 'normal speed|full speed|regular speed');
    if (normal) {
      return {
        word: normal,
        run: () => {
          this.#restoreRate = 1;
          if (this.#media) this.#media.playbackRate = 1;
          this.repeat();
        },
      };
    }

    const restart = has('stepwise.voice.words.restart', 'start again|start over|restart|from the top|from the beginning');
    if (restart) return { word: restart, run: () => this.goTo(0) };

    const back = has('stepwise.voice.words.back', 'back|previous');
    if (back) return { word: back, run: () => this.goTo(Math.max(at - 1, 0)) };

    const repeat = has('stepwise.voice.words.repeat', 'repeat|again|once more');
    if (repeat) return { word: repeat, run: () => this.repeat() };

    const unmute = has('stepwise.voice.words.unmute', 'unmute|sound on');
    if (unmute) return { word: unmute, stay: true, run: () => this.#setMuted(false) };
    const mute = has('stepwise.voice.words.mute', 'mute|sound off|silence');
    if (mute) return { word: mute, stay: true, run: () => this.#setMuted(true) };

    const captionsOff = has('stepwise.voice.words.captions.off', 'captions off|subtitles off|hide captions|hide subtitles|no captions');
    if (captionsOff) return { word: captionsOff, stay: true, run: () => this.#setCaptions(false) };
    const captionsOn = has('stepwise.voice.words.captions.on', 'captions on|subtitles on|show captions|show subtitles|captions|subtitles');
    if (captionsOn) return { word: captionsOn, stay: true, run: () => this.#setCaptions(true) };

    if (!this.#ended) {
      const next = has('stepwise.voice.words.next', 'next|continue|go on|carry on');
      if (next) return { word: next, run: () => this.continue() };
    }
    return null;
  }

  #setMuted(muted: boolean) {
    const media = this.#media as (MediaLike & { muted?: boolean }) | null;
    if (!media) return;
    media.muted = muted;
    this.#say(muted ? this.#translate('stepwise.status.muted', 'Muted') : this.#translate('stepwise.status.unmuted', 'Sound on'));
  }

  /** Captions go through the player's own button, so its state and the menu stay in step. */
  #setCaptions(on: boolean) {
    const button = this.#root?.querySelector('media-captions-button, .media-captions-button') as HTMLElement | null;
    const unavailable = !button || button.hasAttribute('data-hidden') || /unavailable|unsupported/.test(button.getAttribute('data-availability') ?? '');
    if (unavailable) {
      this.#showHint(this.#translate('stepwise.voice.nocaptions', 'This video has no captions.'));
      return;
    }
    if (button.hasAttribute('data-active') !== on) button.click();
    this.#say(on ? this.#translate('stepwise.status.captions.on', 'Captions on') : this.#translate('stepwise.status.captions.off', 'Captions off'));
  }

  /** Put something that must be read on the wait line, in place of the small talk. */
  #showHint(text: string) {
    this.#clearPatience();
    this.#root?.toggleAttribute('data-step-hint', true);
    if (this.#parts.patience) this.#parts.patience.textContent = text;
    this.#say(text);
  }

  // ---------------------------------------------------------------- busy hands

  /** A finger is the pointer here, or the nearest thing to one. */
  get #touch(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  #onPointerDown = () => {
    // A press that closes an open menu is only that.
    this.#menuWasOpen = !!this.#root?.querySelector('media-menu[data-open]');
  };

  /** During a wait between steps the whole picture is the Next button: a knuckle will do. */
  #onTap = (event: MouseEvent) => {
    if (this.#waiting === -1 || this.#ended || this.#menuWasOpen || event.defaultPrevented) return;
    const target = event.target as Element | null;
    if (!target?.closest) return;
    // Anything that is itself a control keeps its own meaning.
    if (target.closest('.sw-dock, .sw-top, .sw-center, media-menu, .media-popup, button, a, input, [role="slider"], [role="menu"]')) return;
    this.continue();
  };

  /** Keep the screen on while the player waits. A locked phone is no use to wet hands. */
  async #stayAwake() {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> } }).wakeLock;
    if (!wakeLock || this.#wakeLock || !this.#wantsAwake || document.visibilityState !== 'visible' || Date.now() >= this.#wakeUntil) return;
    try {
      const lock = await wakeLock.request('screen');
      if (!this.#wantsAwake || this.#wakeLock) {
        void lock.release().catch(() => undefined);
        return;
      }
      this.#wakeLock = lock;
      this.#root?.toggleAttribute('data-step-awake', true);
      lock.addEventListener('release', () => {
        // The browser lets go when the page is hidden; `visibilitychange` asks again.
        if (this.#wakeLock === lock) {
          this.#wakeLock = null;
          this.#root?.removeAttribute('data-step-awake');
        }
      });
      // Not for ever: after half an hour the device may sleep.
      clearTimeout(this.#wakeTimer);
      this.#wakeTimer = window.setTimeout(() => this.#letSleep(), Math.max(this.#wakeUntil - Date.now(), 0));
    } catch {
      /* refused (low battery, power saving): the wait carries on without it */
    }
  }

  #letSleep() {
    clearTimeout(this.#wakeTimer);
    const lock = this.#wakeLock;
    this.#wakeLock = null;
    this.#root?.removeAttribute('data-step-awake');
    void lock?.release().catch(() => undefined);
  }

  #onVisibility = () => {
    if (document.visibilityState === 'visible') void this.#stayAwake();
  };

  /** The screen should stay on during a wait between steps, and for as long as counter mode is on. */
  get #wantsAwake(): boolean {
    return this.#counter || (this.#waiting !== -1 && !this.#ended);
  }

  // ---------------------------------------------------------------- counter mode

  /**
   * Fill the screen, without the device's own full screen: on an iPhone that would hand the video to
   * the system player and these controls would be gone. The player goes into the top layer where the
   * browser has one, so nothing on the page around it can clip or cover it.
   */
  #setCounter(on: boolean) {
    const root = this.#root as (HTMLElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!root || on === this.#counter) return;
    this.#counter = on;
    const page = document.documentElement;
    if (on) {
      root.toggleAttribute('data-step-counter', true);
      try {
        root.setAttribute('popover', 'manual');
        root.showPopover?.();
      } catch {
        root.removeAttribute('popover'); // no top layer here: fixed positioning still fills the window
      }
      if (!root.matches(':popover-open')) root.removeAttribute('popover');
      this.#pageOverflow = page.style.overflow;
      this.#pageScroll = [window.scrollX, window.scrollY];
      page.style.overflow = 'hidden';
      this.#wakeUntil = Date.now() + 4 * AWAKE_MS;
      void this.#stayAwake();
    } else {
      try {
        if (root.matches(':popover-open')) root.hidePopover?.();
      } catch {
        /* not open */
      }
      root.removeAttribute('popover');
      root.removeAttribute('data-step-counter');
      page.style.overflow = this.#pageOverflow;
      window.scrollTo(this.#pageScroll[0], this.#pageScroll[1]); // the page is where it was left
      if (!this.#wantsAwake) this.#letSleep();
    }
    const button = this.#parts.counter;
    button?.setAttribute('aria-pressed', String(on));
    if (this.#parts['counter-label']) {
      this.#parts['counter-label'].textContent = on
        ? this.#translate('stepwise.counter.exit', 'Exit')
        : this.#translate('stepwise.counter', 'Counter mode');
    }
    this.#say(on ? this.#translate('stepwise.counter.on', 'Counter mode on') : this.#translate('stepwise.counter.off', 'Counter mode off'));
  }

  /** Whether the player is filling the screen in counter mode. */
  get counterMode(): boolean {
    return this.#counter;
  }
  set counterMode(on: boolean) {
    this.#setCounter(on);
  }

  /** Whether the screen is being kept awake for the current wait. */
  get awake(): boolean {
    return this.#wakeLock !== null;
  }

  // ---------------------------------------------------------------- keys

  #onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    if (event.key === 'Escape' && this.#counter && !this.#root?.querySelector('media-menu[data-open]')) {
      this.#setCounter(false);
      event.preventDefault();
      return;
    }
    if (!this.#active) return;
    const key = event.key.toLowerCase();
    if (key === 'n') this.next();
    else if (key === 'b') this.back();
    else if (key === 'r') this.repeat();
    else if (key === 's') this.repeat(true);
    else if (key === 'w') this.#setWait(!this.#wait, true);
    else return;
    event.preventDefault();
  };

  // ---------------------------------------------------------------- drawing

  #render(index: number, progress: number) {
    const media = this.#media;
    const steps = this.#steps;
    if (index !== this.#index) {
      this.#index = index;
      if (this.#slowIndex !== -1 && index !== this.#slowIndex) this.#setSlow(-1);
      const step = steps[index];
      const { number, total, title, tag, back, next } = this.#parts;
      if (step) {
        if (number) number.textContent = String(index + 1);
        if (total) total.textContent = `/${steps.length}`;
        if (title) title.textContent = step.title;
        tag?.setAttribute('aria-label', `${this.#format('stepwise.of', 'Step {n} of {total}', index + 1, steps.length)}: ${step.title}`);
        if (media && !media.paused) {
          this.#say(`${this.#format('stepwise.of', 'Step {n} of {total}', index + 1, steps.length)}: ${step.title}`);
          this.#flash();
        }
        this.dispatchEvent(new CustomEvent('stepchange', { detail: { index, step } }));
      }
      back?.toggleAttribute('data-first', index <= 0);
      next?.toggleAttribute('disabled', index >= steps.length - 1);
    }

    // Hairline: every step before this one is full, this one fills as it plays.
    if (this.#segments.length && media) {
      const now = progress === 1 ? Infinity : media.currentTime;
      for (let i = 0; i < this.#segments.length; i++) {
        const step = steps[i];
        const span = Math.max(step.end - step.start, 0.001);
        const done = i < index ? 1 : i > index ? 0 : Math.min(Math.max((now - step.start) / span, 0), 1);
        this.#segments[i].style.setProperty('--sw-done', done.toFixed(4));
      }
    }
  }

  #renderHairline() {
    const host = this.#parts.hairline;
    this.#segments = [];
    if (!host) return;
    host.textContent = '';
    if (!this.#active) return;
    for (const step of this.#steps) {
      const segment = document.createElement('i');
      segment.style.flexGrow = String(Math.max(step.end - step.start, 0.001));
      host.append(segment);
      this.#segments.push(segment);
    }
  }

  #renderSummary() {
    const summary = this.#parts.summary;
    const counter = this.#parts['summary-count'];
    const count = this.#steps.length;
    const length = clock(this.#media?.duration ?? NaN);
    const steps = count > 1 ? this.#format('stepwise.count', '{n} steps', count) : '';
    if (counter && counter.textContent !== steps) counter.textContent = steps;
    if (summary && summary.textContent !== length) summary.textContent = length;
  }

  #renderPlate() {
    const index = this.#waiting;
    const steps = this.#steps;
    const next = steps[index + 1];
    const p = this.#parts;
    if (this.#ended) {
      if (p.done) p.done.textContent = this.#format('stepwise.done.all', 'All {n} steps done', steps.length);
      if (p['repeat-label']) p['repeat-label'].textContent = this.#format('stepwise.repeat.n', 'Repeat step {n}', index + 1);
      if (p['continue-kicker']) p['continue-kicker'].textContent = this.#translate('stepwise.again.kicker', 'From the top');
      if (p['continue-number']) p['continue-number'].textContent = '1';
      if (p['continue-title']) p['continue-title'].textContent = this.#translate('stepwise.again', 'Start again');
    } else {
      if (p.done) p.done.textContent = this.#format('stepwise.done', 'Step {n} of {total} done', index + 1, steps.length);
      if (p['repeat-label']) p['repeat-label'].textContent = this.#translate('stepwise.repeat', 'Repeat');
      if (p['continue-kicker']) {
        p['continue-kicker'].textContent = this.#touch
          ? this.#translate('stepwise.next.touch', 'Tap anywhere')
          : this.#translate('stepwise.next', 'Next step');
      }
      if (p['continue-number']) p['continue-number'].textContent = String(index + 2);
      if (p['continue-title']) p['continue-title'].textContent = next?.title ?? '';
    }
  }

  /** Show the step's title for a moment, for viewers whose controls are hidden. */
  #flash() {
    const root = this.#root;
    if (!root || !this.#active) return;
    root.toggleAttribute('data-step-flash', true);
    clearTimeout(this.#flashTimer);
    this.#flashTimer = window.setTimeout(() => root.removeAttribute('data-step-flash'), FLASH_MS);
  }

  #say(text: string) {
    const status = this.#parts.status;
    if (status) status.textContent = text.trim();
  }

  #translate(key: string, fallback: string): string {
    // Skin-specific keys are not in Video.js's typed phrase list; the translator falls back to `default`.
    const translate = this.#i18n.value as unknown as ((key: string, options: { default: string }) => string) | undefined;
    try {
      return translate?.(key, { default: fallback }) || fallback;
    } catch {
      return fallback;
    }
  }

  #format(key: string, fallback: string, n: number, total?: number): string {
    return this.#translate(key, fallback)
      .replace('{n}', String(n))
      .replace('{total}', String(total ?? ''));
  }
}

if (!customElements.get('stepwise-steps')) {
  customElements.define('stepwise-steps', StepwiseStepsElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'stepwise-steps': StepwiseStepsElement;
  }
}
