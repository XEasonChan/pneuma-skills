#!/usr/bin/env python3
"""QC lint · the text rules of references/launch-rules.md on what the picture shows and the captions say.

  scripts/py qc/lint.py [--ws DIR] [--files remotion/scenes.json,stages/vo/lines.json,…] [--script] [--json]

Scans every DISPLAY string of remotion/scenes.json (props, onScreen, vo text; not ids, types, file paths, notes) and
stages/vo/lines.json (text, caption chunks), plus the picked script with --script, for:
  names         personal names (R8, roles over names): a list of common EN / JA given names and surnames (Latin, katakana, kanji)
                and JA honorifics on a name (〇〇さん / 様 / くん, Ishida-san). Allowed only when film.json run.brief.allowNames is
                true (all) or a list (those names).
  brand-caps    the brand in its display form (R1, W.brand(): film.json run.brief.brand, else the style.json preset): any other
                spelling of it, or its JA spoken form, in display text. Skipped when the run has no brand rule.
  integrations  services the product does not integrate with (R11): run.brief.integrations.deny, else style.json integrations.deny
                (an editable preset, empty by default); anything on the allow list passes.
  leftovers     content left from the kit's scene defaults or placeholders (R12): the kit's default lines, "ACME" outside a run
                whose brand it is, Lorem ipsum, TODO / TBD / XXX, placeholder text, plus run.brief.leftovers (a run's own list,
                e.g. an earlier film's cast and story).
Own implementation (no dependency on the launch-kit's names helper). A scene that OMITS a prop renders the kit default, which is
not in scenes.json: this lint can't see that — look at the sheets. Writes out/qc/lint.json; qc/qc.py check|all adds the rows to
every version's QC record. Exit 1 when a check fails (with --json the report is printed either way)."""
import argparse, json, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import ws as W

SKIP_KEYS = {'id', 'type', 'sceneType', 'sceneId', 'file', 'files', 'src', 'href', 'url', 'image', 'img', 'icon', 'logo', 'asset', 'assets',
             'ground', 'transitionIn', 'transitionOut', 'transition', 'kind', 'notes', 'note', 'font', 'color', 'colour', 'units', 'formats',
             'languages', 'editions', 'gaze', 'sounds', 'source', 'prd', 'figma', 'voiceId', 'model', 'tts', 'tts_text', 'words', 'clock',
             'take', 'lang', 'fit', 'window', 'hero', 'focal', 'board', 'arc', 'readOk', 'mask', 'shape', 'layout', 'variant', 'align', 'ease',
             'brand', 'integrations', 'leftovers', 'allowNames', 'events', 'accent', 'tone', 'exit'}
PATHLIKE = re.compile(r'^[\w./@:-]+\.(png|jpe?g|webp|svg|gif|mp4|mov|mp3|m4a|wav|flac|json|tsx?|js|css)$|^(https?:|data:|kit:|assets/|stages/|out/|\.{0,2}/)', re.I)

A = r'(?<![A-Za-z0-9])'; Z = r'(?![A-Za-z0-9])'      # ASCII word edges that also work next to CJK (Python's \b does not)

EN_NAMES = '''Maya Evan Ethan Sophie Sophia Emma Olivia Liam Noah Oliver Lucas Mia Chloe Hannah Sarah Emily Jessica Daniel David Michael Matthew
Ryan Kevin Brian Jason Eric Alex Alice Tom Ben Kate Lucy Anna Laura Rachel Megan Nina Leo Harry George Charlotte Amelia Isabella Ava Zoe
Lily Ella Nathan Tyler Justin Aaron Adam Jacob Mason Logan Owen Dylan Luke Henry Samuel Joseph Thomas Christopher Kyle Sean Ian Carlos
Diego Priya Arthur Jake Josh Joshua Peter Steve Steven Susan Linda Karen Nancy Lisa Amy Julia Julie Claire Elena
Maria Sofia Victoria Natalie Jennifer Ashley Brandon Justine Marcus Oscar Felix Hugo Jonas Emil Lena Clara Isla Freya Evelyn'''.split()
JA_ROMAJI = '''Hikari Kasane Misaki Kenji Yuki Haruto Sota Yui Emi Ryo Hana Aoi Ren Riku Yuto Takumi Daiki Shota Mei Rin Yuna Akari Kaito
Haruka Nanami Airi Koharu Yuzuha Yuzu Kenta Takeshi Hiroshi Akira Naoki Satoshi Keiko Yoko Tomoko Ayumi Mariko Sakiko Taro Jiro Hanako
Sato Suzuki Takahashi Tanaka Watanabe Yamamoto Nakamura Kobayashi Kato Yoshida Yamada Sasaki Hayashi Ishida Kimura Inoue Matsumoto
Shimizu Yamaguchi Ikeda Hashimoto Ishikawa Ogawa Okada Fujita Nakajima Kondo Mori Ito'''.split()
JA_SCRIPT = '''美咲 健二 結衣 恵美 陽翔 翔太 大翔 花子 太郎 次郎 裕子 陽子 智子 明美 由美 直樹 健太 拓海 陽菜 結菜 さくらさん ひかりさん
佐藤 鈴木 高橋 田中 渡辺 伊藤 山本 中村 小林 加藤 吉田 山田 佐々木 山口 松本 井上 木村 石田 林さん 森さん 清水 池田 橋本 石川 小川 岡田
ミサキ ケンジ ヒカリ カサネ イーサン エヴァン エバン マヤ ソフィー エマ オリバー アーサー ユキ ハルト'''.split()
ROLE_WORDS = {'お客', '客', '皆', '取引先', '先方', '相手', '顧客', '担当者', '代表', '営業', '担当', '先輩', '後輩', '店長', '社長', '部長', '課長', '係長', '先生', '大家', 'バイヤー', 'デザイナー', 'メンバー',
              'オーナー', 'リーダー', 'マネージャー', 'スタッフ', 'ドライバー', 'エンジニア', 'パートナー', 'クライアント', 'ユーザー', 'チーム'}
NOT_HONORIFIC_SAMA = set('仕同模皆客一異多今貴王神仏左右如有')
COMPANY_TAIL = re.compile(r'(社|家電|商事|工房|店|屋|部|課|室|チーム|会社|事務所|銀行|病院)$')
HONORIFIC = re.compile(r'([一-龥々]{1,3}|[ァ-ヶー]{2,8}|[A-Za-z]{2,12})(さん|くん|ちゃん|様|氏)|' + A + r'([A-Z][a-z]{1,12})-(san|sama|kun|chan)' + Z)

# the kit's own default / preview copy (launch-kit scenes): a film that still shows one of these forgot to set the prop
KIT_DEFAULTS = ['Where did that file go?', 'あの資料、 どこだっけ？', 'Your launch line goes here.', 'ここにキャッチコピーが入ります。',
                'Placeholder footage', 'プレースホルダー映像', "We've all been there.", 'The answer is scattered across five apps.']
LEFTOVERS = KIT_DEFAULTS + ['Lorem ipsum', 'lorem', 'TODO', 'TBD', 'XXX', 'placeholder', 'プレースホルダー']
CASED = {'TODO', 'TBD', 'XXX'}


def _preset(key):
    try:
        with open(os.path.join(W.SCRIPTS, 'common', 'style.json'), encoding='utf-8') as f: return json.load(f).get(key) or {}
    except (OSError, ValueError): return {}


def _rx(term, case=True):
    if re.search(r'[A-Za-z]', term): return re.compile(A + re.escape(term) + Z, 0 if case else re.I)
    if re.fullmatch(r'[ァ-ヶー]+', term): return re.compile(r'(?<![ァ-ヶー])' + re.escape(term) + r'(?![ァ-ヶー])')   # not inside a longer katakana word
    return re.compile(re.escape(term))


def integrations(brief):
    """(allow, deny): run.brief.integrations, else the style.json `integrations` preset"""
    cfg = brief.get('integrations') or _preset('integrations')
    allow = {x.lower() for x in cfg.get('allow') or []}
    return allow, [d for d in cfg.get('deny') or [] if d.lower() not in allow]


def display_strings(obj, where, path=''):
    """(where, keypath, text) for every display string under obj"""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in SKIP_KEYS: continue
            out += display_strings(v, where, f'{path}.{k}' if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj): out += display_strings(v, where, f'{path}[{i}]')
    elif isinstance(obj, str):
        t = obj.strip()
        if t and not PATHLIKE.search(t) and not re.fullmatch(r'[#\d.,:%+\-\s]+|[a-z0-9_-]+', t): out.append((where, path, t))
    return out


def sources(ws, files=None, script=False):
    fs = files or ['remotion/scenes.json', 'stages/vo/lines.json']
    out = []
    for f in fs:
        p = f if os.path.isabs(f) else os.path.join(ws, f)
        if not os.path.exists(p): continue
        if p.endswith('.json'):
            j = W.jread(p)
            if os.path.basename(p) == 'lines.json':
                for i, l in enumerate(j if isinstance(j, list) else []):
                    out.append((W.rel(ws, p), f"[{i}]{l.get('lang', '')}:{l.get('id')}.text", l.get('text', '')))
                    for k, c in enumerate(l.get('caps') or []): out.append((W.rel(ws, p), f"[{i}]{l.get('id')}.caps[{k}]", c.get('text', '')))
            else: out += display_strings(j, W.rel(ws, p))
        else:
            out += [(W.rel(ws, p), f'line {n + 1}', t.strip()) for n, t in enumerate(open(p, encoding='utf-8')) if t.strip()]
    if script:
        try:
            sc = W.script_option(ws)
            for s in sc.get('scenes', []):
                for part in ('vo', 'onScreen'):
                    for lg, t in (s.get(part) or {}).items():
                        if isinstance(t, str) and t: out.append(('script', f"{s['id']}.{part}.{lg}", t))
        except SystemExit: pass
    return out


def lint(ws, files=None, script=False):
    brief = W.film(ws).get('run', {}).get('brief', {}) or {}
    an = brief.get('allowNames'); allow_all = an is True
    allowed = {x.lower() for x in an} if isinstance(an, list) else set()
    strs = sources(ws, files, script)
    hits = {k: [] for k in ('names', 'brand-caps', 'integrations', 'leftovers')}
    name_rx = [(n, _rx(n)) for n in EN_NAMES + JA_ROMAJI] + [(n, _rx(n)) for n in JA_SCRIPT]
    _, deny_list = integrations(brief)
    deny = [(d, _rx(d, case=d.isupper())) for d in deny_list]
    br = W.brand(ws); brx = W.brand_re(br) if br else None
    extra = [t for t in brief.get('leftovers') or [] if t.lower() not in allowed]
    acme = [] if (br and br['display'].lower() == 'acme') else ['ACME']
    left = [(t, _rx(t, case=t in CASED)) for t in LEFTOVERS + acme] + [(t, _rx(t)) for t in extra]
    ja_spoken = br['spoken']['ja'] if br and br['spoken']['ja'] != br['display'] else None
    for where, key, t in strs:
        def add(rule, m, why=''):
            hits[rule].append(dict(where=where, key=key, match=m, text=t[:120], why=why))
        if brx:
            for m in brx.finditer(t):
                if m.group(0) != br['display']: add('brand-caps', m.group(0), f"write {br['display']} (R1)")
            if ja_spoken and ja_spoken in t: add('brand-caps', ja_spoken, f"write {br['display']} on screen; {ja_spoken} is only how it is read (R1)")
        found = [d for d, rx in deny if rx.search(t)]
        for d in found:
            if any(d != o and d in o for o in found): continue      # 'X' inside a longer denied name that also matched
            add('integrations', d, 'not integrated (R11)')
        for tt, rx in left:
            if rx.search(t): add('leftovers', tt, 'kit default / placeholder / run leftover (R12)')
        if allow_all: continue
        seen = set()
        for n, rx in name_rx:
            base = n.replace('さん', '')
            if base.lower() in allowed or base in seen: continue
            if rx.search(t): seen.add(base); add('names', base, 'personal name (R8: roles over names)')
        for m in HONORIFIC.finditer(t):
            nm = m.group(1) or m.group(3); hon = m.group(2) or m.group(4)
            if not nm or nm in seen or nm.lower() in allowed or nm in ROLE_WORDS or COMPANY_TAIL.search(nm): continue
            if hon == '様' and nm[-1] in NOT_HONORIFIC_SAMA: continue
            if re.fullmatch(r'[a-z]+', nm): continue
            seen.add(nm); add('names', nm + hon, 'a name with an honorific (R8)')
    labels = {'names': 'No personal names (roles over names, R8)' + (' — allowNames: all' if allow_all else (f" — allowNames: {', '.join(sorted(allowed))}" if allowed else '')),
              'brand-caps': (f"The brand written {br['display']} in display text (R1)" if br else 'Brand display form (R1) — no brand rule set'),
              'integrations': 'Only integrated services (R11)' + (f" — not {', '.join(deny_list[:4])}{' …' if len(deny_list) > 4 else ''}" if deny_list else ' — no deny list set'),
              'leftovers': 'No kit-default / placeholder / earlier-film leftovers (R12)'}
    rows = []
    for k, hs in hits.items():
        uniq = sorted({h['match'] for h in hs})
        note = (f"{len(hs)} hit(s): " + ', '.join(uniq[:8]) + (' …' if len(uniq) > 8 else '') + ' · ' + '; '.join(f"{h['where']} {h['key']}" for h in hs[:4])) if hs else \
               ('skipped: the brief allows names' if (k == 'names' and allow_all) else f'{len(strs)} strings clean')
        rows.append(dict(id=f'lint-{k}', status='fail' if hs else 'pass', label=labels[k], note=note))
    return dict(at=W.now_iso(), scanned=sorted({w for w, _, _ in strs}), strings=len(strs), rows=rows, hits=hits, pass_=all(r['status'] == 'pass' for r in rows))


def run(ws, files=None, script=False, write=True):
    rep = lint(ws, files, script); rep['pass'] = rep.pop('pass_')
    if write: W.jwrite(W.P(ws, 'out', 'qc', 'lint.json'), rep)
    return rep


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ws'); ap.add_argument('--files'); ap.add_argument('--script', action='store_true'); ap.add_argument('--json', action='store_true')
    a = ap.parse_args(); ws = W.ws_root(a.ws)
    rep = run(ws, [f for f in (a.files or '').split(',') if f] or None, a.script)
    if a.json: print(json.dumps(rep, ensure_ascii=False, indent=1))
    else:
        for r in rep['rows']: print(f"{'ok ' if r['status'] == 'pass' else 'BAD'} {r['id']:18s} {r['note']}")
        print(json.dumps(dict(report='out/qc/lint.json', scanned=rep['scanned'], strings=rep['strings'], ok=rep['pass'])))
    if not rep['pass']: sys.exit(1)


if __name__ == '__main__': main()
