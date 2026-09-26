import math, sys
from PIL import Image, ImageDraw
src = Image.open(sys.argv[1]).convert('RGB'); W = src.size[0]; S = W / 512.0
px = src.load()
t = 6 * S                 # iç karenin çerçeve çizgisinden içeri pay
r = (143 - 6) * S         # iç karenin köşe yarıçapı (çerçeve payı düşülmüş)
lo, hi = t + r, (W - 1) - t - r
out = src.copy(); po = out.load()
def inside(x, y):
    cx = min(max(x, lo), hi); cy = min(max(y, lo), hi)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and t <= x <= W - 1 - t and t <= y <= W - 1 - t
for y in range(W):
    for x in range(W):
        if inside(x, y): continue
        cx = min(max(x, lo), hi); cy = min(max(y, lo), hi)
        dx, dy = x - cx, y - cy; d = math.hypot(dx, dy)
        rr = r - 3 * S
        if d == 0: sx, sy = cx, cy
        else: sx, sy = cx + dx / d * rr, cy + dy / d * rr
        po[x, y] = px[int(round(min(max(sx, 0), W - 1))), int(round(min(max(sy, 0), W - 1)))]
out.convert('RGBA').save(sys.argv[2])   # Play 32 bit PNG (alfa kanallı) ister
# Play önizlemesi: %20 yarıçaplı maske, beyaz zemin üzerinde
m = Image.new('L', (W, W), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, W - 1, W - 1), radius=int(W * 0.2), fill=255)
prev = Image.new('RGB', (W, W), (255, 255, 255)); prev.paste(out, (0, 0), m); prev.save(sys.argv[3])
