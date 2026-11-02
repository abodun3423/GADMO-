"""Generates GADMO's PWA icons (run once; the PNGs are committed).

Adire indigo square with a light dot-and-ring pattern and a white "G".
Usage: python3 apps/web/scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

INDIGO = (31, 42, 107, 255)
DOT = (255, 255, 255, 46)
RING = (255, 255, 255, 26)
WHITE = (255, 255, 255, 255)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def icon(size: int, letter_scale: float, rounded: bool) -> Image.Image:
    scale = 4  # draw large, then shrink for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    layer = Image.new("RGBA", (s, s), INDIGO)
    pattern = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(pattern)
    step = s // 8
    for row in range(-1, 10):
        for col in range(-1, 10):
            cx = col * step + (step // 2 if row % 2 else 0)
            cy = row * step
            r = step // 9
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DOT)
            rr = step // 3
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=RING, width=max(2, step // 22))
    layer = Image.alpha_composite(layer, pattern)

    font = ImageFont.truetype(FONT, int(s * letter_scale))
    draw = ImageDraw.Draw(layer)
    box = draw.textbbox((0, 0), "G", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(((s - w) / 2 - box[0], (s - h) / 2 - box[1]), "G", font=font, fill=WHITE)

    mask = Image.new("L", (s, s), 0)
    if rounded:
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    else:
        mask = Image.new("L", (s, s), 255)
    img.paste(layer, (0, 0), mask)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon(192, 0.62, True).save(OUT / "icon-192.png", optimize=True)
    icon(512, 0.62, True).save(OUT / "icon-512.png", optimize=True)
    # Maskable: full bleed, letter inside the 80% safe zone.
    icon(512, 0.46, False).save(OUT / "maskable-512.png", optimize=True)
    icon(180, 0.52, False).save(OUT / "apple-touch-icon.png", optimize=True)
    print("Icons written to", OUT)


if __name__ == "__main__":
    main()
