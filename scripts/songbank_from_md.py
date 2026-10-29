#!/usr/bin/env python3
"""Turn Jozef's song repository (Claude memory file /areas/song-repository.md,
saved locally as Markdown) into the app's song bank: server/seed/songbank.json.

The Mac checks that file on GitHub every hour (server/sources/ghsongs.js) and
adds new songs / updates changed ones, leaving songs someone edited by hand in
Admin → Songs alone. So after running this, commit and push
server/seed/songbank.json — no app update needed.

    python3 scripts/songbank_from_md.py song-repository.md

Repository format (one block per song):
    ## Title
    - [stated] Progression (Chart, Key X, 72 tempo, 4/4): Intro → Verse 1 → …
    - [stated] Feel: 72 tempo; …
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'server', 'seed', 'songbank.json')


def song_key(title):
    # Same rule as songKey() in server/engine.js.
    t = str(title or '').lower()
    t = re.sub(r'\[[^\]]*\]', ' ', t)
    t = re.sub(r'\([^)]*\)', ' ', t)
    t = re.sub(r'[^a-z0-9 ]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def parse(md):
    songs = []
    for blk in re.split(r'\n## ', '\n' + md):
        blk = blk.strip()
        if not blk or blk.startswith('---') or blk.startswith('name:'):
            continue
        lines = blk.split('\n')
        title = lines[0].lstrip('# ').strip()
        prog = feel = ''
        notes = []
        for l in lines[1:]:
            l = re.sub(r'^-\s*\[[a-z]+\]\s*', '', l.strip())
            m = re.match(r'Progression(?:\s*\(([^)]*)\))?:\s*(.*)', l, re.S)
            if m:
                if m.group(1):
                    notes.append('Chart: ' + m.group(1))
                prog = m.group(2).strip()
                # Extra arrangements written after the main one (". Per the
                # backline…") go to notes. Only split at a ". " outside
                # parentheses, so "(Elec. Gtr)" stays put.
                depth = 0
                for i, ch in enumerate(prog):
                    depth += ch == '(' and 1 or ch == ')' and -1 or 0
                    if depth == 0 and prog[i:i + 2] == '. ' and '→' in prog[:i]:
                        prog, extra = prog[:i], prog[i + 2:]
                        notes.append(extra.strip())
                        break
            elif l.startswith('Feel:'):
                feel = l[5:].strip()
            elif l.startswith('Notes:') or l.startswith('Note:'):
                notes.append(l.split(':', 1)[1].strip())
        if prog or feel:
            songs.append({'title': title, 'lead': '', 'feel': feel, 'progression': prog, 'notes': ' '.join(notes)})
    return songs


def build(songs):
    out = {}
    for s in songs:
        k = song_key(s['title'])
        if not k:
            continue
        if k in out:
            a, b = out[k], s
            # Same key twice (e.g. "[Tag] Center" and "Center (Live)"): keep the
            # full song and put the tag/short version in its notes.
            short = lambda x: bool(re.match(r'\s*\[(tag|flow|shortened)\]', x['title'], re.I))
            full, other = (b, a) if short(a) and not short(b) else (a, b)
            full = dict(full)
            full['notes'] = (full['notes'] + ' ' if full['notes'] else '') + f"Tag version ({other['title']}): {other['progression']}"
            out[k] = full
        else:
            out[k] = s
    return out


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    bank = build(parse(open(sys.argv[1], encoding='utf-8').read()))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(bank, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{len(bank)} songs -> server/seed/songbank.json')
