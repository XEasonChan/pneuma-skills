"""Mock-mode stand-ins (no provider, no cost): a local TTS for voices (macOS `say` on a Mac, espeak-ng on Linux / the hosted
container), placeholder images and clips via ffmpeg.

The engine: $TL_MOCK_TTS (say | espeak-ng) when set, else `say` on macOS when it is on PATH, else espeak-ng (or espeak). The pool's
`mock` stand-ins in voices.json are macOS voice names; on espeak-ng each maps to a fixed variant of the language's voice (same name =
same variant, so two pool voices still sound different), and a variant name (`ja+f3`) passes straight through."""
import os, re, shutil, subprocess, sys, tempfile, zlib

SAY_FALLBACK = {'ja': ['Kyoko', 'Flo (Japanese (Japan))', 'Eddy (Japanese (Japan))'], 'en': ['Samantha', 'Daniel', 'Karen', 'Moira']}
# espeak-ng voices per language (base voice + variants); the first is the default
ESPEAK_VOICES = {'ja': ['ja', 'ja+f3', 'ja+m3', 'ja+f2', 'ja+m2'], 'en': ['en-us', 'en-gb', 'en-us+f3', 'en-gb+m3', 'en-us+f2', 'en-gb-x-rp']}


def engine():
    """'say' | 'espeak-ng' | 'espeak' | None: the local TTS mock mode uses on this machine"""
    want = os.environ.get('TL_MOCK_TTS', '').strip().lower()
    if want in ('say', 'espeak-ng', 'espeak'):
        return want if shutil.which(want) else None
    if sys.platform == 'darwin' and shutil.which('say'): return 'say'
    for e in ('espeak-ng', 'espeak'):
        if shutil.which(e): return e
    return 'say' if shutil.which('say') else None


def say_voices():
    if not shutil.which('say'): return {}
    out = subprocess.run(['say', '-v', '?'], capture_output=True, text=True).stdout
    v = {}
    for line in out.splitlines():
        m = re.match(r'^(.*?)\s+([a-z]{2}_[A-Z]{2})\s+#', line)
        if m: v[m.group(1).strip()] = m.group(2)
    return v


def pick_say_voice(lang, wanted=None):
    vs = say_voices()
    if wanted and wanted in vs: return wanted
    for c in SAY_FALLBACK.get(lang, []):
        if c in vs: return c
    for name, loc in vs.items():
        if loc.startswith(lang): return name
    return None


def pick_espeak_voice(lang, wanted=None):
    """a variant of the language's espeak-ng voice: `wanted` itself when it is one, else a fixed pick by the name's hash"""
    pool = ESPEAK_VOICES.get(lang) or [lang]
    if not wanted: return pool[0]
    if wanted in pool or re.match(r'^[a-z]{2,3}(-[a-z0-9-]+)?(\+[a-z0-9]+)?$', wanted): return wanted
    return pool[zlib.crc32(wanted.encode('utf-8')) % len(pool)]


def pick_voice(lang, wanted=None):
    """the voice the current engine would use (None when there is no local TTS)"""
    e = engine()
    if e == 'say': return pick_say_voice(lang, wanted)
    if e: return pick_espeak_voice(lang, wanted)
    return None


def _render(text, lang, voice, rate, d):
    """-> (raw audio file, voice used)"""
    e = engine()
    if e is None:
        raise SystemExit('mock VO needs a local TTS: macOS `say`, or espeak-ng on Linux (apt install espeak-ng)')
    if e == 'say':
        v = pick_say_voice(lang, voice); raw = os.path.join(d, 'a.aiff')
        cmd = ['say', '-o', raw] + (['-v', v] if v else []) + (['-r', str(int(rate))] if rate else []) + [text]
    else:
        v = pick_espeak_voice(lang, voice); raw = os.path.join(d, 'a.wav')
        # espeak-ng's -s is words per minute like say's -r; its default (175) is close to say's
        cmd = [e, '-v', v, '-w', raw] + (['-s', str(int(rate))] if rate else []) + ['--', text]
    subprocess.run(cmd, check=True, capture_output=True)
    return raw, v


def say(text, out, lang, voice=None, rate=None):
    """render `text` with the local TTS (say / espeak-ng) to `out` (.mp3/.wav); returns the voice used. Raises if there is none."""
    d = tempfile.mkdtemp(prefix='tl-say-')
    try:
        raw, v = _render(text, lang, voice, rate, d)
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        codec = ['-c:a', 'libmp3lame', '-b:a', '128k'] if out.endswith('.mp3') else ['-c:a', 'pcm_s16le']
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-ar', '44100', '-ac', '1', *codec, out], check=True)
    finally:
        shutil.rmtree(d, ignore_errors=True)
    return v


def placeholder_image(out, w=1024, h=1024, label='mock', seed=0):
    """a soft gradient placeholder PNG (no text rendering needed)"""
    hue = (seed * 47) % 360
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    vf = f"geq=r='128+100*sin(X/{w}*3.14+{hue})':g='128+90*sin(Y/{h}*3.14)':b='190-60*sin((X+Y)/{w+h}*3.14)'"
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=gray:s={w}x{h}:d=1', '-vf', vf, '-frames:v', '1', out], check=True)
    return out


def placeholder_clip(out, seconds=4, w=1280, h=720, fps=24, seed=0):
    """a moving placeholder clip (testsrc2 under a soft colour grade), no audio"""
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc2=s={w}x{h}:r={fps}:d={seconds}',
                    '-vf', 'hue=s=0.35,eq=brightness=0.05:contrast=0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-an', out], check=True)
    return out
