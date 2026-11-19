"""Replace the French lettering in aimants.webp with English.

Usage:  python tools/translate_aimants.py
Reads   assets/originals/aimants.fr.webp  (untouched French original)
Writes  assets/img/aimants.webp           (same size, English lettering)

Needs Pillow + numpy and the Windows fonts Segoe UI Bold, Monotype Corsiva and Bahnschrift.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/originals/aimants.fr.webp"
DST = ROOT / "assets/img/aimants.webp"
FONTS = Path("C:/Windows/Fonts")
SS = 4  # supersampling factor for text rendering

img = Image.open(SRC).convert("RGB")
W, H = img.size
px = np.asarray(img).astype(float)


def erase(x0, x1, y0, y1):
    """Remove lettering in rows y0..y1 by interpolating each column between the
    clean background just above and just below. Reference rows are averaged over
    3 rows and smoothed horizontally so compression noise doesn't leave streaks."""
    def ref(rows):
        r = px[rows, x0:x1 + 1].mean(axis=0)
        k = np.ones(9) / 9
        pad = np.pad(r, ((4, 4), (0, 0)), mode="edge")
        return np.stack([np.convolve(pad[:, c], k, mode="valid") for c in range(3)], axis=1)
    top, bot = ref(slice(y0 - 3, y0)), ref(slice(y1 + 1, y1 + 4))
    n = y1 - y0 + 2
    for i, y in enumerate(range(y0, y1 + 1), start=1):
        t = i / n
        px[y, x0:x1 + 1] = top * (1 - t) + bot * t


# --- 1. erase French text (regions measured from the original) ---
erase(52, 434, 12, 43)    # "AIMANTS PUISSANTS"        (ink x63-422, y15-40)
erase(80, 402, 48, 80)    # "Pratique · Silencieux · Efficace" (ink x90-391, y52-80)
erase(2, 134, 202, 214)   # "OUVERTURE RAPIDE!"        bar y196-220
erase(2, 134, 338, 350)   # "FERMETURE AUTOMATIQUE!"   bar y333-356
erase(2, 134, 453, 464)   # "FERMETURE SANS BRUIT!"    bar y446-470

base = Image.fromarray(np.clip(px, 0, 255).astype("uint8"))


# --- 2. draw English text ---
def font(name, size, variation=None):
    f = ImageFont.truetype(str(FONTS / name), size * SS)
    if variation:
        f.set_variation_by_name(variation)
    return f


def stamp(runs, color, cx, cap_top, cap_h, max_w=None, blur=0.35):
    """runs: list of (text, font) drawn side by side, or ("•", font) for a bullet.
    Scales so capital height == cap_h px and total width <= max_w; centred on cx."""
    global base
    ref = runs[0][1]
    cap = ref.getbbox("H", anchor="ls")  # (.., -cap_height, .., 0) relative to baseline
    scale = cap_h * SS / (cap[3] - cap[1])
    widths = [f.getlength(t) for t, f in runs]
    total = sum(widths) * scale
    if max_w and total > max_w * SS:
        scale *= max_w * SS / total
        total = max_w * SS
    # render at the reference font size, then resize the layer by `scale`
    layer = Image.new("L", (int(sum(widths)) + 40 * SS, int(ref.size * 1.6)), 0)
    d = ImageDraw.Draw(layer)
    x, base_y = 20 * SS, int(ref.size * 1.15)  # shared baseline for all runs
    for (t, f), w in zip(runs, widths):
        d.text((x, base_y), t, font=f, fill=255, anchor="ls")
        x += w
    lw, lh = int(layer.width * scale), int(layer.height * scale)
    layer = layer.resize((lw, lh), Image.LANCZOS)
    cap_y = (base_y + cap[1]) * scale  # top of capitals inside the layer
    ox = cx * SS - (20 * SS * scale + total / 2)
    oy = cap_top * SS - cap_y
    full = Image.new("L", (W * SS, H * SS), 0)
    full.paste(layer, (int(round(ox)), int(round(oy))))
    mask = full.resize((W, H), Image.LANCZOS)
    if blur:
        mask = mask.filter(ImageFilter.GaussianBlur(blur))  # match the source's softness
    base = Image.composite(Image.new("RGB", (W, H), color), base, mask)


NAVY = (24, 60, 104)
LABEL = (238, 246, 255)

# Title: heavy sans, caps 26 px high (y15-40), centred like the original
stamp([("STRONG MAGNETS", font("segoeuib.ttf", 60))], NAVY, cx=242, cap_top=15, cap_h=25.5)

# Subtitle: calligraphic italic with round bullets, same band as original (y52-80)
corsiva = font("MTCORSVA.TTF", 60)
sub = [("Practical", corsiva), ("  •  ", font("segoeuib.ttf", 34)), ("Quiet", corsiva),
       ("  •  ", font("segoeuib.ttf", 34)), ("Effective", corsiva)]
stamp(sub, (32, 66, 110), cx=240, cap_top=54, cap_h=19, max_w=310, blur=0.25)

# Bar labels: bold condensed caps, 9 px high, centred in the 136-px bars
bar_font = lambda: font("bahnschrift.ttf", 60, "Bold SemiCondensed")
for text, top in (("QUICK OPENING!", 203.5), ("AUTOMATIC CLOSING!", 339.5), ("QUIET CLOSING!", 454.5)):
    stamp([(text, bar_font())], LABEL, cx=68, cap_top=top, cap_h=9.6, max_w=126, blur=0.3)

assert base.size == (W, H)
base.save(DST, "WEBP", quality=92, method=6)
print("saved", DST, base.size)
