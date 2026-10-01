"""Median colour of each bear from rim to core, in bands relative to its height.

Usage: python3 tools/color-bands.py IMAGE  (e.g. tools/reference/goldbears.png,
or /tmp/jelly-render.png written by tools/compare.mjs). Compare the two outputs
to fit COLORWAYS in src/render/jellyMaterials.js: rims set the tint, cores the
absorption (work the ratios in linear light).
"""
import json
import sys

import cv2
import numpy as np

bgr = cv2.imread(sys.argv[1])
hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
sat = hsv[..., 1].astype(float) / 255
m = (sat > 0.3).astype(np.uint8) * 255
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
n, lab, st, _ = cv2.connectedComponentsWithStats(m)
bears = sorted([i for i in range(1, n) if st[i][4] > 20000], key=lambda i: st[i][0])
rgb = bgr[..., ::-1].astype(float)
out = {}
for name, i in zip(['left', 'right'], bears):
    b = (lab == i).astype(np.uint8)
    ff = b.copy() * 255
    cv2.floodFill(ff, np.zeros((b.shape[0] + 2, b.shape[1] + 2), np.uint8), (0, 0), 255)
    b = ((b * 255) | cv2.bitwise_not(ff)) > 0
    inside = cv2.distanceTransform(b.astype(np.uint8), cv2.DIST_L2, 5)
    H = st[i][3]
    res = {}
    for label, lo, hi in [('rim', 0, 0.01), ('edge', 0.01, 0.035), ('mid', 0.07, 0.14), ('core', 0.14, 1)]:
        sel = (inside > lo * H) & (inside <= hi * H)
        res[label] = np.median(rgb[sel], axis=0).round().astype(int).tolist()
    out[name] = res
print(json.dumps(out))
