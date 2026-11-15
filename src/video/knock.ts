/**
 * Two knocks.
 *
 * Listens to a stream of loudness readings and reports when it hears exactly two short, sharp sounds
 * close together with quiet on either side: knock, knock. That shape is what tells a deliberate knock
 * on the counter from the rest of a kitchen. Talking is too long, chopping does not stop at two, and a
 * dropped spoon is only one.
 *
 * It knows nothing about microphones or the page. Feed it the peak level (0 to 1) of each slice of
 * sound with the time it was taken, and it returns what, if anything, just happened.
 */
export interface KnockOptions {
  /** Quietest peak that can count as a knock, whatever the room is doing. */
  minPeak?: number;
  /** How far above the room's own noise a knock has to stand. */
  ratio?: number;
}

export type KnockEvent = 'knock' | 'double' | null;

/** A sound longer than this is not a knock. Milliseconds, from its start to where it has mostly died away. */
const MAX_KNOCK_MS = 130;
/** A knock is at its loudest almost at once. A spoken syllable swells; this is what tells "uh-huh" from knock, knock. */
const MAX_ATTACK_MS = 20;
/** The second knock comes this long after the first, no sooner and no later. */
const GAP_MIN_MS = 110;
const GAP_MAX_MS = 750;
/** Quiet needed before the first knock and after the second. */
const QUIET_BEFORE_MS = 280;
const QUIET_AFTER_MS = 320;

/** After a knock, its ring may hang about this long before it counts as noise that has started. */
const MAX_TAIL_MS = 300;
/** Inside a knock's ring, a new knock is a jump of at least this many times the ring's lowest point. */
const RISE = 3;
/** How quickly the idea of "the room's own noise" follows the room. Milliseconds. */
const FLOOR_MS = 250;
const NOISE_MS = 700;

export class KnockDetector {
  #minPeak: number;
  #ratio: number;
  #floor = 0.01; // the room's running noise level
  // idle: quiet. sound: something is sounding. tail: a short sound has ended and is ringing away.
  #state: 'idle' | 'sound' | 'tail' = 'idle';
  #soundStart = 0;
  #soundPeak = 0;
  #peakTime = 0;
  #tailStart = 0;
  #tailLow = 0;
  #lastTime = -Infinity;
  #lastActivity = -Infinity; // end of the most recent sound of any kind
  #first = -Infinity; // start time of the first knock of a pair, when one is pending
  #second = -Infinity; // end time of the second knock, when the pair is waiting out its quiet

  constructor(options: KnockOptions = {}) {
    this.#minPeak = options.minPeak ?? 0.035;
    this.#ratio = options.ratio ?? 5;
  }

  /** The level a sound has to reach right now to be noticed. */
  get threshold(): number {
    return Math.max(this.#minPeak, this.#floor * this.#ratio);
  }

  reset(): void {
    this.#state = 'idle';
    this.#first = -Infinity;
    this.#second = -Infinity;
    this.#lastActivity = -Infinity;
  }

  #learn(peak: number, elapsed: number, over: number): void {
    const weight = 1 - Math.exp(-Math.min(elapsed, 100) / over);
    this.#floor += (peak - this.#floor) * weight;
  }

  #begin(peak: number, time: number): void {
    this.#state = 'sound';
    this.#soundStart = time;
    this.#soundPeak = peak;
    this.#peakTime = time;
  }

  /** One reading: the peak level of the latest slice of sound, and when (milliseconds). */
  push(peak: number, time: number): KnockEvent {
    let event: KnockEvent = null;
    const elapsed = this.#lastTime === -Infinity ? 10 : Math.max(0, time - this.#lastTime);
    this.#lastTime = time;

    if (this.#state === 'idle') {
      if (peak > this.threshold) this.#begin(peak, time);
      else this.#learn(peak, elapsed, FLOOR_MS); // quiet moments teach it what the room sounds like
    } else if (this.#state === 'tail') {
      this.#tailLow = Math.min(this.#tailLow, peak);
      if (peak <= this.threshold) {
        this.#state = 'idle';
      } else if (peak > this.#tailLow * RISE) {
        this.#begin(peak, time); // a fresh strike on top of the last one's ring
      } else if (time - this.#tailStart > MAX_TAIL_MS) {
        // It is not ringing away: something has started up. Hand it over as a long sound.
        this.#state = 'sound';
        this.#soundStart = this.#tailStart - MAX_KNOCK_MS - 1;
      }
    } else {
      if (peak > this.#soundPeak) {
        this.#soundPeak = peak;
        this.#peakTime = time;
      }
      const over = peak < Math.max(this.#minPeak * 0.6, this.#soundPeak * 0.3);
      const short = time - this.#soundStart <= MAX_KNOCK_MS;
      if (!short) {
        // Talking, a tap running, a blender: not a knock, and it spoils any pair in progress. If it
        // goes on, it becomes the room's new noise level, and knocks are listened for above it.
        this.#first = -Infinity;
        this.#second = -Infinity;
        this.#lastActivity = time;
        this.#learn(peak, elapsed, NOISE_MS);
        if (peak <= this.threshold) this.#state = 'idle';
      } else if (over) {
        const start = this.#soundStart;
        const quietBefore = start - this.#lastActivity >= QUIET_BEFORE_MS;
        const sharp = this.#peakTime - start <= MAX_ATTACK_MS;
        if (!sharp || this.#second !== -Infinity) {
          // Too soft-edged to be a knock, or a third sound: this was never "knock, knock".
          this.#first = -Infinity;
          this.#second = -Infinity;
        } else if (this.#first !== -Infinity && start - this.#first >= GAP_MIN_MS && start - this.#first <= GAP_MAX_MS) {
          this.#second = time;
          event = 'knock';
        } else if (quietBefore) {
          this.#first = start;
          event = 'knock';
        } else {
          this.#first = -Infinity;
        }
        this.#lastActivity = time;
        this.#state = 'tail';
        this.#tailStart = time;
        this.#tailLow = peak;
      }
    }

    const sounding = this.#state === 'sound';
    // A first knock with no answer is forgotten.
    if (this.#first !== -Infinity && this.#second === -Infinity && !sounding && time - this.#first > GAP_MAX_MS) {
      this.#first = -Infinity;
    }
    // Two knocks, then quiet: that is the signal.
    if (this.#second !== -Infinity && !sounding && time - this.#second >= QUIET_AFTER_MS) {
      this.#first = -Infinity;
      this.#second = -Infinity;
      return 'double';
    }
    return event;
  }
}
