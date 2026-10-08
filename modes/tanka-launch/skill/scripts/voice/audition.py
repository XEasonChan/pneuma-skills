#!/usr/bin/env python3
"""Stage 4 · voice audition: 3-4 voices x one sample line per language -> stages/voice/options/<lang>-<id>.json + .mp3.

  scripts/py voice/audition.py [--ws DIR] [--lang ja,en|all] [--n 3] [--voices ttv1,tatsuki] [--include-retired] [--line-ja TEXT] [--line-en TEXT] [--register]

Voices: common/voices.json (the pool = launch-vo.md's current voices; the first per language is the locked voice, recommended).
Voices launch-vo.md lists as superseded (Sarah, Konoha) sit in voices.json `retired` and are auditioned only with --include-retired
(named in --voices or not: without the flag a retired id is skipped with a note). Model eleven_v3 with the pool's settings (JA gets the
'[speaking slowly and gently]' tag). The sample line is --line-<lang>, else the script's longest VO line of <= 90 characters, else
the pool's default. Each sample is normalised to -16 LUFS so the voices compare fairly.
Paid: ElevenLabs TTS, one ledger reserve per voice (chars x $0.30/1k). Mock: macOS `say` with each pool voice's stand-in.
Writes stages/voice/options.json (the options array for `tl.mjs options set voice`); --register runs that command."""
import argparse, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W, paid, mock, audio as A

POOL = json.load(open(os.path.join(W.SCRIPTS, 'common', 'voices.json')))


def sample_line(ws, lang, override):
    if override: return override
    try:
        sc = W.script_option(ws)
        lines = [s.get('vo', {}).get(lang) for s in sc.get('scenes', []) if s.get('vo', {}).get(lang)]
        ok = [l for l in lines if len(l) <= 90]
        if ok: return max(ok, key=len)
    except SystemExit: pass
    return POOL['sample_line'][lang]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--lang'); ap.add_argument('--n', type=int, default=3)
    ap.add_argument('--voices', help='comma list of pool ids (default: the first --n per language)')
    ap.add_argument('--include-retired', action='store_true', help='also offer the superseded voices (voices.json retired)')
    ap.add_argument('--line-ja'); ap.add_argument('--line-en'); ap.add_argument('--register', action='store_true')
    a = ap.parse_args()
    ws = W.ws_root(a.ws); pd = paid.Paid(ws, 'voice'); outd = W.mkdirs(W.P(ws, 'stages', 'voice', 'options') + '/')
    options = []
    for lang in W.languages(ws, a.lang):
        cur = POOL['pool'].get(lang, []); retired = POOL.get('retired', {}).get(lang, [])
        want = [x for x in (a.voices or '').split(',') if x]
        for v in retired:
            if v['id'] in want and not a.include_retired: W.log(f"{lang}: {v['id']} is retired ({v.get('why')}); pass --include-retired to audition it")
        if a.voices: pool = [v for v in cur + (retired if a.include_retired else []) if v['id'] in want] or cur
        else: pool = cur[:max(1, a.n)] + (retired if a.include_retired else [])
        rec_id = cur[0]['id'] if cur and any(v['id'] == cur[0]['id'] for v in pool) else pool[0]['id']
        line = sample_line(ws, lang, a.line_ja if lang == 'ja' else a.line_en)
        for k, v in enumerate(pool):
            oid = f"{lang}-{v['id']}"; mp3 = os.path.join(outd, oid + '.mp3'); raw = os.path.join(outd, oid + '.raw.mp3')
            text = POOL['prefix_tag'].get(lang, '') + W.tts_text(line, lang, v.get('spell'))
            settings = POOL['settings'][lang]; rec = dict(lang=lang, voiceId=v['voiceId'], name=v['name'], settings=settings, model='eleven_v3',
                                                          line=W.display_text(line), tts_text=text, why=v.get('why'))
            if pd.mock:
                used = mock.say(W.tts_text(line, lang, v.get('spell')), raw, lang, v.get('mock'))
                pd.mock_record(f'voice audition {oid} (say {used})'); rec.update(mock=True, mockVoice=used)
            else:
                est = paid.est_tts(len(text))
                with pd.call('elevenlabs', f'tts audition {oid} ({len(text)} chars)', est) as c:
                    import el
                    r = el.tts(v['voiceId'], text, raw, settings, lang=lang)
                    c['request_id'] = r['request_id']
                    if r.get('character_cost'): c['usd'] = paid.est_tts(float(r['character_cost']))
                rec['requestId'] = c['request_id']
            x = A.trim_silence(A.load(raw), -45, 0.1, 0.25)
            if len(x) < int(0.5 * A.SR): raise SystemExit(f'{oid}: sample too short / silent')
            x = A.limit_to_ceiling(A.gain_to(x, -16.0), -1.0); A.write(mp3, x, bitrate='128k'); os.remove(raw)
            rec['sample'] = W.rel(ws, mp3); rec['durS'] = round(len(x) / A.SR, 2); rec['lufs'] = round(A.lufs(x), 1)
            W.jwrite(os.path.join(outd, oid + '.json'), rec)
            options.append(dict(id=oid, title=f"{lang.upper()} · {v['name']}" + (' (retired)' if v.get('retired') else ''), summary=v.get('why', ''), recommended=(v['id'] == rec_id), lang=lang,
                                files=[W.rel(ws, os.path.join(outd, oid + '.json')), rec['sample']], preview=rec['sample']))
            print(json.dumps(dict(option=oid, durS=rec['durS'], lufs=rec['lufs'], mock=pd.mock), ensure_ascii=False))
    of = W.jwrite(W.P(ws, 'stages', 'voice', 'options.json'), options)
    W.register_options(ws, 'voice', of, a.register)


if __name__ == '__main__': main()
