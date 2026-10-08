"""The style presets, read fresh on every call. SOURCE OF TRUTH: <SKILL>/references/style-presets.md (The producer edits it between runs;
its <!-- preset:<id> --> blocks are quoted verbatim). common/style.json is only the machine fallback / structured extras (tags,
section styles, licence note) and must be kept in step with the .md; when the two differ, the .md wins.

load() -> {palette, negatives_text, negatives[list], briefs{B, E1}, sfx_palette, tags, section_styles, licence_note, source}"""
import json, os, re
import ws as W

MD = os.path.join(W.SKILL, 'references', 'style-presets.md')
JS = os.path.join(W.SCRIPTS, 'common', 'style.json')


def _blocks(text):
    out = {}
    for m in re.finditer(r'<!--\s*preset:(\S+)\s*-->(.*?)<!--\s*/preset\s*-->', text, re.S):
        out[m.group(1)] = [b.strip() for b in re.findall(r'```text\n(.*?)```', m.group(2), re.S)]
    return out


def _split_top(s, sep=','):
    parts, depth, cur = [], 0, ''
    for ch in s:
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == sep and depth == 0: parts.append(cur); cur = ''
        else: cur += ch
    parts.append(cur); return [p.strip() for p in parts if p.strip()]


def negatives_list(text):
    """'No piano of any kind (…). No marimba, glockenspiel, … .' -> ['piano of any kind (…)', 'marimba', 'glockenspiel', …]"""
    items = []
    for sent in re.split(r'(?<=\.)\s+', ' '.join(text.split())):
        sent = sent.strip().rstrip('.')
        if not sent or not sent.lower().startswith('no '): continue
        for part in _split_top(sent[3:], ';'):
            part = re.sub(r'^no\s+', '', part, flags=re.I)
            for p in ([part] if re.search(r'\b(after|outside|before)\b', part) else _split_top(part)):   # keep qualified items whole
                p = re.sub(r'^(no|and)\s+', '', p.strip(), flags=re.I)
                if p and p not in items: items.append(p)
    return items


def load():
    js = json.load(open(JS)) if os.path.exists(JS) else {}
    st = dict(js); st['source'] = 'style.json'
    if os.path.exists(MD):
        b = _blocks(open(MD).read())
        if b.get('music-palette'): st['palette'] = b['music-palette'][0]
        if b.get('music-negatives'):
            st['negatives_text'] = b['music-negatives'][0]; st['negatives'] = negatives_list(b['music-negatives'][0])
        for blk in b.get('music-briefs', []):
            k, _, v = blk.partition(':'); key = 'B' if k.lower().startswith('base b') else ('E1' if k.startswith('E1') else k.strip())
            st.setdefault('briefs_that_worked', {})[key] = ' '.join(v.split())
        if b.get('sfx-palette'): st['sfx_palette'] = b['sfx-palette'][0]
        st['source'] = 'references/style-presets.md'
    st.setdefault('negatives_text', 'No ' + ', no '.join(st.get('negatives', [])) + '.')
    return st
