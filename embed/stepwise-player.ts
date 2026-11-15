/**
 * <stepwise-player> — the whole skin as one element, for dropping into a site that has no build step
 * for it. Build with `npm run build:embed`; copy everything in `dist-embed/` to the site and load both
 * files.
 *
 *   <link rel="stylesheet" href="/stepwise/stepwise-player.css">
 *   <script type="module" src="/stepwise/stepwise-player.js"></script>
 *
 *   <stepwise-player
 *     playback-id="…"              a Mux playback ID (or `src` for a plain video file)
 *     chapters="/chapters.vtt"     WebVTT chapters: each one is a step
 *     captions="/captions.vtt"     optional WebVTT captions
 *     poster-time="3"              second shown before the video starts (Mux), or `poster` for an image
 *     video-title="…"
 *     hands-free="knock|voice|off" optional: overrides the hands-free signal the device would get
 *   ></stepwise-player>
 *
 * The host page styles it with the skin's public properties, set on the element: `--media-accent-color`,
 * `--media-accent-text-color`, `--media-font-family`, `--media-border-radius`.
 */
import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@videojs/html/i18n';
import '../src/video/skin';
import skinTemplate from '../src/video/skin.html?raw';
import './stepwise-player.css';

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

class StepwisePlayerElement extends HTMLElement {
  #built = false;

  connectedCallback() {
    if (this.#built) return;
    this.#built = true;

    const playbackId = this.getAttribute('playback-id') ?? '';
    const src = this.getAttribute('src') ?? '';
    const chapters = this.getAttribute('chapters') ?? '';
    const captions = this.getAttribute('captions') ?? '';
    const title = this.getAttribute('video-title') ?? '';
    const hands = this.getAttribute('hands-free');

    const tracks =
      (captions ? `<track kind="captions" label="English" srclang="en" src="${attr(captions)}">` : '') +
      (chapters ? `<track kind="chapters" label="English" srclang="en" src="${attr(chapters)}" default>` : '');
    const media = playbackId
      ? `<mux-video src="https://stream.mux.com/${attr(playbackId)}.m3u8" playsinline crossorigin>${tracks}</mux-video>`
      : `<video src="${attr(src)}" playsinline crossorigin preload="metadata">${tracks}</video>`;

    const player = document.createElement('video-player');
    const poster =
      this.getAttribute('poster') ??
      (playbackId
        ? `https://image.mux.com/${playbackId}/thumbnail.webp?time=${encodeURIComponent(this.getAttribute('poster-time') ?? '1')}`
        : '');
    if (poster) player.setAttribute('poster', poster);
    if (title) player.setAttribute('content-title', title);
    if (hands) player.setAttribute('hands-free', hands);

    player.innerHTML = skinTemplate.replace(MEDIA_PLACEHOLDER, media);

    // The i18n provider follows the page's `lang` and loads Video.js's built-in translations for it.
    const i18n = document.createElement('media-i18n');
    i18n.append(player);
    this.append(i18n);
  }
}

if (!customElements.get('stepwise-player')) {
  customElements.define('stepwise-player', StepwisePlayerElement);
}
