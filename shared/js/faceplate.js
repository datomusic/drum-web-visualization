/**
 * faceplate.js
 * Moves a faceplate control (inlined SVG) to reflect a CC value. Shared by every
 * instrument; each instrument's controls.js describes its controls as:
 *
 *   { id, type, indicatorId?, pressure?, dir?, travel? }
 * type:
 *   'button'  — .pressed while value > 0 (with --cc-pressure if `pressure`)
 *   'knob'    — rotates indicatorId (or id itself) -135°…+135° over 0–127
 *   'slider'  — translates both id and indicatorId along dir by ±travel SVG units
 */

/**
 * Map a CC value (0-127) to a CSS rotation angle in degrees.
 * 0 → -135°, 64 → 0°, 127 → +135°
 */
export function ccToRotation(value) {
  return ((value / 127) * 270) - 135;
}

/**
 * Map a CC value (0-127) to a signed translation offset in SVG user units.
 * 0 → -travel, 64 → ~0, 127 → +travel
 * Multiply by ctrl.dir to get (tx, ty).
 */
export function ccToTranslation(value, travel) {
  return ((value / 127) * 2 - 1) * travel;
}

export function applyCC(ctrl, value) {
  const el = document.getElementById(ctrl.id);

  if (ctrl.type === 'button') {
    if (ctrl.pressure && el) {
      el.style.setProperty('--cc-pressure', value / 127);
    }
    el?.classList.toggle('pressed', value > 0);

  } else if (ctrl.type === 'knob') {
    const deg = ccToRotation(value);
    if (el) el.dataset.ccValue = value;
    const rotTarget = ctrl.indicatorId
      ? document.getElementById(ctrl.indicatorId)
      : el;
    if (rotTarget) {
      const bbox = rotTarget.getBBox();
      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;
      rotTarget.style.transformOrigin = `${cx}px ${cy}px`;
      rotTarget.style.transform = `rotate(${deg}deg)`;
    }

  } else if (ctrl.type === 'slider') {
    const offset = ccToTranslation(value, ctrl.travel);
    const tx = offset * ctrl.dir[0];
    const ty = offset * ctrl.dir[1];
    const transform = `translate(${tx}px, ${ty}px)`;
    const indicator = document.getElementById(ctrl.indicatorId);
    if (indicator) indicator.style.transform = transform;
    if (el) el.style.transform = transform;
  }
}
