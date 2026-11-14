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
 *   [data-step="plate"]      the wait plate; holds ["done"], ["repeat"], ["repeat-label"], ["continue"],
 *                            ["continue-kicker"], ["continue-number"], ["continue-title"]
 *   [data-step="hairline"]   progress kept on screen while the controls are hidden
 *   [data-step="status"]     live region for step changes
 *
 * State for styling is written on the <media-container>:
 *   data-steps="7"           there are steps (absent otherwise)
 *   data-step-started        playback has begun
 *   data-step-flash          a step has just begun; show its title for a moment
 *   data-step-waiting        waiting at the end of a step (value "end" after the last one)
 *   data-step-wait="on|off"  the switch
 *
 * Keys, when the player has focus: N next step, B back a step, R repeat this step, W toggle waiting.
 * Events on the element: `stepchange` and `stepwait`, both with `detail: { index, step }`.
 */
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
    root.addEventListener('keydown', this.#onKeyDown, { signal });

    this.#attachMedia();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    cancelAnimationFrame(this.#frame);
    clearTimeout(this.#flashTimer);
    clearTimeout(this.#pollTimer);
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

  /** Play this step again from its start. */
  repeat(): void {
    const media = this.#media;
    if (!media || !this.#steps.length) return;
    const at = this.#waiting !== -1 ? this.#waiting : Math.max(this.#index, 0);
    this.#leaveWait();
    this.#seek(this.#steps[at].start);
    this.#say(this.#format('stepwise.status.repeat', 'Repeating step {n}', at + 1));
    void Promise.resolve(media.play()).catch(() => undefined);
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
    void Promise.resolve(media.play()).catch(() => undefined);
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
    root.setAttribute('data-step-waiting', this.#ended ? 'end' : 'step');
    this.#renderPlate();
    if (plate) plate.inert = false;
    // Deciding takes as long as it takes: hold the controls while the plate is up.
    this.#releaseLock ??= this.#controls.value?.requestControlsLock?.() ?? null;

    const step = this.#steps[index];
    const next = this.#steps[index + 1];
    const said = this.#ended
      ? this.#translate('stepwise.status.end', 'All steps done.')
      : `${this.#format('stepwise.status.done', 'Step {n} done.', index + 1)} ${this.#translate('stepwise.status.waiting', 'Waiting.')} ${
          next ? `${this.#translate('stepwise.next', 'Next step')}: ${next.title}` : ''
        }`;
    this.#say(said);

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
    root?.removeAttribute('data-step-waiting');
    if (plate) plate.inert = true;
    this.#releaseLock?.();
    this.#releaseLock = null;
    // Focus was on a button that has just gone; hand it to the play button rather than drop it.
    if (hadFocus) (root?.querySelector('.sw-play') as HTMLElement | null)?.focus({ preventScroll: true });
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

  // ---------------------------------------------------------------- keys

  #onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    if (!this.#active) return;
    const key = event.key.toLowerCase();
    if (key === 'n') this.next();
    else if (key === 'b') this.back();
    else if (key === 'r') this.repeat();
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
      if (p['continue-kicker']) p['continue-kicker'].textContent = this.#translate('stepwise.next', 'Next step');
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
