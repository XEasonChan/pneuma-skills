#!/usr/bin/env python3
"""Stage 5 · read check (free, local): whisper.cpp large-v3 on every raw take -> <take>.scribe.json (ElevenLabs-Scribe shape:
text, words[{text,start,end,type,characters}]) + stages/vo/readcheck.json (per take: ok, similarity, brand heard, note).

  scripts/py vo/readcheck.py [--ws DIR] [--lang ja,en|all] [--model large-v3|small|<path>] [--force]

Replaces the paid Scribe. Model: --model, else $WHISPER_MODEL, else $TL_WHISPER_MODEL, else ggml-large-v3.bin in
~/.cache/hyperframes/whisper/models (macOS) or /data/models (the hosted container, Linux) — see common/host.py
(whisper-cli from $TL_WHISPER_CLI or PATH). All takes of a language go through ONE whisper-cli run (the model loads once).
GOTCHA: whisper's JA timings are spread evenly over each token, so they're fine for captions but NOT for placing pauses —
vo/post.py sets JA pauses on the measured gaps. A take fails when the brand (W.brand(): its spoken / heard forms) isn't heard, a --names
entry is missing, or the transcript is too far from the text (JA char similarity < 0.45, EN word similarity < 0.7).
Without whisper / the model every take is marked unchecked (ok=null) with estimated word times, readcheck.json records
`available: false` + the reason, the picker says so, and QC shows a "read check unavailable" row."""
import argparse, difflib, glob, json, os, re, shutil, subprocess, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, audio as A, host as H

SKIP = re.compile(r'[\s、。，．「」『』！？!?,.・…:;"\'()（）\[\]-]')


def model_path(arg):
    return H.whisper_model(arg)[0]


UNAVAILABLE = []      # why the read check could not run (recorded in readcheck.json, shown as a QC row)


def whisper(wavs, lang, model):
    cli = H.whisper_cli()
    if not cli: UNAVAILABLE.append('whisper-cli not found (PATH / $TL_WHISPER_CLI)'); return None
    cmd = [cli, '-m', model, '-l', lang, '-ml', '1', '-oj', '-np']
    for w in wavs: cmd += ['-f', w]
    # whisper.cpp can cut a multi-byte (JA) character between two tokens, so its stdout / JSON are not always valid UTF-8: decode
    # tolerantly (a U+FFFD costs a little similarity, never the run). Any failure means "read check unavailable", not a crash.
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1800)
    except (OSError, subprocess.TimeoutExpired) as e:
        W.log(f'whisper-cli did not run: {e}'); UNAVAILABLE.append(f'whisper-cli did not run ({type(e).__name__})'); return None
    if r.returncode: W.log(f'whisper-cli failed: {r.stderr[-400:]}'); UNAVAILABLE.append(f'whisper-cli failed (exit {r.returncode})'); return None
    out = {}
    for w in wavs:
        j = w + '.json'
        if os.path.exists(j):
            with open(j, 'rb') as f: out[w] = json.loads(f.read().decode('utf-8', 'replace'))['transcription']
    return out


def scribe_words(segs, lang):
    words = []
    for s in segs:
        t = s['text']; a = s['offsets']['from'] / 1000; b = s['offsets']['to'] / 1000
        if not t.strip() or t.strip().startswith('['): continue
        if lang == 'ja':
            cs = [c for c in t if not c.isspace()]
            for k, c in enumerate(cs):
                ca = a + (b - a) * k / len(cs); cb = a + (b - a) * (k + 1) / len(cs)
                words.append(dict(text=c, start=round(ca, 3), end=round(cb, 3), type='word', characters=[dict(text=c, start=round(ca, 3), end=round(cb, 3))]))
        else:
            if words and not t.startswith(' '):
                words[-1]['text'] += t.strip(); words[-1]['end'] = round(b, 3); continue
            if words: words.append(dict(text=' ', start=words[-1]['end'], end=round(a, 3), type='spacing'))
            words.append(dict(text=t.strip(), start=round(a, 3), end=round(b, 3), type='word'))
    return words


def estimate_words(path, text, lang):
    """no whisper: words / chars spread evenly over the measured speech span (clearly marked as an estimate)"""
    x = A.load(path, mono=True); e = A.todb(abs(x) + 1e-9)
    on = [i for i in range(0, len(x), 480) if e[i:i + 480].max() > e.max() - 40]
    a, b = (on[0] / A.SR, (on[-1] + 480) / A.SR) if on else (0, len(x) / A.SR)
    toks = [c for c in text if not SKIP.match(c)] if lang == 'ja' else text.split()
    words = []
    for k, tk in enumerate(toks):
        ta = a + (b - a) * k / len(toks); tb = a + (b - a) * (k + 1) / len(toks)
        words.append(dict(text=tk, start=round(ta, 3), end=round(tb, 3), type='word'))
    return words


def norm_en(s): return [re.sub(r"[^a-z0-9']", '', w) for w in s.lower().replace('’', "'").split() if re.sub(r"[^a-z0-9']", '', w)]


def check(expected, heard, lang, names):
    if lang == 'ja':
        e = SKIP.sub('', expected); h = SKIP.sub('', heard)
        sim = difflib.SequenceMatcher(None, e, h, autojunk=False).ratio(); thr = 0.45
    else:
        e, h = norm_en(expected), norm_en(heard)
        sim = difflib.SequenceMatcher(None, e, h, autojunk=False).ratio(); thr = 0.7
    notes = []
    br = W.brand()
    if br and (W.brand_re(br).search(expected) or br['spoken'][lang] in expected) and not any(b in heard.lower().replace(' ', '') for b in br['heard'][lang]):
        notes.append('brand not heard')
    for n in names:
        if n in expected and n.lower() not in heard.lower(): notes.append(f'{n} not heard')
    if sim < thr: notes.append(f'far from the text (similarity {sim:.2f} < {thr})')
    return (not notes), round(sim, 3), '; '.join(notes) or None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--lang'); ap.add_argument('--model'); ap.add_argument('--force', action='store_true')
    ap.add_argument('--names', default='', help='comma list of names that must be heard (e.g. Ethan)')
    a = ap.parse_args()
    ws = W.ws_root(a.ws); tk = W.jread(W.P(ws, 'stages', 'vo', 'takes.json'))
    model, looked = H.whisper_model(a.model); names = [n for n in a.names.split(',') if n]
    if not model:
        UNAVAILABLE.append(f'no whisper model at {looked}')
        W.log(f'read check unavailable: no whisper model at {looked} (set WHISPER_MODEL or --model); takes are marked unchecked')
    rc_path = W.P(ws, 'stages', 'vo', 'readcheck.json'); prev = {(r['id'], r['lang'], r['take']): r for r in W.jread(rc_path, {'takes': []})['takes']}
    langs = W.languages(ws, a.lang)
    results = [r for k, r in prev.items() if r['lang'] not in langs]      # --lang en keeps the JA rows (and vice versa)
    for lang in langs:
        todo = []
        for ln in [l for l in tk['lines'] if l['lang'] == lang]:
            for t in ln['takes']:
                p = os.path.join(ws, t['file']); sj = p[:-4] + '.scribe.json'
                todo.append((ln, t, p, sj))
        need = [x for x in todo if a.force or not os.path.exists(x[3])]
        segs = {}
        if need and model:
            d = tempfile.mkdtemp(prefix='tl-whisper-'); wavs = []
            for i, (ln, t, p, sj) in enumerate(need):
                w = os.path.join(d, f'{i:03d}.wav'); subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', p, '-ar', '16000', '-ac', '1', w], check=True); wavs.append(w)
            W.log(f'{lang}: whisper {os.path.basename(model)} on {len(wavs)} takes')
            got = whisper(wavs, lang, model) or {}
            for w, (ln, t, p, sj) in zip(wavs, need): segs[sj] = got.get(w)
            shutil.rmtree(d, ignore_errors=True)
        for ln, t, p, sj in todo:
            if sj in segs:
                if segs[sj] is None:
                    words = estimate_words(p, ln['tts'], lang); src = 'estimate (whisper unavailable)'
                else:
                    words = scribe_words(segs[sj], lang); src = f'whisper.cpp {os.path.basename(model)} (local)'
                W.jwrite(sj, dict(language_code=lang, text=''.join(w['text'] for w in words), words=words, source=src))
            elif not os.path.exists(sj):
                words = estimate_words(p, ln['tts'], lang)
                W.jwrite(sj, dict(language_code=lang, text=''.join(w['text'] if lang == 'ja' else w['text'] + ' ' for w in words).strip(), words=words, source='estimate (no whisper model)'))
            s = W.jread(sj)
            if s['source'].startswith('estimate'): ok, sim, note = None, None, 'unchecked: no local whisper'
            else: ok, sim, note = check(re.sub(r'^\[[^\]]*\]\s*', '', ln['tts']), s['text'], lang, names)
            r = dict(id=ln['id'], lang=lang, take=t['take'], file=t['file'], scribe=W.rel(ws, sj), ok=ok, similarity=sim, note=note, transcript=s['text'][:300])
            results.append(r)
            print(f"{lang} {ln['id']:10s} t{t['take']} {'OK ' if ok else ('?? ' if ok is None else 'BAD')} sim {sim} {note or ''} | {s['text'][:80]}")
    checked = any(r.get('ok') is not None for r in results)
    why = '; '.join(dict.fromkeys(UNAVAILABLE)) or (None if checked else 'no take was transcribed')
    if not checked and results: W.log(f'read check unavailable: {why}')
    W.jwrite(rc_path, dict(model=model and os.path.basename(model), available=checked, unavailable=None if checked else why, takes=results))


if __name__ == '__main__': main()
