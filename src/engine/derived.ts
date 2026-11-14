/**
 * The two metrics computed where they are read rather than stored.
 *
 * Both depend on the climate scenario being looked at, which is the whole
 * reason they are not columns: the platform learned this the hard way when
 * a stored pond temperature had tilapia scored against today's water on a
 * 2070 map, and the low-oxygen hazard that reads that metric could never
 * fire. See `App\Suitability\DerivedMetrics` for the full account.
 *
 * Ported arithmetic-for-arithmetic from `App\Suitability\WaterTemperature`
 * and `App\Suitability\ErosionExposure`.
 */

import type { Meta } from './types';

let waterTemp = { lapse_rate_c_per_km: 6.5, pond_warming_c: 1 };
let erosion = { reference_rkls: 100, structure_code: 3, slope_length_m: 50 };

export function configureDerived(suitability: Meta['suitability']): void {
    waterTemp = suitability.waterTemperature;
    erosion = suitability.erosion;
}

/* ------------------------------------------------------ pond temperature -- */

/**
 * Modelled pond water temperature, °C.
 *
 * The one metric this platform has to model rather than measure: no
 * satellite reports the temperature of a farm pond that does not exist yet.
 * Two relationships carry it — a shallow tropical pond sits about a degree
 * above mean air temperature, and air temperature falls with elevation, so
 * POWER's one figure for a 55 x 69 km cell is lapse-corrected to this cell's
 * own elevation from the 30 m DEM. Without that a pond at 400 m would be
 * modelled 2.6 °C warmer than it is.
 *
 * Null in, null out. A fabricated temperature judged as though it were
 * measured is the failure mode this guards against.
 */
export function pondTemperature(
    airTempC: number | null,
    cellElevationM: number | null,
    pointElevationM: number | null,
): number | null {
    if (airTempC === null || cellElevationM === null) {
        return null;
    }

    const lapse =
        (waterTemp.lapse_rate_c_per_km * (cellElevationM - (pointElevationM ?? 0))) / 1000;

    return round(airTempC - lapse + waterTemp.pond_warming_c, 2);
}

/* -------------------------------------------------------------- erosion -- */

/**
 * Soil erodibility, K, in SI units of t·ha·h/(ha·MJ·mm).
 *
 * Wischmeier and Smith's nomograph (1978) with three inputs this platform
 * cannot supply, each substituted where the PHP says so: very fine sand is
 * folded into silt, aggregate structure is a constant, and permeability is
 * read off the derived drainage class rather than measured. Organic matter
 * is carbon x 1.724 capped at 4%, because the nomograph is only defined to
 * there and on this district's peat the uncapped term goes negative — which
 * would read as soil that cannot erode.
 */
export function erodibility(
    sandPct: number | null,
    clayPct: number | null,
    organicCarbon: number | null,
    drainageClass: number | null,
): number | null {
    if (sandPct === null || clayPct === null || organicCarbon === null) {
        return null;
    }

    const silt = Math.max(0, 100 - sandPct - clayPct);
    const m = silt * (100 - clayPct);
    const om = Math.min(4, (organicCarbon / 10) * 1.724);
    const permeability = 7 - (drainageClass ?? 4);

    const us =
        (2.1e-4 * Math.pow(m, 1.14) * (12 - om) +
            3.25 * (erosion.structure_code - 2) +
            2.5 * (permeability - 3)) /
        100;

    return Math.max(0, us) * 0.1317;
}

/**
 * Combined slope length and steepness factor, LS, dimensionless. RUSLE's
 * form at the assumed slope length: the length exponent rises with
 * steepness, because runoff on a steep slope gains more from a longer run.
 */
export function slopeFactor(slopePct: number | null): number | null {
    if (slopePct === null) {
        return null;
    }

    const sin = Math.sin(Math.atan(slopePct / 100));
    const m = slopePct < 1 ? 0.2 : slopePct < 3 ? 0.3 : slopePct < 5 ? 0.4 : 0.5;

    return (
        Math.pow(erosion.slope_length_m / 22.13, m) * (65.41 * sin * sin + 4.56 * sin + 0.065)
    );
}

/**
 * Erosion exposure, 0 to 100: what the rain, the soil and the slope would do
 * to this ground if it were left bare.
 *
 * RUSLE with the cover factor C and the practice factor P left out — the two
 * a farmer controls. Leaving them out is the design: the question is what
 * the land brings to the problem before anybody decides what to grow.
 *
 * Deliberately an index and not tonnes per hectare. Erosivity comes from
 * monthly totals through the Modified Fournier Index rather than from storm
 * intensity, erodibility substitutes three nomograph inputs, and slope
 * length is assumed. Any one of those makes an absolute tonnage a number
 * with a decimal point and no meaning; what survives all three is the
 * comparison, so the scale is fixed against a reference rather than
 * normalised to whatever is in view.
 */
export function erosionExposure(
    rainfallErosivity: number | null,
    slopePct: number | null,
    sandPct: number | null,
    clayPct: number | null,
    organicCarbon: number | null,
    drainageClass: number | null,
): number | null {
    const k = erodibility(sandPct, clayPct, organicCarbon, drainageClass);
    const ls = slopeFactor(slopePct);

    if (rainfallErosivity === null || k === null || ls === null) {
        return null;
    }

    const raw = rainfallErosivity * k * ls;

    if (raw >= erosion.reference_rkls) {
        return 100;
    }

    return round((raw / erosion.reference_rkls) * 100, 1);
}

/* -------------------------------------------------------------- the THI -- */

/**
 * Temperature-humidity index, NRC (1971).
 *
 * A dry-bulb heat threshold is useless in equatorial Borneo: daily maxima
 * sit near 29 °C and never cross the usual 35 °C line, so a heat-stress
 * counter reads zero everywhere and discriminates nothing. But 29 °C at 90%
 * humidity is genuinely dangerous — evaporative cooling stops working,
 * cattle stop gaining weight, and a pond holds far less dissolved oxygen.
 */
export function thi(tempMaxC: number | null, relativeHumidity: number | null): number | null {
    if (tempMaxC === null) {
        return null;
    }

    const rh = relativeHumidity ?? 80;

    return 1.8 * tempMaxC + 32 - (0.55 - 0.0055 * rh) * (1.8 * tempMaxC - 26);
}

function round(value: number, places: number): number {
    const factor = Math.pow(10, places);

    return Math.round(value * factor) / factor;
}
