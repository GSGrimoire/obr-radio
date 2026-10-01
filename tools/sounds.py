"""Builds the Dreams & Machines sound files from tools/dnm-sources.json.

    python3 tools/sounds.py <folder holding the unzipped Kenney packs>

For a Freesound sound it opens the sound's own page, reads its licence there,
refuses anything that is not CC0 or CC BY (no NonCommercial, NoDerivatives or
Sampling+), and streams its high-quality Ogg preview. Kenney files come from
Kenney's own CC0 zips. Each file is trimmed as the manifest says, made to loop
(an equal-power crossfade of its end into its start) if it is ambience, levelled,
and written to sounds/ as Ogg Vorbis. Where it came from and what was done to
it is written to tools/dnm-sources.lock.json, which packs.js credits from.
"""
import io, json, os, re, sys, subprocess, html, urllib.parse
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = json.load(open(os.path.join(ROOT, "tools", "dnm-sources.json")))
KENNEY_DIR = sys.argv[1] if len(sys.argv) > 1 else "."

def curl(url, binary=False):
    out = subprocess.run(["curl", "-sL", "-A", "Mozilla/5.0", "-w", "\n%{url_effective}", url], capture_output=True)
    body, _, final = out.stdout.rpartition(b"\n")
    return (body if binary else body.decode("utf-8", "replace")), final.decode()

def freesound(sid):
    page, final = curl(f"https://freesound.org/s/{sid}/")
    m = re.search(r"/people/([^/]+)/sounds/(\d+)/", final)
    if not m or int(m.group(2)) != sid:
        raise SystemExit(f"{sid}: no sound page ({final})")
    user = urllib.parse.unquote(m.group(1))
    lic = sorted(set(re.findall(r"creativecommons\.org/(?:publicdomain/zero/1\.0|licenses/[a-z-]+/[0-9.]+)", page)))
    if len(lic) != 1:
        raise SystemExit(f"{sid}: licence unclear on its page: {lic}")
    lic = lic[0]
    if "publicdomain/zero" in lic:
        license, licenseUrl = "CC0", "https://creativecommons.org/publicdomain/zero/1.0/"
    elif re.search(r"licenses/by/[0-9.]+$", lic):
        ver = lic.rsplit("/", 1)[1]
        license, licenseUrl = f"CC BY {ver}", f"https://creativecommons.org/licenses/by/{ver}/"
    else:
        raise SystemExit(f"{sid}: {lic} is not CC0 or CC BY; refused")
    title = re.search(r'<meta property="og:title" content="([^"]+)"', page)
    title = html.unescape(title.group(1)) if title else str(sid)
    mp3 = re.search(r"https://cdn\.freesound\.org/previews/\d+/\d+_\d+-(?:hq|lq)\.mp3", page)
    if not mp3:
        raise SystemExit(f"{sid}: no preview link")
    ogg = re.sub(r"-(?:hq|lq)\.mp3$", "-hq.ogg", mp3.group(0))
    audio, _ = curl(ogg, binary=True)
    credit = {"author": user, "title": title, "url": f"https://freesound.org/people/{m.group(1)}/sounds/{sid}/",
              "license": license, "licenseUrl": licenseUrl}
    return audio, credit

def kenney(pack, name):
    for dirpath, _, files in os.walk(os.path.join(KENNEY_DIR, pack)):
        if name in files:
            data = open(os.path.join(dirpath, name), "rb").read()
            meta = SPEC["kenney"][pack]
            return data, {"author": "Kenney", "title": f"{meta['title']}: {name}", "url": meta["url"],
                          "license": "CC0", "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/"}
    raise SystemExit(f"{pack}/{name}: not found under {KENNEY_DIR}")

def db(x): return 10 ** (x / 20)

def process(raw, f):
    x, sr = sf.read(io.BytesIO(raw), always_2d=True, dtype="float64")
    changes = []
    if f.get("trim"):
        start, length = f["trim"]
        a, b = int(start * sr), int((start + length) * sr)
        if b < len(x) or a > 0:
            x = x[a:b]
            changes.append(f"cut to {start:g}–{start + len(x) / sr:g} s")
    if f.get("loop") and not f.get("seamless"):
        c = int(min(2.0, len(x) / sr * 0.1) * sr)
        t = np.linspace(0, np.pi / 2, c)[:, None]
        y = x[: len(x) - c].copy()
        y[:c] = x[:c] * np.sin(t) + x[len(x) - c:] * np.cos(t)
        x = y
        changes.append(f"its end crossfaded into its start over {c / sr:.1f} s so it loops")
    elif not f.get("loop"):
        k = min(len(x), int(0.004 * sr))
        x[:k] *= np.linspace(0, 1, k)[:, None]
        x[len(x) - k:] *= np.linspace(1, 0, k)[:, None]
    peak = np.max(np.abs(x)) or 1
    if f.get("loop"):
        rms = np.sqrt(np.mean(x ** 2)) or 1
        gain = min(db(-24) / rms, db(-1) / peak)
    else:
        gain = db(-1.5) / peak  # headroom: Vorbis can overshoot the peak a little
    x = x * gain
    changes.append("levelled")
    # Written in blocks: libsndfile's Vorbis encoder crashes on one large write.
    tmp = os.path.join(ROOT, "out", "sounds.tmp.ogg")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    with sf.SoundFile(tmp, "w", sr, x.shape[1], format="OGG", subtype="VORBIS",
                      compression_level=0.55 if f.get("loop") else 0.45) as out:
        for i in range(0, len(x), 4096):
            out.write(np.ascontiguousarray(x[i:i + 4096]))
    data = open(tmp, "rb").read()
    os.remove(tmp)
    return data, changes, len(x) / sr

lock = []
for f in SPEC["files"]:
    raw, credit = freesound(f["freesound"]) if "freesound" in f else kenney(f["kenney"], f["file"])
    data, changes, secs = process(raw, f)
    path = os.path.join(ROOT, "sounds", f["out"])
    open(path, "wb").write(data)
    lock.append({"out": f["out"], "name": f["name"], "page": f["page"], "loop": bool(f.get("loop")),
                 "seconds": round(secs, 1), "bytes": len(data), "changes": "; ".join(changes).capitalize() + ".",
                 **credit})
    print(f"{credit['license']:9} {secs:6.1f}s {len(data)//1024:5}k {f['out']:34} {credit['author']}")
json.dump(lock, open(os.path.join(ROOT, "tools", "dnm-sources.lock.json"), "w"), indent=1, ensure_ascii=False)
print(len(lock), "files,", sum(x["bytes"] for x in lock) // 1024, "kB")
