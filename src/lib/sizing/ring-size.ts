// US ring size from inner diameter, via inner circumference.
// Formula and reference points sourced from 25karats.com / Angara.com ring-size
// guides during design (2026-08-15): US size = (circumference_mm - 36.5) / 2.55.
// Validated against a real known US 7.5 ring: averaging widest (18.3mm) and
// narrowest (16.5mm) readings on an asymmetric band gives 17.4mm -> ~7.1,
// within half a size of the true 7.5 -- single-point readings alone are
// meaningfully off (see test file), which is why irregular-band rings need
// two readings (detectIrregularRingStyle in ../jewelry-detection.ts).
export function ringDiameterMmToUsSize(diameterMm: number): number {
  if (!Number.isFinite(diameterMm) || diameterMm < 12 || diameterMm > 24) {
    throw new Error(`Implausible ring diameter: ${diameterMm}mm (expected roughly 12-24mm)`)
  }
  const circumferenceMm = Math.PI * diameterMm
  return (circumferenceMm - 36.5) / 2.55
}
