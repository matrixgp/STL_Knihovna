# Vygeneruje app.ico (a wwwroot/favicon.ico) – zelená dlaždice s kostkou, stejné jako logo v hlavičce.
from PIL import Image, ImageDraw
import sys, os
S = 1024
k = S / 24
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(6 * k), fill=(47, 210, 123, 255))
dark = (6, 20, 12, 255)
pts = [(12, 5), (19, 9), (19, 16), (12, 20), (5, 16), (5, 9)]
P = lambda p: (p[0] * k, p[1] * k)
w = int(2.1 * k)
poly = [P(p) for p in pts]
d.line(poly + [poly[0]], fill=dark, width=w, joint='curve')
for a, b in [((12, 12), (5, 9)), ((12, 12), (19, 9)), ((12, 12), (12, 20))]:
    d.line([P(a), P(b)], fill=dark, width=w)
for p in poly + [P((12, 12))]:
    d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=dark)
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
img.save(os.path.join(root, 'app.ico'), sizes=sizes)
img.save(os.path.join(root, 'wwwroot', 'favicon.ico'), sizes=sizes)
img.resize((256, 256), Image.LANCZOS).save('/tmp/icon_preview.png')
print('ico OK')
