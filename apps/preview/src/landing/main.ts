import '@fontsource-variable/figtree';
import '@videojs/html/i18n';
import '@/skin.css';
import './landing.css';
import { createPlayer, currentClip } from '../frame/player';

// The i18n provider follows the page's `lang` and loads Video.js's built-in translations for it.
const i18n = document.createElement('media-i18n');
const stage = document.getElementById('stage')!;
i18n.append(createPlayer());
stage.append(i18n);

// Width presets, so the responsive layout can be judged without leaving the page.
const sizes = Array.from(document.querySelectorAll<HTMLButtonElement>('.size'));
for (const button of sizes) {
  button.addEventListener('click', () => {
    stage.style.maxWidth = `${button.dataset.w}px`;
    for (const other of sizes) other.setAttribute('aria-pressed', String(other === button));
  });
}

const credit = document.getElementById('credit');
const clip = currentClip();
if (credit) {
  credit.textContent = clip
    ? `Playing “${clip.title}”, streamed from Mux. Its chapters are the steps.`
    : 'Playing the small bundled test clip.';
}
