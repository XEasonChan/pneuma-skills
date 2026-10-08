# Kit placeholders

Everything under `assets/` is a neutral stand-in written for this kit (plain SVG shapes, no third-party or company artwork). They exist
so the kit's scenes render with their defaults and in the Preview gallery; a run replaces them with its own files through scene props
(`logo`, `src`) pointing at `assets/…` in the run workspace.

| File | Used by | What it is |
|---|---|---|
| `placeholder/mark.svg` | `logo-lockup` (example `logo` prop) | a rounded square with a ring |
| `placeholder/still.svg` | `footage-card` default `src` | a soft gradient with three shapes |

Other placeholders are generated at run time, never shipped:

- **Music beds**: `skill/scripts/common/placeholder_beds.py` synthesises the seed library's beds (kick / clap / hats / bass / pad on a
  steady grid) into the cache dir on first use.
- **SFX**: `skill/scripts/common/kit.py` synthesises a procedural voice for every role when no sample file is present.
- **Mock images and footage**: `skill/scripts/common/mock.py` renders gradient stills and `testsrc2` clips with ffmpeg.
- **Mock VO**: the local TTS (`say` on macOS, espeak-ng on Linux).
