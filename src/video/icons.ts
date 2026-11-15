/**
 * Stepwise icon family.
 *
 * Drawn on a 20 px grid with a 2 px stroke, round caps and joins: heavier than most player icons, so
 * they hold up at arm's length. Transport glyphs (play, pause, the two step buttons) are solid; the
 * rest are line work. The play triangle sits half a unit right of centre so it looks centred.
 */
import { registerIcons } from '@videojs/html/icons';

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" aria-hidden="true" viewBox="0 0 20 20">${body}</svg>`;

const line = 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const solid = 'fill="currentColor"';

const play = svg(`<path ${solid} d="M6.5 3.6v12.8c0 .9 1 1.5 1.8 1l10-6.4a1.2 1.2 0 0 0 0-2L8.3 2.6c-.8-.5-1.8.1-1.8 1z"/>`);
const pause = svg(`<rect ${solid} x="4" y="3" width="4.5" height="14" rx="1.4"/><rect ${solid} x="11.5" y="3" width="4.5" height="14" rx="1.4"/>`);
const restart = svg(`<path ${line} d="M4 10a6 6 0 1 0 1.9-4.4L4 7.4"/><path ${line} d="M4 3.4v4h4"/>`);
const repeat = restart;
const seek = svg(`<path ${line} d="M5 15a7 7 0 1 1 10 0"/><path ${line} d="M17 3v4.5h-4.5"/>`);

/* Step buttons: a solid triangle against a stop bar. */
const stepNext = svg(`<path ${solid} d="M3 4.3v11.4c0 .9 1 1.4 1.7.9l8-5.7a1.1 1.1 0 0 0 0-1.8l-8-5.7C4 2.9 3 3.4 3 4.3z"/><rect ${solid} x="14.5" y="3.5" width="2.6" height="13" rx="1.3"/>`);
const stepBack = svg(`<path ${solid} d="M17 4.3v11.4c0 .9-1 1.4-1.7.9l-8-5.7a1.1 1.1 0 0 1 0-1.8l8-5.7c.7-.5 1.7 0 1.7.9z"/><rect ${solid} x="2.9" y="3.5" width="2.6" height="13" rx="1.3"/>`);
const arrow = svg(`<path ${line} d="M4 10h12M11 5l5 5-5 5"/>`);

const speaker = `<path ${solid} d="M2 7.6h2.7L9.3 4c.5-.4 1.2 0 1.2.6v10.8c0 .6-.7 1-1.2.6l-4.6-3.6H2z"/>`;
const volumeHigh = svg(`${speaker}<path ${line} d="M13.4 7.3a3.8 3.8 0 0 1 0 5.4M15.7 4.8a7.3 7.3 0 0 1 0 10.4"/>`);
const volumeLow = svg(`${speaker}<path ${line} d="M13.4 7.3a3.8 3.8 0 0 1 0 5.4"/>`);
const volumeOff = svg(`${speaker}<path ${line} d="m13.5 7.8 4.4 4.4m0-4.4-4.4 4.4"/>`);

const captionsOff = svg(`<rect ${line} x="2" y="4" width="16" height="12" rx="2.5"/><path ${line} d="M5.8 10h2.7M11.5 10h2.7"/>`);
const captionsOn = svg(`<rect ${solid} x="1" y="3" width="18" height="14" rx="3.5"/><path stroke="var(--sw-icon-knockout, #111)" stroke-width="2" stroke-linecap="round" d="M5.8 10h2.7M11.5 10h2.7"/>`);

const fullscreenEnter = svg(`<path ${line} d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4"/>`);
const fullscreenExit = svg(`<path ${line} d="M7.5 3.5v4h-4M16.5 7.5h-4v-4M12.5 16.5v-4h4M3.5 12.5h4v4"/>`);

const pipEnter = svg(`<rect ${line} x="2" y="4" width="16" height="12" rx="2.5"/><rect ${solid} x="10" y="9.5" width="6" height="4.5" rx="1.2"/>`);
const pipExit = svg(`<rect ${line} x="2" y="4" width="16" height="12" rx="2.5"/><rect ${solid} x="4" y="6" width="6" height="4.5" rx="1.2"/>`);

const airplayEnter = svg(`<path ${line} d="M5 14H4a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V12a2 2 0 0 1-2 2h-1"/><path ${line} d="m10 11 4.3 5.5H5.7z"/>`);
const airplayExit = svg(`<path ${line} d="M5 14H4a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V12a2 2 0 0 1-2 2h-1"/><path ${line} ${solid} d="m10 11 4.3 5.5H5.7z"/>`);
const castEnter = svg(`<path ${line} d="M2 7.5V5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5"/><path ${line} d="M2 11.5a5 5 0 0 1 5 5M2 15.2a1.3 1.3 0 0 1 1.3 1.3"/>`);
const castExit = svg(`<path ${line} d="M2 7.5V5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5"/><path ${line} d="M2 11.5a5 5 0 0 1 5 5M2 15.2a1.3 1.3 0 0 1 1.3 1.3"/><path ${solid} d="M6 7h9v6.5h-3.6A7.4 7.4 0 0 0 6 9.2z"/>`);

const gear = svg(`<path ${line} d="M3 6h7M14 6h3M3 14h3M10 14h7"/><circle ${line} cx="12" cy="6" r="2"/><circle ${line} cx="8" cy="14" r="2"/>`);
const chevron = svg(`<path ${line} d="m7.5 4.5 5.5 5.5-5.5 5.5"/>`);
const check = svg(`<path stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m4 10.5 4 4 8-9"/>`);
const speed = svg(`<path ${line} d="M3 13a7 7 0 1 1 14 0"/><path ${line} d="m10 13 3.2-4.5"/>`);
const speech = captionsOff;
const quality = svg(`<path ${line} d="M4 15v-3M8 15V9M12 15V6M16 15V4"/>`);
const audio = volumeLow;
// A screen leaning back on a counter top. (A screen over a triangle would read as AirPlay.)
const counter = svg(`<rect ${line} x="5" y="2.75" width="10.5" height="11" rx="2.25" transform="rotate(-9 10.25 8.25)"/><path ${line} d="M2.5 17.25h15"/>`);
const mic = svg(`<rect ${line} x="7.5" y="2.5" width="5" height="9" rx="2.5"/><path ${line} d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/>`);
const list = svg(`<path ${line} d="M8 5h9M8 10h9M8 15h9"/><circle ${solid} cx="3.8" cy="5" r="1.3"/><circle ${solid} cx="3.8" cy="10" r="1.3"/><circle ${solid} cx="3.8" cy="15" r="1.3"/>`);
const spinner = svg(
  `<style>@keyframes sw-spin{to{transform:rotate(360deg)}}</style><path ${line} d="M10 3a7 7 0 1 1-7 7" style="transform-origin:10px 10px;animation:var(--media-spinner-animation, sw-spin .9s linear infinite)"/>`
);

registerIcons('stepwise', {
  'airplay-enter': airplayEnter,
  'airplay-exit': airplayExit,
  arrow,
  audio,
  'captions-off': captionsOff,
  'captions-on': captionsOn,
  'cast-enter': castEnter,
  'cast-exit': castExit,
  check,
  counter,
  chevron,
  'fullscreen-enter': fullscreenEnter,
  'fullscreen-exit': fullscreenExit,
  gear,
  list,
  mic,
  pause,
  'pip-enter': pipEnter,
  'pip-exit': pipExit,
  play,
  quality,
  repeat,
  restart,
  seek,
  speech,
  speed,
  spinner,
  'step-back': stepBack,
  'step-next': stepNext,
  'volume-high': volumeHigh,
  'volume-low': volumeLow,
  'volume-off': volumeOff,
});
