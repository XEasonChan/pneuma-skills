"""Workspace helpers shared by every stage script: where the run workspace is, film.json (read-only here: it is owned by
tl.mjs), mock mode, the skill / seed-library paths, JSON I/O, small ffmpeg / ffprobe wrappers.

Mock mode is on when env TL_MOCK=1 or film.json settings.mock is true. TL_MOCK=0 forces it off."""
import json, os, subprocess, sys, shutil, hashlib, time

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # <SKILL>/scripts
SKILL = os.path.dirname(SCRIPTS)                                               # <SKILL>


def ws_root(arg=None):
    """the run workspace: --ws, $TL_WS, else the nearest ancestor of cwd with film.json, else cwd.
    Temp files (say, whisper, rubberband) go to <ws>/.tl-tmp so nothing is written outside the workspace."""
    ws = _find_ws(arg)
    import tempfile
    t = os.path.join(ws, '.tl-tmp'); os.makedirs(t, exist_ok=True); tempfile.tempdir = t
    return ws


def _find_ws(arg=None):
    if arg: return os.path.abspath(arg)
    if os.environ.get('TL_WS'): return os.path.abspath(os.environ['TL_WS'])
    d = os.getcwd()
    while True:
        if os.path.exists(os.path.join(d, 'film.json')): return d
        p = os.path.dirname(d)
        if p == d: return os.getcwd()
        d = p


def film(ws):
    p = os.path.join(ws, 'film.json')
    if not os.path.exists(p): return {}
    with open(p) as f: return json.load(f)


def _truthy(v):
    return str(v).strip().lower() in ('1', 'true', 'yes', 'on')


def is_mock(ws=None):
    """mock mode: env TL_MOCK when set (on|1|true|yes = on, anything else = off), else film.json settings.mock (the truth after init;
    `tl.mjs mock on|off` changes it). The skill .env's TL_MOCK is only read by `tl.mjs init`."""
    e = os.environ.get('TL_MOCK')
    if e is not None and e != '': return _truthy(e)
    m = film(ws).get('settings', {}).get('mock') if ws else False
    return m is True or _truthy(m)


def skill_env(name):
    """a setting / key from the process env, else the installed skill's .env (Pneuma writes it from the init params). Never print it."""
    v = os.environ.get(name, '').strip()
    if v: return v
    p = os.path.join(SKILL, '.env')
    try:
        with open(p) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line: continue
                k, val = line.split('=', 1)
                if k.strip().removeprefix('export ').strip() == name: return val.strip().strip('"').strip("'")
    except OSError: pass
    return 


def setting(ws, key, default=None):
    return film(ws).get('settings', {}).get(key, default)


def seed_library():
    """the seed library (placeholder music cards, optional SFX samples): $TL_SEED_LIBRARY, else <SKILL>/seed-library (it ships inside the
    skill, so the copy Pneuma installs into a run workspace has it too)"""
    for p in (os.environ.get('TL_SEED_LIBRARY'), os.path.join(SKILL, 'seed-library')):
        if p and os.path.isdir(os.path.join(p, 'music')): return p
    raise SystemExit('seed library not found: set TL_SEED_LIBRARY (a folder with music/*.json cards)')


def rel(ws, p):
    try: return os.path.relpath(p, ws)
    except ValueError: return p


def P(ws, *parts):
    """absolute path inside the workspace (refuses to leave it)"""
    p = os.path.abspath(os.path.join(ws, *parts))
    if not (p == ws or p.startswith(ws.rstrip('/') + '/')): raise SystemExit(f'refusing to write outside the workspace: {p}')
    return p


def mkdirs(p):
    os.makedirs(p if not os.path.splitext(p)[1] else os.path.dirname(p), exist_ok=True); return p


def jread(p, default=None):
    if not os.path.exists(p):
        if default is not None: return default
        raise SystemExit(f'missing file: {p}')
    with open(p) as f: return json.load(f)


def jwrite(p, obj):
    """write JSON IN PLACE (serialised first, so a failure never leaves half a file). Not tmp + rename: Pneuma's watcher (chokidar)
    can report a rename-into-place as an unlink, and the canvas then derives its hashes without that file ("changed" where
    tl.mjs says "confirmed" until the page is reloaded — seen in the 2026-09-28 e2e run)."""
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, indent=1)
    with open(p, 'w') as f: f.write(text)
    return p


def disk_guard(path=None, what=''):
    """free space on the volume of `path`: warn under 5 GB, stop under 1.5 GB (env TL_DISK_WARN_GB / TL_DISK_MIN_GB override)"""
    p = path or os.getcwd()
    while p and not os.path.exists(p): p = os.path.dirname(p)
    free = shutil.disk_usage(p or '/').free / 1e9
    warn, stop = float(os.environ.get('TL_DISK_WARN_GB', 5)), float(os.environ.get('TL_DISK_MIN_GB', 1.5))
    if free < stop: raise SystemExit(f'DISK: only {free:.1f} GB free (< {stop} GB): stopping before {what or "writing"}. Free space (old renders, bundles) and re-run.')
    if free < warn: log(f'DISK: {free:.1f} GB free (< {warn} GB) — keep intermediates as flac/mp3 and clear old renders soon')
    return free


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def need(tool):
    if not shutil.which(tool): raise SystemExit(f'{tool} not found on PATH')
    return shutil.which(tool)


def run(cmd, **kw):
    kw.setdefault('check', True); kw.setdefault('capture_output', True)
    r = subprocess.run(cmd, **kw)
    return r


def ffprobe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,duration,sample_rate,channels:format=duration',
                        '-of', 'json', path], capture_output=True, text=True)
    if r.returncode: raise SystemExit(f'ffprobe failed on {path}: {r.stderr[:300]}')
    return json.loads(r.stdout)


def duration(path):
    return float(ffprobe(path)['format'].get('duration') or 0)


def count_frames(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path],
                       capture_output=True, text=True)
    try: return int(r.stdout.strip().split(',')[0])
    except ValueError: return None


def ebur128(path):
    """integrated LUFS, LRA and true peak (dBTP) of a media file's audio, measured by ffmpeg's ebur128 (the reference meter)"""
    r = subprocess.run(['ffmpeg', '-nostats', '-hide_banner', '-i', path, '-map', 'a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    tail = r[r.rfind('Summary:'):]
    def pick(key, unit):
        try: return float(tail.split(key)[1].split(unit)[0].strip())
        except (IndexError, ValueError): return None
    return dict(lufs=pick('I:', 'LUFS'), lra=pick('LRA:', 'LU'), tp=pick('Peak:', 'dBFS'))


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def now_iso():
    return time.strftime('%Y-%m-%dT%H:%M:%S%z')


def tl(ws, args):
    """run the stage-machine CLI (bun|node <SKILL>/scripts/tl.mjs …) in the workspace; None if tl.mjs isn't installed"""
    p = os.environ.get('TL_CLI') or os.path.join(SCRIPTS, 'tl.mjs')
    rt = shutil.which('bun') or shutil.which('node')
    if not (os.path.exists(p) and rt): return None
    return subprocess.run([rt, p] + list(args), cwd=ws, capture_output=True, text=True)


def register_options(ws, stage, options_file, do=True):
    """`tl.mjs options set <stage> --file <options.json>` (sets the stage's countdown); prints the command when not run"""
    cmd = ['options', 'set', stage, '--file', rel(ws, options_file)]
    if not do:
        log('register with: bun <SKILL>/scripts/tl.mjs ' + ' '.join(cmd)); return None
    r = tl(ws, cmd)
    if r is None: log('tl.mjs not installed: options not registered (' + ' '.join(cmd) + ')'); return None
    if r.returncode: log(f'tl.mjs options set failed: {(r.stderr or r.stdout)[:300]}')
    else: log(f'registered {stage} options')
    return r


def script_option(ws, opt=None):
    """the script option to work from: --script <file|id>, else film.json stages.script.pick, else the recommended / first option"""
    d = os.path.join(ws, 'stages', 'script', 'options')
    if opt and os.path.exists(opt): return jread(opt)
    if opt and os.path.exists(os.path.join(d, f'{opt}.json')): return jread(os.path.join(d, f'{opt}.json'))
    st = film(ws).get('stages', {}).get('script', {})
    pick = st.get('pick')
    if pick and os.path.exists(os.path.join(d, f'{pick}.json')): return jread(os.path.join(d, f'{pick}.json'))
    for o in st.get('options', []):
        if o.get('recommended'):
            for f in o.get('files', []):
                if os.path.exists(os.path.join(ws, f)): return jread(os.path.join(ws, f))
    if os.path.isdir(d):
        fs = sorted(f for f in os.listdir(d) if f.endswith('.json'))
        if fs: return jread(os.path.join(d, fs[0]))
    raise SystemExit('no script option found (stages/script/options/*.json); pass --script')


def languages(ws, arg=None):
    """voice languages to work on: --lang ja,en | all, else the brief's languages (en-jasub uses the EN voice)"""
    if arg and arg != 'all': return [x for x in arg.split(',') if x]
    langs = film(ws).get('run', {}).get('brief', {}).get('languages') or ['ja', 'en']
    out = []
    for l in langs:
        v = 'en' if l.startswith('en') else ('ja' if l.startswith('ja') else l)
        if v not in out: out.append(v)
    return out


def brand(ws=None):
    """the run's brand rule, or {} for none: film.json run.brief.brand, else common/style.json "brand" (an editable preset).
      display  the on-screen form ("ACME"); every whole-word spelling in `match` (case-insensitive) is shown this way
      match    other spellings to normalise (["Acme"])
      spoken   {en, ja}: what the TTS reads (default: the display form; JA usually a katakana reading)
      heard    {en: [...], ja: [...]}: how speech-to-text may write it (the read check accepts these as "brand heard")"""
    b = None
    try: b = film(ws or _find_ws()).get('run', {}).get('brief', {}).get('brand')
    except (OSError, ValueError): b = None
    if not b:
        try:
            with open(os.path.join(SCRIPTS, 'common', 'style.json'), encoding='utf-8') as f: b = json.load(f).get('brand')
        except (OSError, ValueError): b = None
    d = str((b or {}).get('display') or '').strip()
    if not d: return {}
    sp = b.get('spoken') or {}; hd = b.get('heard') or {}
    match = [d] + [m for m in (b.get('match') or []) if m and m != d]
    spoken = {'en': sp.get('en') or d, 'ja': sp.get('ja') or d}
    heard = {l: [x.lower().replace(' ', '') for x in [spoken[l], d] + list(hd.get(l) or [])] for l in ('en', 'ja')}
    return dict(display=d, match=match, spoken=spoken, heard=heard)


def brand_re(b):
    """a regex for every spelling of the brand (whole word; not inside a domain or a file name)"""
    import re
    words = sorted({w for w in b['match']}, key=len, reverse=True)
    # ASCII word edges (Python's \w also matches CJK, and a brand is often followed directly by kana: 「ACMEで」)
    return re.compile(r'(?<![A-Za-z0-9_.-])(?:' + '|'.join(re.escape(w) for w in words) + r')(?![A-Za-z0-9_-]|\.[A-Za-z0-9])', re.I)


def pronunciation(lang, ws=None):
    """the run's pronunciation dictionary for one language: {written form: what the TTS reads}. Keyed by language, because the
    same word can be read differently in each (a brand read "Akme" in EN and アクメ in JA). From film.json run.brief.pronunciation,
    else the `pronunciation` preset in common/style.json; brand.spoken[lang] is its first entry for the brand's spellings."""
    d = None
    try: d = film(ws or _find_ws()).get('run', {}).get('brief', {}).get('pronunciation')
    except (OSError, ValueError): d = None
    if not d:
        try:
            with open(os.path.join(SCRIPTS, 'common', 'style.json'), encoding='utf-8') as f: d = json.load(f).get('pronunciation')
        except (OSError, ValueError): d = None
    lang = 'ja' if str(lang).startswith('ja') else 'en' if str(lang).startswith('en') else str(lang)
    return {k: v for k, v in ((d or {}).get(lang) or {}).items() if isinstance(k, str) and k and isinstance(v, str) and not k.startswith('_')}


def tts_text(text, lang, spell=None):
    """what the TTS reads: the brand is written in its display form on screen but read as brand.spoken[lang] (or --spell), and
    every entry of the language's pronunciation dictionary is replaced by its reading (whole words for Latin script)"""
    if not text: return text
    import re
    b = brand()
    if b: text = brand_re(b).sub(spell or b['spoken']['ja' if lang == 'ja' else 'en'], text)
    for word, reading in sorted(pronunciation(lang).items(), key=lambda kv: -len(kv[0])):
        pat = re.escape(word)
        if re.match(r'^[A-Za-z0-9]', word): pat = r'(?<![A-Za-z0-9_-])' + pat + r'(?![A-Za-z0-9_-])'
        text = re.sub(pat, lambda _m, r=reading: r, text)
    return text


# ── The naming rule (one rule for every script, render.mjs and the viewer) ─────────────────────────────────────────────────
# A version is `<format>-<lang>`: format = <edition>-<aspect> (short-16x9, short-9x16, full-16x9), lang = ja | en | en-jasub.
#   out/picture/<key>.mp4 (+ .json sidecar: scale, sizes, frames)   the VO-only master (remotion/render.mjs)
#   out/roughcut/<key>.mp4 · out/final/<key>.mp4                    the mixes (mix/mix.py)
#   out/qc/<roughcut|final>-<key>.json                              the QC record the canvas shows (qc/qc.py check|all)
#   timelines/<key>.json                                            the version's clock (render.mjs; music + SFX tracks from mix.py)
# The render scale is never part of a name (a legacy `-s0.5` suffix is still parsed).
import re as _re
VERSION_RE = _re.compile(r'^(?P<format>(?:short|full)-(?:16x9|9x16))-(?P<lang>en-jasub|ja|en)(?:-s(?P<scale>[0-9.]+))?$')


def version_key(fmt, lang):
    return f'{fmt}-{lang}'


def parse_version(name):
    """'out/roughcut/short-16x9-en-jasub.mp4' | 'short-9x16-ja' -> {format, lang, key, scale|None}, or None"""
    stem = os.path.basename(str(name))
    stem = stem[:-4] if stem.lower().endswith(('.mp4', '.mov', '.m4a', '.wav', '.json')) else stem
    m = VERSION_RE.match(stem)
    if not m: return None
    return dict(format=m['format'], lang=m['lang'], key=version_key(m['format'], m['lang']), scale=float(m['scale']) if m['scale'] else None)


def voice_lang(lang):
    """the VO language of a version language: en-jasub is heard in English"""
    return 'en' if str(lang).startswith('en') else str(lang)


def versions(ws):
    """[(format, lang)] of the brief, lead first (first format x each language, then the next format)"""
    b = film(ws).get('run', {}).get('brief', {})
    return [(f, l) for f in (b.get('formats') or ['short-16x9']) for l in (b.get('languages') or ['ja', 'en'])]


def picture_meta(ws, key):
    """the render sidecar out/picture/<key>.json ({scale, width, height, compWidth, compHeight, frames, fps, …}) or {}"""
    p = os.path.join(ws, 'out', 'picture', f'{key}.json')
    try:
        with open(p) as f: return json.load(f)
    except (OSError, ValueError): return {}


def display_text(text):
    """on-screen / caption text: the brand always in its display form (no-op when the run has no brand rule)"""
    if not text: return text
    b = brand()
    return brand_re(b).sub(b['display'], text) if b else text
