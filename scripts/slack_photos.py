#!/usr/bin/env python3
"""Weekly Slack photo refresh for the display app's face cards.

The app on the Mac has no Slack access of its own, so a scheduled Claude task
looks everyone up in Slack (through Jozef's Slack connection), writes what it
found to a JSON file, and runs this script. The script:

  * skips anyone whose Slack photo hasn't changed since last time (it keeps a
    record of each person's Slack photo address in server/seed/slack-photos.json),
  * downloads new / changed photos and crops them to a 600x800 portrait of the
    person (face-aware), saving server/seed/photos/<slug>.jpg,
  * leaves photos with several faces (couples, groups) for a person to crop:
    they're listed under "review" and saved in scripts/.slack-review/.

The Mac picks the new photos up from GitHub by itself within an hour
(server/sources/ghphotos.js) — no app update needed.

  python3 scripts/slack_photos.py apply found.json
      found.json = {"Roster Name": {"id": "U123", "url": "https://avatars.slack-edge.com/..._original.png"}, ...}
  python3 scripts/slack_photos.py crop "Roster Name" X Y W H
      crop a reviewed photo by hand (box in the original picture's pixels)
  python3 scripts/slack_photos.py since 2026-10-25 found.json
      list who has a Slack photo uploaded on/after that date (from the address)

Needs: pip install --break-system-packages opencv-python-headless pillow
"""
import hashlib
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHOTOS = os.path.join(ROOT, 'server', 'seed', 'photos')
MANIFEST = os.path.join(ROOT, 'server', 'seed', 'slack-photos.json')
REVIEW = os.path.join(ROOT, 'scripts', '.slack-review')
OUT_W, OUT_H = 600, 800


def slugify(name):
    s = unicodedata.normalize('NFKD', str(name or ''))
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"['’]", '', s)
    s = re.sub(r'[^a-z]+', '-', s)
    return s.strip('-')


def load_manifest():
    try:
        with open(MANIFEST) as f:
            return json.load(f)
    except Exception:
        return {}


def save_manifest(m):
    with open(MANIFEST, 'w') as f:
        json.dump(dict(sorted(m.items())), f, indent=1, ensure_ascii=False)
        f.write('\n')


def file_v(path):
    with open(path, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:12]


def is_default_avatar(url):
    return (not url) or 'gravatar.com' in url or '/img/avatars/' in url or 'ava_0' in url


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'lc-displays-photo-refresh'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def faces(img):
    import cv2
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    casc = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml'))
    h, w = gray.shape
    found = casc.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(max(24, w // 20), max(24, h // 20)))
    return [tuple(int(v) for v in f) for f in found]


def crop_box_for_face(fx, fy, fw, fh, W, H):
    # Head-and-shoulders: face about 45% of the width, eyes ~1/3 down.
    cw = min(W, int(fw / 0.45))
    ch = int(cw * OUT_H / OUT_W)
    if ch > H:
        ch = H
        cw = int(ch * OUT_W / OUT_H)
    cx = fx + fw / 2
    x = int(max(0, min(W - cw, cx - cw / 2)))
    y = int(max(0, min(H - ch, fy - fh * 0.55)))
    return x, y, cw, ch


def save_crop(img, box, dest):
    import cv2
    x, y, w, h = box
    out = cv2.resize(img[y:y + h, x:x + w], (OUT_W, OUT_H), interpolation=cv2.INTER_AREA)
    cv2.imwrite(dest, out, [cv2.IMWRITE_JPEG_QUALITY, 88])


def decode(data):
    import cv2
    import numpy as np
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError('not an image')
    return img


def cmd_apply(found_path):
    import cv2
    found = json.load(open(found_path))
    m = load_manifest()
    os.makedirs(REVIEW, exist_ok=True)
    res = {'updated': [], 'added': [], 'review': [], 'unchanged': 0, 'skipped_default': [], 'errors': []}
    for name, info in sorted(found.items()):
        url = (info or {}).get('url', '')
        if is_default_avatar(url):
            res['skipped_default'].append(name)
            continue
        slug = slugify(name)
        dest = os.path.join(PHOTOS, slug + '.jpg')
        prev = m.get(name, {})
        if prev.get('url') == url and os.path.exists(dest):
            res['unchanged'] += 1
            continue
        # First look at a starter photo we already have: if the Slack photo is
        # older than our copy, just remember its address (no re-crop).
        up = re.search(r'/(\d{4}-\d{2}-\d{2})/', url)
        if os.path.exists(dest) and not prev.get('url') and up and up.group(1) < prev.get('updated', '0000'):
            m[name] = {**prev, 'id': info.get('id', ''), 'url': url}
            res['unchanged'] += 1
            continue
        try:
            img = decode(fetch(url))
        except Exception as e:
            res['errors'].append(f'{name}: {e}')
            continue
        H, W = img.shape[:2]
        fs = faces(img)
        had = os.path.exists(dest)
        if len(fs) == 1:
            save_crop(img, crop_box_for_face(*fs[0], W, H), dest)
        elif len(fs) == 0 and abs(W - H) < W * 0.1 and not had:
            # Probably already a headshot (square, no face found): top-centre crop.
            cw = int(H * OUT_W / OUT_H)
            save_crop(img, (max(0, (W - cw) // 2), 0, min(W, cw), H), dest)
        else:
            # Several faces (or none in a wide shot): a person picks the crop.
            cv2.imwrite(os.path.join(REVIEW, slug + '.jpg'), img)
            res['review'].append({'name': name, 'size': [W, H], 'faces': fs, 'file': os.path.relpath(os.path.join(REVIEW, slug + '.jpg'), ROOT)})
            m.setdefault(name, {})['pending_url'] = url
            m[name]['id'] = info.get('id', '')
            continue
        m[name] = {'id': info.get('id', ''), 'url': url, 'v': file_v(dest), 'updated': time.strftime('%Y-%m-%d')}
        (res['updated'] if had else res['added']).append(name)
    save_manifest(m)
    print(json.dumps(res, indent=1))


def cmd_crop(name, x, y, w, h):
    import cv2
    slug = slugify(name)
    src = os.path.join(REVIEW, slug + '.jpg')
    img = cv2.imread(src)
    if img is None:
        sys.exit(f'No review photo for {name} ({src})')
    H, W = img.shape[:2]
    x, y, w, h = int(x), int(y), int(w), int(h)
    # Keep the 3:4 shape the screens expect.
    h = int(w * OUT_H / OUT_W)
    x, y = max(0, min(W - w, x)), max(0, min(H - h, y))
    dest = os.path.join(PHOTOS, slug + '.jpg')
    save_crop(img, (x, y, w, h), dest)
    m = load_manifest()
    e = m.get(name, {})
    m[name] = {'id': e.get('id', ''), 'url': e.get('pending_url') or e.get('url', ''), 'v': file_v(dest), 'updated': time.strftime('%Y-%m-%d')}
    save_manifest(m)
    os.remove(src)
    print(f'Cropped {name} -> server/seed/photos/{slug}.jpg')


def cmd_since(date, found_path):
    found = json.load(open(found_path))
    for name, info in sorted(found.items()):
        mm = re.search(r'/(\d{4}-\d{2}-\d{2})/', (info or {}).get('url', ''))
        if mm and mm.group(1) >= date:
            print(mm.group(1), name)


def cmd_init():
    """Record every starter photo already in the app (url unknown yet)."""
    m = load_manifest()
    roster = json.load(open(os.path.join(ROOT, 'server', 'seed', 'roster.json')))
    for name in roster:
        p = os.path.join(PHOTOS, slugify(name) + '.jpg')
        if os.path.exists(p) and name not in m:
            m[name] = {'id': '', 'url': '', 'v': file_v(p), 'updated': '2026-10-25'}
    save_manifest(m)
    print(f'{len(m)} people in the manifest')


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['apply'] and len(a) == 2:
        cmd_apply(a[1])
    elif a[:1] == ['crop'] and len(a) == 6:
        cmd_crop(*a[1:])
    elif a[:1] == ['since'] and len(a) == 3:
        cmd_since(a[1], a[2])
    elif a[:1] == ['init']:
        cmd_init()
    else:
        print(__doc__)
        sys.exit(1)
