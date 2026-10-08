#!/usr/bin/env python3
"""Stage 5 · VO takes: every scene's VO line x language x N takes (default 2) -> stages/vo/raw/<lang>/<lineId>.t<n>.mp3 + stages/vo/takes.json

  scripts/py vo/generate.py [--ws DIR] [--script A|file] [--lang ja,en|all] [--takes 2] [--only S1,S2] [--voice-ja ID|file] [--voice-en ID|file]
                            [--spell en=Akme] [--force]

Lines come from the script option (scenes[].vo.<lang>; line id = scene.voId or scene.id). The voice per language: --voice-<lang>
(pool id, voice id or a stages/voice/options/*.json), else the voice stage's pick, else its recommended option, else the pool
default. TTS text: the brand is read as brand.spoken (W.brand(); display text keeps its display form); JA gets '[speaking slowly and gently]'
(eleven_v3 ignores `speed`, so the tag is the only slow-down). Existing takes are kept unless --force (never regenerate blindly).
Paid: ElevenLabs TTS eleven_v3, one ledger reserve per take (chars x $0.30/1k), request id recorded. Mock: macOS `say`
(the voice option's stand-in; take 2 a little faster so the picker has a real choice).
A line whose TTS text changed gets new take numbers after its existing ones; old files stay (never overwritten unless --force)."""
import argparse, glob, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, paid, mock, audio as A

POOL = json.load(open(os.path.join(W.SCRIPTS, 'common', 'voices.json')))


def resolve_voice(ws, lang, override=None):
    pool = POOL['pool'][lang] + POOL.get('retired', {}).get(lang, [])      # lookups also find retired voices (an old run's pick); the default is pool[0]
    def from_pool(v): return dict(lang=lang, voiceId=v['voiceId'], name=v['name'], settings=POOL['settings'][lang], mockVoice=v.get('mock'), spell=v.get('spell'), source='pool:' + v['id'])
    if override:
        if os.path.exists(override): o = W.jread(override); return dict(o, source=override)
        for v in pool:
            if override in (v['id'], v['voiceId']): return from_pool(v)
        return dict(lang=lang, voiceId=override, name=override, settings=POOL['settings'][lang], mockVoice=None, source='cli')
    d = W.P(ws, 'stages', 'voice', 'options'); st = W.film(ws).get('stages', {}).get('voice', {})
    picks = st.get('picks') if isinstance(st.get('picks'), dict) else {}
    cands = [picks.get(lang)] if picks.get(lang) else []
    if isinstance(st.get('pick'), str): cands += [p for p in st['pick'].split(',') if p.startswith(lang + '-')]
    for o in st.get('options', []):
        if o.get('recommended') and str(o.get('id', '')).startswith(lang + '-'): cands.append(o['id'])
    oj = os.path.join(W.P(ws, 'stages', 'voice'), 'options.json')
    if os.path.exists(oj): cands += [o['id'] for o in W.jread(oj) if o.get('recommended') and o.get('lang') == lang]
    for c in cands:
        f = os.path.join(d, f'{c}.json')
        if os.path.exists(f):
            o = W.jread(f); pv = next((v for v in pool if v['voiceId'] == o['voiceId']), {})
            return dict(o, mockVoice=o.get('mockVoice') or pv.get('mock'), spell=pv.get('spell'), source=W.rel(ws, f))
    return from_pool(pool[0])


def lines_of(sc, lang):
    out = []
    for s in sc.get('scenes', []):
        t = (s.get('vo') or {}).get(lang)
        if t: out.append(dict(id=s.get('voId') or s['id'], sceneId=s['id'], lang=lang, text=W.display_text(t)))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--script'); ap.add_argument('--lang'); ap.add_argument('--takes', type=int, default=2)
    ap.add_argument('--only'); ap.add_argument('--voice-ja'); ap.add_argument('--voice-en'); ap.add_argument('--force', action='store_true')
    ap.add_argument('--spell', action='append', default=[], metavar='LANG=TEXT',
                    help="the brand's TTS spelling for a language when a voice misreads it (launch-vo: 'spell it for TTS', e.g. en=Akme); "
                         "with --only it applies to those lines; a changed spelling gets new take numbers, old takes stay")
    a = ap.parse_args()
    spell = {}
    for kv in a.spell:
        if '=' not in kv: raise SystemExit(f'--spell wants LANG=TEXT, got {kv!r}')
        k, v = kv.split('=', 1); spell[k.strip()] = v.strip()
    ws = W.ws_root(a.ws); sc = W.script_option(ws, a.script); pd = paid.Paid(ws, 'vo'); W.disk_guard(ws, 'VO takes')
    tj = W.P(ws, 'stages', 'vo', 'takes.json'); prev = W.jread(tj, {'lines': []})
    keep = {(l['id'], l['lang']): l for l in prev.get('lines', [])}
    only = set(a.only.split(',')) if a.only else None
    total_chars = 0; made = 0
    for lang in W.languages(ws, a.lang):
        v = resolve_voice(ws, lang, a.voice_ja if lang == 'ja' else a.voice_en)
        if spell.get(lang): v = dict(v, spell=spell[lang])
        W.log(f'{lang}: voice {v["name"]} ({v["voiceId"]}) from {v["source"]}')
        for ln in lines_of(sc, lang):
            if only and ln['id'] not in only and ln['sceneId'] not in only: continue
            tts = POOL['prefix_tag'].get(lang, '') + W.tts_text(ln['text'], lang, v.get('spell'))
            rec = dict(ln, tts=tts, voiceId=v['voiceId'], voice=v['name'], takes=[])
            old = keep.get((ln['id'], lang))
            # a changed text / spelling gets NEW take numbers after the existing ones (launch-vo: never overwrite a take);
            # --force regenerates in place
            same = bool(old) and old.get('tts') == tts
            existing = sorted(int(os.path.basename(f).rsplit('.t', 1)[1].split('.')[0]) for f in glob.glob(W.P(ws, 'stages', 'vo', 'raw', lang, f"{ln['id']}.t*.mp3"))
                              if os.path.basename(f).rsplit('.t', 1)[1].split('.')[0].isdigit())
            base = 0 if (same or a.force or not existing) else max(existing)
            if base: W.log(f"{lang} {ln['id']}: text changed — new takes t{base + 1}..t{base + a.takes} (old takes kept on disk)")
            for n in range(base + 1, base + a.takes + 1):
                out = W.P(ws, 'stages', 'vo', 'raw', lang, f"{ln['id']}.t{n}.mp3")
                if os.path.exists(out) and not a.force and same:
                    rec['takes'].append(next((t for t in old['takes'] if t['take'] == n), dict(take=n, file=W.rel(ws, out)))); continue
                W.mkdirs(out)
                for stale in (out[:-4] + '.scribe.json',):          # a re-made take must be read-checked again
                    if os.path.exists(stale): os.remove(stale)
                if pd.mock:
                    used = mock.say(W.tts_text(ln['text'], lang, v.get('spell')), out, lang, v.get('mockVoice'), rate=None if n % 2 == 1 else (185 if lang == 'en' else 200))
                    pd.mock_record(f"vo take {lang} {ln['id']} t{n} (say {used})"); rid = 'mock'
                else:
                    with pd.call('elevenlabs', f"tts {lang} {ln['id']} t{n} ({len(tts)} chars)", paid.est_tts(len(tts))) as c:
                        import el
                        r = el.tts(v['voiceId'], tts, out, v['settings'], lang=lang)
                        c['request_id'] = r['request_id']
                        if r.get('character_cost'): c['usd'] = paid.est_tts(float(r['character_cost']))
                    rid = c['request_id']
                d = W.duration(out)
                if d < 0.3: raise SystemExit(f'{out}: take is empty ({d:.2f} s)')
                x = A.load(out, mono=True)
                if A.todb(abs(x).max()) < -45: raise SystemExit(f'{out}: take is silent')
                rec['takes'].append(dict(take=n, file=W.rel(ws, out), durS=round(d, 3), requestId=rid)); made += 1; total_chars += len(tts)
            keep[(ln['id'], lang)] = rec
    lines = sorted(keep.values(), key=lambda l: (l['lang'], l['id']))
    W.jwrite(tj, dict(script=sc.get('id'), mock=pd.mock, lines=lines))
    print(json.dumps(dict(takes_made=made, chars=total_chars, lines=len(lines), file=W.rel(ws, tj), mock=pd.mock)))


if __name__ == '__main__': main()
