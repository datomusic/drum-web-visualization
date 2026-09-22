#!/usr/bin/env python3
"""
Annotate the DUO faceplate SVG (a Figma export without IDs) with semantic IDs
and classes, then inline it into test.html.

    python3 annotate-svg.py [duo-faceplate.svg]

Elements are recognised by shape, fill and position. Writes
duo-faceplate-annotated.svg and replaces the SVG between the
<!-- faceplate:start --> / <!-- faceplate:end --> markers in test.html.

The DUO is played from two sides: the synth half (top of the drawing) is
drawn upside down for the second player.

IDs produced (the contract with js/controls.js):
  btn-crush, btn-delay, btn-accent, btn-glide, btn-random, btn-boost
  knob-amp, knob-detune, knob-res, knob-speed, knob-length   (<g>: body + pointer)
  slider-release, slider-freq, slider-wave                   (<g>: handle)
  slider-release-track, slider-freq-track, slider-wave-track
  key-0 … key-9     (<g>: rim + .key-face), left to right
  step-1 … step-8   clockwise from top left (unverified against firmware order)
  play-outer, play-ring, play-icon
  arrow-down (left), arrow-up (right)
"""

import os
import re
import sys
import xml.etree.ElementTree as ET

SVG_NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG_NS)
Q = lambda tag: f'{{{SVG_NS}}}{tag}'

BUTTONS = {  # (fill, left/right) → id
    ('#00B400', 'L'): 'btn-crush',  ('#00B400', 'R'): 'btn-delay',
    ('#0084FF', 'L'): 'btn-accent', ('#0084FF', 'R'): 'btn-glide',
    ('#FFF000', 'L'): 'btn-random', ('#FFF000', 'R'): 'btn-boost',
}
KNOBS = {  # approximate centre → id
    (459, 650): 'knob-amp', (1458, 650): 'knob-detune', (958, 253): 'knob-res',
    (459, 1422): 'knob-speed', (1458, 1422): 'knob-length',
}
SLIDERS = {738.5: 'slider-release', 943.5: 'slider-freq', 1148.5: 'slider-wave'}
PLAY_CENTER = (958.5, 1422.5)
MID_X = 960


def num(el, attr):
    return float(el.get(attr))


def path_start(el):
    m = re.match(r'M\s*([-\d.]+)[ ,]([-\d.]+)', el.get('d', ''))
    return (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)


def nearest(table, x, y):
    key = min(table, key=lambda k: (k[0] - x) ** 2 + (k[1] - y) ** 2)
    return table[key]


def set_id(el, id_, cls=None):
    el.set('id', id_)
    if cls:
        el.set('class', cls)


def annotate(src, dst):
    tree = ET.parse(src)
    root = tree.getroot()
    children = list(root)
    out = []
    steps = []
    keys = []
    i = 0
    while i < len(children):
        el = children[i]
        tag = el.tag.replace(f'{{{SVG_NS}}}', '')
        fill = (el.get('fill') or '').upper()
        nxt = children[i + 1] if i + 1 < len(children) else None

        if tag == 'ellipse' and (fill, 'L' if num(el, 'cx') < MID_X else 'R') in BUTTONS:
            set_id(el, BUTTONS[(fill, 'L' if num(el, 'cx') < MID_X else 'R')], 'control button')

        elif tag == 'circle' and el.get('r') == '30' and nxt is not None and nxt.tag == Q('line'):
            # Knob: body circle + pointer line → one rotatable group
            g = ET.Element(Q('g'), {'id': nearest(KNOBS, num(el, 'cx'), num(el, 'cy')), 'class': 'control knob'})
            g.extend([el, nxt])
            out.append(g)
            i += 2
            continue

        elif tag == 'circle' and el.get('r') == '55':
            steps.append(el)
            el.set('class', 'control step')

        elif tag == 'circle' and el.get('r') == '100':
            set_id(el, 'play-outer', 'control play')
        elif tag == 'circle' and el.get('r') == '72':
            set_id(el, 'play-ring')
        elif tag == 'path' and fill == 'BLACK' and abs(path_start(el)[0] - 942.5) < 1:
            set_id(el, 'play-icon')

        elif tag == 'path' and fill == '#FF0000':
            set_id(el, 'arrow-down' if path_start(el)[0] < MID_X else 'arrow-up', 'control arrow')

        elif tag == 'path' and fill == '#D9D9D9' and nxt is not None and (nxt.get('fill') or '').lower() == 'black':
            # Key: grey rim + black face → one group
            nxt.set('class', 'key-face')
            g = ET.Element(Q('g'), {'class': 'control key'})
            g.extend([el, nxt])
            keys.append((path_start(el)[0], g))
            out.append(g)
            i += 2
            continue

        elif tag == 'rect' and el.get('width') == '30' and el.get('height') == '550':
            set_id(el, SLIDERS[num(el, 'x')] + '-track', 'slider-track')
            # The next two rects (grey body, red mark) are the handle
            handle = children[i + 1:i + 3]
            g = ET.Element(Q('g'), {'id': SLIDERS[num(el, 'x')], 'class': 'control slider'})
            g.extend(handle)
            out.extend([el, g])
            i += 3
            continue

        out.append(el)
        i += 1

    # Keys left to right; steps clockwise from top left around the play button
    for n, (_, g) in enumerate(sorted(keys, key=lambda k: k[0])):
        g.set('id', f'key-{n}')
    import math
    cx, cy = PLAY_CENTER
    def clockwise(el):
        a = math.atan2(num(el, 'cy') - cy, num(el, 'cx') - cx)  # screen coords: y down
        return (a + math.pi / 2 + math.radians(30)) % (2 * math.pi)  # start just left of top
    for n, el in enumerate(sorted(steps, key=clockwise)):
        el.set('id', f'step-{n + 1}')

    for el in list(root):
        root.remove(el)
    root.extend(out)
    # Size comes from CSS; keep the viewBox
    for attr in ('width', 'height'):
        root.attrib.pop(attr, None)
    tree.write(dst, encoding='unicode')
    print(f'Wrote {dst}')
    return ET.tostring(root, encoding='unicode')


def inline(html_path, svg_text):
    with open(html_path, encoding='utf-8') as f:
        html = f.read()
    start, end = '<!-- faceplate:start -->', '<!-- faceplate:end -->'
    a, b = html.find(start), html.find(end)
    if a < 0 or b < 0:
        sys.exit(f'{html_path}: faceplate markers not found')
    html = html[:a + len(start)] + '\n' + svg_text + '\n    ' + html[b:]
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'Inlined into {html_path}')


if __name__ == '__main__':
    base = os.path.dirname(os.path.abspath(__file__))
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base, 'duo-faceplate.svg')
    svg = annotate(src, os.path.join(base, 'duo-faceplate-annotated.svg'))
    inline(os.path.join(base, 'test.html'), svg)
