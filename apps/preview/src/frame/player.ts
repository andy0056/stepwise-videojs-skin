import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';

/**
 * What the preview plays.
 *
 * Stepwise reads a video's chapters as steps, so each clip names a WebVTT chapters file in `public/`.
 * Clips stream from Mux; `?clip=<key>` picks one. `?media=demo` plays the small bundled file, for
 * work on the skin without a network. `?media=plain` plays it without chapters, to see the skin as
 * an ordinary player.
 */
interface Clip {
  key: string;
  title: string;
  playbackId: string;
  chapters: string;
  /** Second shown before the video starts. */
  poster: number;
}

const CLIPS: Clip[] = [
  {
    key: 'stars',
    title: 'How are we made of star stuff?',
    playbackId: 'pKXQkIyGiC4S4urt7p7ivSqmItowQ0237J00E4NyF2JX8',
    chapters: './star-stuff-chapters.vtt',
    poster: 1,
  },
];

const DEMO_SRC = './stepwise-demo.mp4';
const DEMO_CAPTIONS = './stepwise-demo.vtt';
const DEMO_CHAPTERS = './stepwise-demo-chapters.vtt';

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

/** Clips that can be played: those with a playback ID. */
export function playableClips(): readonly Clip[] {
  return CLIPS.filter((clip) => clip.playbackId);
}

/** The clip the address asks for, or the first playable one. Null when the bundled file is forced. */
export function currentClip(): Clip | null {
  if (/[?#&]media=(demo|plain)\b/.test(location.href)) return null;
  const asked = /[?&]clip=([\w-]+)/.exec(location.search)?.[1];
  const playable = playableClips();
  return playable.find((clip) => clip.key === asked) ?? playable[0] ?? null;
}

export function createPlayer(): HTMLElement {
  const player = document.createElement('video-player');
  const clip = currentClip();

  let media: string;
  if (clip) {
    media = `<mux-video src="https://stream.mux.com/${clip.playbackId}.m3u8" playsinline crossorigin><track kind="chapters" label="English" srclang="en" src="${clip.chapters}" default></mux-video>`;
    player.setAttribute('poster', `https://image.mux.com/${clip.playbackId}/thumbnail.webp?time=${clip.poster}`);
    player.setAttribute('content-title', clip.title);
  } else {
    const plain = /[?#&]media=plain\b/.test(location.href);
    const chapters = plain ? '' : `<track kind="chapters" label="English" srclang="en" src="${DEMO_CHAPTERS}" default>`;
    media = `<video src="${DEMO_SRC}" playsinline crossorigin preload="metadata"><track kind="captions" label="English" srclang="en" src="${DEMO_CAPTIONS}">${chapters}</video>`;
    player.setAttribute('content-title', plain ? 'A video without steps' : 'Fold a paper boat');
  }

  // `?hands=knock` or `?hands=voice` tries the other hands-free signal on this device; `?hands=off` hides both.
  const hands = /[?&]hands=(knock|voice|off)\b/.exec(location.search)?.[1];
  if (hands) player.setAttribute('hands-free', hands);

  player.innerHTML = skinTemplate.replace(MEDIA_PLACEHOLDER, media);
  return player;
}
