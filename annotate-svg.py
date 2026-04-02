"""
annotate-svg.py
One-time script to add semantic IDs and classes to the raw Dato DRUM SVG.
Identifies elements by fill color and position relative to the center (1105, 1105).
Outputs dato-drum-faceplate-annotated.svg.
"""

import re
import math
from xml.etree import ElementTree as ET

SVG_NS = 'http://www.w3.org/2000/svg'
XLINK_NS = 'http://www.w3.org/1999/xlink'
SERIF_NS = 'http://www.serif.com/'
CENTER = (1105.0, 1105.0)

ET.register_namespace('', SVG_NS)
ET.register_namespace('xlink', XLINK_NS)
ET.register_namespace('serif', SERIF_NS)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_fill(elem):
    style = elem.get('style', '')
    m = re.search(r'fill:([^;]+)', style)
    return m.group(1).strip() if m else elem.get('fill', 'none')


def path_abs_centroid(d):
    """Centroid from absolute M/L commands only (ignores relative offsets)."""
    coords = re.findall(r'[ML]\s*([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)', d)
    if not coords:
        m = re.search(r'M\s*([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)', d)
        if m:
            return float(m.group(1)), float(m.group(2))
        return 0.0, 0.0
    xs = [float(c[0]) for c in coords]
    ys = [float(c[1]) for c in coords]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def polar(elem):
    """Return (distance, angle_deg) from CENTER for an element."""
    tag = elem.tag.split('}')[-1]
    if tag == 'circle':
        cx, cy = float(elem.get('cx', 0)), float(elem.get('cy', 0))
    else:
        cx, cy = path_abs_centroid(elem.get('d', ''))
    dx, dy = cx - CENTER[0], cy - CENTER[1]
    return math.hypot(dx, dy), math.degrees(math.atan2(dy, dx))


def is_circular_path(d):
    """True if path is a 4-arc bezier circle (4 cubic curves, no lines)."""
    curves = len(re.findall(r'[cC]', d))
    lines  = len(re.findall(r'[lL]', d))
    return curves == 4 and lines == 0


def set_attr(elem, id_val, class_val):
    elem.set('id', id_val)
    existing_classes = set(elem.get('class', '').split())
    new_classes = set(class_val.split())
    elem.set('class', ' '.join(sorted(existing_classes | new_classes)))


# ---------------------------------------------------------------------------
# Angle-based track assignment (top-left=1, top-right=2, bottom-right=3, bottom-left=4)
# Angles: TL≈-135°, TR≈-45°, BR≈45°, BL≈135°
# ---------------------------------------------------------------------------

def track_from_angle(angle):
    """Map diagonal angle to track number 1-4."""
    # Normalise to -180..180
    a = angle % 360
    if a > 180:
        a -= 360
    if -180 <= a < -90:
        return 1   # top-left
    elif -90 <= a < 0:
        return 2   # top-right
    elif 0 <= a < 90:
        return 3   # bottom-right
    else:
        return 4   # bottom-left


# ---------------------------------------------------------------------------
# Main annotation logic
# ---------------------------------------------------------------------------

def annotate(input_path, output_path):
    tree = ET.parse(input_path)
    root = tree.getroot()

    all_elements = list(root.iter())

    # ---- Buckets ----
    ddd_paths = []    # step LEDs
    circles = []      # play button
    pad_groups = []   # drum pad <g> elements
    sample_selects = []  # sample select arrow buttons

    SERIF_ID = f'{{{SERIF_NS}}}id'

    for elem in all_elements:
        tag = elem.tag.split('}')[-1]
        fill = get_fill(elem)
        dist, angle = polar(elem)

        if tag == 'circle':
            circles.append(elem)

        elif tag == 'g':
            # Drum pads: serif:id="drumpad" (or plain id="drumpad" on the first one)
            if elem.get(SERIF_ID) == 'drumpad' or elem.get('id') == 'drumpad':
                # polar() can't handle <g>; use centroid of first path child
                first_path = next(
                    (c for c in elem if c.tag.split('}')[-1] == 'path'), None
                )
                if first_path is not None:
                    g_dist, g_angle = polar(first_path)
                else:
                    g_dist, g_angle = dist, angle
                pad_groups.append((elem, g_dist, g_angle))

        elif tag == 'path':
            # --- Sample select buttons (IDs already set in source SVG) ---
            existing_id = elem.get('id', '')
            if re.match(r'^select-[1-4]-(up|down)$', existing_id):
                existing_classes = set(elem.get('class', '').split())
                elem.set('class', ' '.join(sorted(existing_classes | {'control', 'sample-select'})))
                sample_selects.append(existing_id)

            # --- Uniquely coloured controls ---
            if fill == '#f00':
                set_attr(elem, 'btn-repeat', 'control button')

            elif fill == '#fff000':
                set_attr(elem, 'btn-random', 'control button')

            elif fill == '#00b400':
                set_attr(elem, 'btn-crush', 'control button')

            elif fill == '#0084ff':
                set_attr(elem, 'btn-filter', 'control button')

            elif fill == '#414141':
                # Four knob-indicator tick-marks, one per diagonal quadrant
                ddd_paths.append(('indicator', elem, dist, angle))

            elif fill == '#fff':
                if 400 < dist < 500:
                    # Per-track pitch knobs (one per quadrant, dist≈435)
                    ddd_paths.append(('pitch_knob', elem, dist, angle))
                # else: structural decoration (octagon body, etc.)

            elif fill == '#ddd':
                if is_circular_path(elem.get('d', '')):
                    ddd_paths.append(('led', elem, dist, angle))

    # ---- Assign play button circles (sorted by radius descending) ----
    circles.sort(key=lambda e: float(e.get('r', 0)), reverse=True)
    for i, c in enumerate(circles):
        label = 'play-outer' if i == 0 else 'play-inner'
        set_attr(c, label, 'control play-btn')

    # ---- Knob indicators: sorted by angle → assign to tracks ----
    indicators = [(e, d, a) for kind, e, d, a in ddd_paths if kind == 'indicator']
    indicators.sort(key=lambda x: x[2])  # sort by angle
    # angles: -136° (TL/track1), -46° (TR/track2), 44° (BR/track3), 134° (BL/track4)
    for e, d, a in indicators:
        t = track_from_angle(a)
        set_attr(e, f'pitch-indicator-{t}', 'knob-indicator')

    # ---- Pitch knobs (white, dist≈435): same quadrant mapping ----
    pitch_knobs = [(e, d, a) for kind, e, d, a in ddd_paths if kind == 'pitch_knob']
    for e, d, a in pitch_knobs:
        t = track_from_angle(a)
        set_attr(e, f'pitch-knob-{t}', 'control knob pitch-knob')

    # ---- Drum pads: <g serif:id="drumpad"> groups, one per quadrant ----
    for e, d, a in pad_groups:
        t = track_from_angle(a)
        set_attr(e, f'pad-{t}', 'control pad')

    # ---- Step LEDs: sort by polar angle, assign sequential IDs ----
    leds = [(e, d, a) for kind, e, d, a in ddd_paths if kind == 'led']

    # Sort ring LEDs by polar angle (-180→+180)
    leds.sort(key=lambda x: x[2])

    for i, (e, d, a) in enumerate(leds):
        set_attr(e, f'step-{i:02d}', 'step-led')

    # Write output
    # ElementTree strips the XML declaration; add it back manually
    tree.write(output_path, xml_declaration=True, encoding='UTF-8')

    # ---- Verify sample select buttons ----
    expected_selects = {f'select-{t}-{d}' for t in range(1, 5) for d in ('up', 'down')}
    found_selects = set(sample_selects)
    missing_selects = expected_selects - found_selects
    extra_selects = found_selects - expected_selects

    print(f"Annotated SVG written to: {output_path}")
    print(f"  Play button circles: {len(circles)}")
    print(f"  Pitch indicators:    {len(indicators)}")
    print(f"  Pitch knobs:         {len(pitch_knobs)}")
    print(f"  Drum pads:           {len(pad_groups)}")
    print(f"  Step LEDs:           {len(leds)}")
    status = "OK" if len(sample_selects) == 8 and not missing_selects else "INCOMPLETE"
    print(f"  Sample selects:      {len(sample_selects)}/8 [{status}]")
    for sid in sorted(found_selects):
        print(f"    found:   {sid}")
    if missing_selects:
        for sid in sorted(missing_selects):
            print(f"    MISSING: {sid}")
    if extra_selects:
        for sid in sorted(extra_selects):
            print(f"    EXTRA:   {sid}")


def inline_svg(html_path, svg_path):
    with open(svg_path, 'r', encoding='UTF-8') as f:
        svg_content = f.read().strip()
    # Strip the XML declaration if present (not valid inside HTML)
    svg_content = re.sub(r'<\?xml[^?]*\?>\s*', '', svg_content)
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()
    new_html, count = re.subn(r'<svg\b.*?</svg>', svg_content, html, count=1, flags=re.DOTALL)
    if count == 0:
        print("Warning: no <svg> found in index.html — skipping inline step")
        return
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(new_html)
    print(f"index.html updated.")


if __name__ == '__main__':
    import os
    import sys
    base = os.path.dirname(os.path.abspath(__file__))
    if len(sys.argv) < 2:
        print("Usage: python3 annotate-svg.py <input.svg>", file=sys.stderr)
        sys.exit(1)
    svg_in = sys.argv[1]
    svg_out = os.path.join(base, 'dato-drum-faceplate-annotated.svg')
    annotate(svg_in, svg_out)
    inline_svg(
        os.path.join(base, 'index.html'),
        svg_out,
    )
