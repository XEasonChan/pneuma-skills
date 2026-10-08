"""The budget gate for every paid call (contracts §3-§4). A thin client over the stage-machine CLI:

    bun|node <SKILL>/scripts/tl.mjs ledger reserve --stage <s> --provider <p> --what "<desc>" --usd <estimate>   (exit 3 = over the cap)
    bun|node <SKILL>/scripts/tl.mjs ledger commit <id> --usd <actual> [--request-id <rid>] [--status done|failed]

Rules it enforces:
  * reserve BEFORE the request, commit after it (actual cost + the provider's request id); a failure commits status=failed;
  * over the cap -> BudgetExceeded (exit code 3): the run stops and asks the producer, even during auto-run;
  * no tl.mjs -> a real paid call is refused (mock mode appends the 0-USD mock record to ledger.jsonl itself);
  * mock mode (TL_MOCK=1 or film.json settings.mock) never touches a provider: callers write a stand-in and call mock();
  * TL_NO_NETWORK=1 (the selftest sets it) makes any attempted provider call a hard error;
  * keys only from env (ELEVENLABS_API_KEY, FAL_KEY, OPENROUTER_API_KEY) and never printed.
Prices: common/prices.json (estimate helpers below)."""
import json, os, re, shutil, subprocess, sys, time, uuid, contextlib, math, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ws as W

PRICES = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prices.json')))
KEYS = {'elevenlabs': 'ELEVENLABS_API_KEY', 'fal': 'FAL_KEY', 'openrouter': 'OPENROUTER_API_KEY', 'figma': 'FIGMA_TOKEN'}


class BudgetExceeded(SystemExit):
    def __init__(self, msg):
        print(f'BUDGET: {msg}\nThe run is over its paid-call cap. Stop and ask the producer (raise settings.budgetUsd or skip this call).', file=sys.stderr)
        super().__init__(3)


# ------------------------------------------------------------------ estimates (USD)
def est_tts(chars): return max(PRICES['elevenlabs']['min_charge_usd'], chars / 1000 * PRICES['elevenlabs']['tts_usd_per_1k_chars'])
def est_music(seconds): return max(PRICES['elevenlabs']['min_charge_usd'], seconds / 60 * PRICES['elevenlabs']['music_usd_per_min'])
def est_v2m(seconds): return max(PRICES['elevenlabs']['min_charge_usd'], seconds / 60 * PRICES['elevenlabs']['v2m_usd_per_min'])
def est_sfx(n=1): return n * PRICES['elevenlabs']['sfx_usd_per_call']
def est_seedance(width, height, seconds, resolution='720p', ref_videos=0):
    rate = PRICES['fal']['seedance_2_5_usd_per_1k_tokens'].get(resolution, 0.0234)
    tokens = width * height * seconds * 24 / 1024
    return round(tokens / 1000 * rate * (0.6 if ref_videos else 1.0), 4)
def est_image(quality='high', provider='openrouter', n=1):
    if provider == 'codex': return PRICES['codex']['image_usd_per_call'] * n
    return PRICES['openrouter']['gpt_image_usd_per_image'].get(quality, 0.25) * n


# ------------------------------------------------------------------ the tl.mjs client
def _tl():
    p = os.environ.get('TL_CLI') or os.path.join(W.SCRIPTS, 'tl.mjs')
    if not os.path.exists(p): return None
    rt = shutil.which('bun') or shutil.which('node')
    return [rt, p] if rt else None


def key(provider):
    """the provider's key from env (never printed); SystemExit if missing"""
    name = KEYS[provider]; v = W.skill_env(name)
    if not v: raise SystemExit(f'{name} is not set (Pneuma init params -> env). Not calling {provider}.')
    return v


def guard_network(provider):
    if os.environ.get('TL_NO_NETWORK') == '1':
        raise SystemExit(f'TL_NO_NETWORK=1: refusing a real {provider} call (selftest / dry environment)')


class Paid:
    def __init__(self, ws, stage):
        self.ws, self.stage = ws, stage
        self.mock = W.is_mock(ws)

    _lock = threading.Lock()                                          # ledger calls are serialised (threads share one ledger)

    def _cli(self, args):
        tl = _tl()
        if not tl: return None
        with Paid._lock:
            return subprocess.run(tl + args, cwd=self.ws, capture_output=True, text=True)

    def reserve(self, provider, what, usd):
        """reserve `usd` for one call; returns the ledger id. Raises BudgetExceeded (exit 3) over the cap."""
        usd = round(float(usd), 4)
        r = self._cli(['ledger', 'reserve', '--stage', self.stage, '--provider', provider, '--what', what[:200], '--usd', f'{usd:.4f}'])
        if r is None:
            if provider == 'mock' or self.mock:
                return self._fallback_append(dict(provider='mock', what=what, estimateUsd=0.0, actualUsd=0.0, status='done'))
            raise SystemExit('ledger unavailable (scripts/tl.mjs not found): refusing a paid call without the budget gate')
        if r.returncode == 3: raise BudgetExceeded((r.stdout + r.stderr).strip()[:400] or f'{what} (${usd:.2f})')
        if r.returncode != 0: raise SystemExit(f'tl.mjs ledger reserve failed ({r.returncode}): {(r.stderr or r.stdout)[:400]}')
        return _parse_id(r.stdout)

    def commit(self, rid, usd, request_id=None, status='done'):
        if rid is None or str(rid).startswith('local-'): return
        args = ['ledger', 'commit', str(rid), '--usd', f'{float(usd):.4f}', '--status', status]
        if request_id: args += ['--request-id', str(request_id)]
        r = self._cli(args)
        if r is not None and r.returncode != 0: W.log(f'warning: ledger commit failed: {(r.stderr or r.stdout)[:300]}')

    def mock_record(self, what):
        """contracts §4: mock calls are recorded with provider 'mock' and 0 USD"""
        rid = self.reserve('mock', what, 0.0)
        self.commit(rid, 0.0, request_id='mock', status='done')
        return rid

    @contextlib.contextmanager
    def call(self, provider, what, est_usd):
        """with paid.call('elevenlabs', 'tts ja B1 t1', est) as rec:  ...do the request...; rec['usd']=actual; rec['request_id']=rid
        mock mode must not enter here (callers branch on paid.mock first)."""
        if self.mock: raise SystemExit('internal: Paid.call() used in mock mode')
        guard_network(provider)
        if provider in KEYS: key(provider)                            # a missing key fails BEFORE anything is reserved
        rid = self.reserve(provider, what, est_usd)
        rec = dict(usd=est_usd, request_id=None, ledger_id=rid)
        try:
            yield rec
        except BaseException as e:
            charged = rec.get('charged_on_failure', not isinstance(e, ProviderHTTPError) or e.code >= 500)
            self.commit(rid, est_usd if charged else 0.0, rec.get('request_id'), 'failed')
            raise
        self.commit(rid, rec.get('usd', est_usd), rec.get('request_id'), 'done')

    def _fallback_append(self, rec):
        rid = 'local-' + uuid.uuid4().hex[:10]
        line = dict(id=rid, ts=W.now_iso(), stage=self.stage, requestId=None, via='paid.py (tl.mjs absent; mock only)', **rec)
        with open(os.path.join(self.ws, 'ledger.jsonl'), 'a') as f: f.write(json.dumps(line, ensure_ascii=False) + '\n')
        return rid


class ProviderHTTPError(RuntimeError):
    def __init__(self, code, msg):
        super().__init__(f'HTTP {code}: {msg}'); self.code = code


def _parse_id(out):
    out = (out or '').strip()
    try:
        j = json.loads(out.splitlines()[-1] if out else '{}')
        if isinstance(j, dict) and j.get('id'): return j['id']
    except (ValueError, IndexError): pass
    m = re.search(r'"id"\s*:\s*"([^"]+)"', out) or re.search(r'\bid[=: ]+([A-Za-z0-9_.:-]+)', out)
    if m: return m.group(1)
    if out and ' ' not in out: return out
    raise SystemExit(f'could not read the ledger id from tl.mjs output: {out[:200]}')


# ------------------------------------------------------------------ HTTP (stdlib) for ElevenLabs
def http(method, url, headers, body=None, timeout=900):
    """-> (status, headers(lowercase), bytes); raises ProviderHTTPError on >= 400 (message trimmed, never echoes headers)"""
    import urllib.request, urllib.error
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as f:
            return f.status, {k.lower(): v for k, v in f.headers.items()}, f.read()
    except urllib.error.HTTPError as e:
        raise ProviderHTTPError(e.code, e.read().decode('utf-8', 'replace')[:500])


def multipart(fields, files):
    """fields: [(name, str)], files: [(name, path, content_type)] -> (body, content_type)"""
    bnd = uuid.uuid4().hex; parts = []
    for k, v in fields:
        parts.append(f'--{bnd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for k, path, ct in files:
        with open(path, 'rb') as f: data = f.read()
        parts.append(f'--{bnd}\r\nContent-Disposition: form-data; name="{k}"; filename="{os.path.basename(path)}"\r\nContent-Type: {ct}\r\n\r\n'.encode() + data + b'\r\n')
    parts.append(f'--{bnd}--\r\n'.encode())
    return b''.join(parts), f'multipart/form-data; boundary={bnd}'


def el_request_id(h):
    return h.get('request-id') or h.get('x-request-id') or h.get('song-id') or h.get('x-trace-id')


class Slots:
    """cross-process concurrency cap (ElevenLabs music allows 2 concurrent requests per account; a 3rd returns 429):
    lock files in <ws>/.tl-locks/<name>.<k>"""
    def __init__(self, ws, name, n=2):
        self.d = os.path.join(ws, '.tl-locks'); self.name, self.n = name, n; os.makedirs(self.d, exist_ok=True); self.held = None

    def __enter__(self):
        while True:
            for k in range(self.n):
                p = os.path.join(self.d, f'{self.name}.{k}')
                try:
                    fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY); os.write(fd, str(os.getpid()).encode()); os.close(fd)
                    self.held = p; return self
                except FileExistsError:
                    try:
                        if time.time() - os.path.getmtime(p) > 1800: os.remove(p)       # stale (> 30 min)
                    except OSError: pass
            time.sleep(1.0)

    def __exit__(self, *a):
        if self.held and os.path.exists(self.held): os.remove(self.held)
