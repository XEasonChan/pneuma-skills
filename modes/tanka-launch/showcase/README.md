# Launch Studio showcase

The four 1376 × 768 gallery PNGs are **screenshots of the running viewer**, not artwork. Each one is a `--viewing` session over a
run that `viewer/fixtures/build-fixture.mjs` builds through the real `tl.mjs` (scenario `roughcut`: a fictional product, ACME,
with the rough cut waiting at the gate), driven through CDP by [`shoot.mjs`](shoot.mjs) and resampled to the size the launcher
lays out. The film frames inside them are the kit's own seed film (`seed/remotion/scenes.json`) rendered with Remotion.

| `showcase.json` media | What it is |
|---|---|
| `hero.png` | The whole run fitted on the canvas: options per stage, the picked path, the version nodes |
| `highlight-script.png` | Stage 2 open: three script options, the scene table with JA / EN VO, on-screen text and density |
| `highlight-music.png` | Stage 3 open: the picked bed's players and its BPM-over-time lane |
| `highlight-gate.png` | The rough-cut page parked on the lockup at 13.6 s, with its QC rows and the hard-gate badge |

`__tests__/showcase.test.ts` fails if `showcase.json` names a file that is not on disk or a capture is not exactly 1376 × 768.

## Re-shoot

1. Render the seed film once (any run workspace made from `seed/`, after `npm install` in its `remotion/`), then loop it:

   ```sh
   cd <run>/remotion && TL_KIT_DIR=<repo>/modes/tanka-launch/skill/kit node render.mjs short-16x9-en,short-16x9-ja --scale 0.5
   ffmpeg -stream_loop 3 -i ../out/picture/short-16x9-en.mp4 -t 58 -c copy /tmp/loop-en.mp4   # same for -ja
   ```

2. Build the fixture run into a scratch folder — never open the repository with an agent attached:

   ```sh
   FIXTURE_VIDEO_EN=/tmp/loop-en.mp4 FIXTURE_VIDEO_JA=/tmp/loop-ja.mp4 \
     bun modes/tanka-launch/viewer/fixtures/build-fixture.mjs /tmp/launch-ws/run roughcut
   ```

3. Start a **viewing** session and a headless Chrome on ports of your own:

   ```sh
   PNEUMA_VITE_PORT=18497 bun bin/pneuma.ts tanka-launch --dev --workspace /tmp/launch-ws/run --viewing --no-open --no-prompt --port 18496
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=19426 \
     --user-data-dir=/tmp/launch-shot-profile --no-first-run --hide-scrollbars --force-device-scale-factor=1 \
     --window-size=1376,768 --autoplay-policy=no-user-gesture-required about:blank &
   ```

4. Shoot (ffmpeg resamples the 2× captures down to 1376 × 768):

   ```sh
   bun modes/tanka-launch/showcase/shoot.mjs --url "http://localhost:18497?session=<id>&mode=tanka-launch" --out modes/tanka-launch/showcase
   ```

   Quantize before shipping if a PNG optimiser is available (e.g. `pngquant --quality=70-95 --ext .png --force …`).
