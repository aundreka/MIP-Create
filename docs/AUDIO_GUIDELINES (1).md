# Audio Guidelines

## Architecture

All gameplay sound effects must use `src/hooks/useSound.js`. Do not create audio elements inside event handlers or timers, and do not introduce Web Audio (`AudioContext`) without verifying every supported browser and ad WebView.

The hook intentionally uses separate platform strategies:

- **Desktop browsers:** persistent `HTMLAudioElement` instances are created during layout and silently primed on the first `pointerdown`.
- **iOS and Android:** a pre-created media pool is primed during the first supported touch/pointer gesture. Rejected timer-driven playback is retried during the active drag.

This split is required for reliable drag-to-start audio across desktop browsers and mobile WebViews. Keep iPadOS desktop-mode detection in `isMobileMediaPlatform()`.

## Registering Sounds

Import assets explicitly from `src/assets/sounds/` and call `useSound` unconditionally near the top of the component:

```jsx
const catchAudio = useSound(catchSound, {
  poolSize: 3,
  desktopPoolSize: 1,
});
```

`poolSize` controls the mobile pool. `desktopPoolSize` controls desktop and defaults to `poolSize`. Use multiple instances when a sound may overlap or be restarted quickly. The current game uses one desktop catch sound, one win sound, and four rotating pencil sounds.

Play through the helper so playback always resets to the beginning:

```jsx
const source = playSound(catchAudio);
playSound(catchAudio, { volume: 0.8 });
stopSound(source);
```

Do not call `.play()` directly unless extending the audio hook itself.

## Gesture Unlocking

Audio must unlock from the gameplay drag—not from a separate “Tap to Start” control. The tray calls `handleUnlockGesture("pointerdown")` before pointer capture or other drag work. It also calls the helper during pointer movement and release for mobile retry behavior.

Keep native listeners attached directly to the draggable tray in addition to React handlers. Some mobile WebViews require audio authorization on the touched element rather than through React’s delegated events.

## Implementation Rules

- Create and preload audio before the first interaction.
- Prime the exact elements that will later play; replacement elements may remain blocked.
- Preserve muted state and volume while priming.
- Reset `currentTime` before replaying an SFX.
- Catch playback promise rejections to avoid unhandled errors.
- Keep timer-delayed cues routed through the mobile retry mechanism.
- Do not remove the desktop `pointerdown` contract or broaden platform detection to every touchscreen; touchscreen laptops use the desktop path.

## Verification

Run:

```bash
yarn lint
yarn build
yarn dev
```

Test a real drag followed by an item catch in desktop Chromium and Safari/WebKit, plus physical iOS and Android devices. Confirm the first interaction can be a drag, SFX plays without an earlier page click, overlapping cues remain audible, and no start overlay appears. The local missing `mraid.js` warning is expected outside an ad container; investigate all other console errors.
