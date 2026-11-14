/**
 * Turns raw SoilGrids properties into the things a farmer and the model
 * actually use.
 *
 * SoilGrids reports what the soil is made of. It does not report what that
 * means: whether the ground drains, how much water it can hold through a dry
 * spell, or whether it is peat. Those are the three facts the envelopes score
 * against, so they are derived here with the standard agronomic
 * relationships, each one named so the derivation can be checked.
 *
 * A port of `App\Geo\Soil\SoilDeriver`. In the district this is not run — the
 * exported grid already carries the derived columns. It runs for a point
 * outside the snapshot, where SoilGrids answers over the open REST API and
 * nobody has derived anything yet.
 */

export const TEXTURE_CLASSES: Record<number, string> = {
    1: 'Clay',
    2: 'Silty clay',
    3: 'Sandy clay',
    4: 'Clay loam',
    5: 'Silty clay loam',
    6: 'Sandy clay loam',
    7: 'Loam',
    8: 'Silt loam',
    9: 'Silt',
    10: 'Sandy loam',
    11: 'Loamy sand',
    12: 'Sand',
};

/**
 * USDA natural drainage classes. The scale is ordered, which is what lets
 * the engine score it on a numeric envelope.
 */
export const DRAINAGE_CLASSES: Record<number, string> = {
    1: 'Very poorly drained',
    2: 'Poorly drained',
    3: 'Somewhat poorly drained',
    4: 'Moderately well drained',
    5: 'Well drained',
    6: 'Somewhat excessively drained',
    7: 'Excessively drained',
};

/**
 * Plant-available water capacity by texture, mm of water per metre of soil.
 * Mid-range values from the FAO guidance, adjusted for organic matter below.
 */
const AWC_BY_TEXTURE: Record<number, number> = {
    1: 160, // Clay — holds a lot, much of it too tightly to release
    2: 165, // Silty clay
    3: 150, // Sandy clay
    4: 180, // Clay loam
    5: 195, // Silty clay loam
    6: 145, // Sandy clay loam
    7: 180, // Loam — the best balance
    8: 205, // Silt loam — the highest of all
    9: 190, // Silt
    10: 130, // Sandy loam
    11: 95, // Loamy sand
    12: 70, // Sand
};

/**
 * USDA soil texture triangle.
 *
 * The standard decision tree rather than a point-in-polygon test, because the
 * published class boundaries are themselves defined as inequalities and this
 * way the code can be checked against the textbook line by line.
 */
export function textureClass(
    clay: number | null,
    silt: number | null,
    sand: number | null,
): number | null {
    if (clay === null || silt === null || sand === null) {
        return null;
    }

    const total = clay + silt + sand;

    if (total <= 0) {
        return null;
    }

    // SoilGrids fractions can sum slightly off 100.
    const c = (clay / total) * 100;
    const si = (silt / total) * 100;
    const sa = (sand / total) * 100;

    if (si + 1.5 * c < 15) return 12; // Sand
    if (si + 1.5 * c >= 15 && si + 2 * c < 30) return 11; // Loamy sand

    if (c >= 40 && si >= 40) return 2; // Silty clay
    if (c >= 35 && sa >= 45) return 3; // Sandy clay
    if (c >= 40) return 1; // Clay

    if (c >= 27 && c < 40 && sa <= 20) return 5; // Silty clay loam
    if (c >= 27 && c < 40 && sa > 20 && sa <= 45) return 4; // Clay loam

    if (c >= 20 && c < 35 && si < 28 && sa > 45) return 6; // Sandy clay loam

    if (si >= 80 && c < 12) return 9; // Silt
    if (si >= 50 && c < 27) return 8; // Silt loam

    if (c >= 7 && c < 27 && si >= 28 && si < 50 && sa <= 52) return 7; // Loam

    // Everything remaining is sandy: the sandy loam wedge.
    return 10;
}

/**
 * Natural drainage class, 1 (very poorly drained) to 7 (excessively).
 *
 * SoilGrids does not publish drainage, so it is inferred from the three
 * things that actually govern it: how coarse the soil is, how compacted it
 * is, and whether the ground sheds water. Slope is included because it
 * genuinely matters — the same clay drains very differently on a ridge and in
 * a hollow — and null where no DEM reached this point.
 */
export function drainageClass(
    texture: number | null,
    bulkDensity: number | null,
    slopePct: number | null,
    organicCarbon: number | null,
): number | null {
    if (texture === null) {
        return null;
    }

    // Baseline from texture: coarse drains freely, fine does not.
    let score =
        {
            12: 7,
            11: 6,
            10: 5.5,
            6: 5,
            7: 5,
            8: 4.5,
            9: 4,
            4: 4,
            5: 3.5,
            3: 3,
            2: 2.5,
            1: 2,
        }[texture] ?? 4;

    // Compaction closes the pores that drainage depends on.
    if (bulkDensity !== null) {
        if (bulkDensity >= 1.6) score -= 1;
        else if (bulkDensity >= 1.4) score -= 0.5;
        else if (bulkDensity < 1.1) score += 0.5;
    }

    // Slope sheds water; flat ground holds it.
    if (slopePct !== null) {
        if (slopePct >= 25) score += 1;
        else if (slopePct >= 12) score += 0.5;
        else if (slopePct >= 4) score += 0;
        else if (slopePct >= 1.5) score -= 0.5;
        else score -= 1;
    }

    // Very high organic carbon means peat, which stays saturated.
    if (organicCarbon !== null && organicCarbon > 120) {
        score -= 2;
    }

    return Math.max(1, Math.min(7, Math.round(score)));
}

/**
 * Plant-available water capacity, mm per metre of soil depth.
 *
 * The farm's buffer against a dry spell: with 180 mm/m and a half-metre root
 * zone, a crop has about 90 mm to live on before it needs rain. Organic
 * matter raises it noticeably, which is the mechanism behind most soil-health
 * advice.
 */
export function availableWaterCapacity(
    texture: number | null,
    organicCarbon: number | null,
    bulkDensity: number | null = null,
): number | null {
    // Organic soils are a different material, not a mineral soil with a
    // bonus. Over the Sri Aman floodplain more than three quarters of cells
    // are organic, so treating peat as "clay plus extra" would make this
    // metric nearly constant across the district and useless for telling one
    // site from another.
    if (organicCarbon !== null && organicCarbon >= 120) {
        // Peat holds a great deal of water in total but releases less of it.
        // Fibric (undecomposed, low bulk density) peat holds more total and
        // releases proportionally less; sapric peat releases more.
        let awc = 190;

        if (bulkDensity !== null) {
            awc += (bulkDensity - 0.25) * 120;
        }

        return round(Math.max(120, Math.min(280, awc)), 1);
    }

    if (texture === null) {
        return null;
    }

    let awc = AWC_BY_TEXTURE[texture] ?? 150;

    if (organicCarbon !== null) {
        // Proportional rather than additive, so differences between textures
        // survive the adjustment instead of being swamped by a saturating
        // bonus. Capped at +30%, about the most organic matter can plausibly
        // add to a mineral soil.
        awc *= 1 + Math.min(0.3, Math.max(-0.05, (organicCarbon - 15) / 350));
    }

    return round(Math.max(40, Math.min(300, awc)), 1);
}

/**
 * Indicative peat depth in centimetres.
 *
 * SoilGrids does not map peat depth, so this is an INDICATOR derived from
 * topsoil organic carbon, not a measurement. Tropical mineral soils here run
 * about 10–40 g/kg; a histosol runs into the hundreds. The bands are
 * deliberately coarse and conservative, because the decision they inform —
 * whether to drain — is consequential: drained peat subsides about 5 cm a
 * year and oxidises irreversibly. A farmer told "deep peat indicated" should
 * auger the site, and the UI says so.
 */
export function peatDepthIndicator(organicCarbon: number | null): number | null {
    if (organicCarbon === null) {
        return null;
    }

    if (organicCarbon < 80) return 0;
    if (organicCarbon < 120) return 20;
    if (organicCarbon < 200) return 60;
    if (organicCarbon < 300) return 120;

    return 200;
}

/**
 * USDA hydrologic soil group (A–D), which sets the runoff curve number a
 * drainage design would need.
 */
export function hydrologicGroup(
    texture: number | null,
    drainage: number | null,
): string | null {
    if (texture === null) {
        return null;
    }

    let group =
        {
            12: 'A',
            11: 'A',
            10: 'B',
            6: 'B',
            7: 'B',
            8: 'B',
            9: 'B',
            4: 'C',
            5: 'C',
            1: 'D',
            2: 'D',
            3: 'D',
        }[texture] ?? 'C';

    // Poor drainage pushes a soil into a wetter group regardless of its
    // texture, because a saturated profile cannot absorb a storm.
    if (drainage !== null && drainage <= 2) {
        return 'D';
    }

    if (drainage !== null && drainage === 3 && (group === 'A' || group === 'B')) {
        group = 'C';
    }

    return group;
}

export function textureName(value: number | null): string | null {
    return value === null ? null : (TEXTURE_CLASSES[Math.round(value)] ?? null);
}

export function drainageName(value: number | null): string | null {
    return value === null ? null : (DRAINAGE_CLASSES[Math.round(value)] ?? null);
}

/**
 * Land cover, in the codes the platform stores.
 *
 * MODIS MCD12Q1 is read in IGBP classes and mapped on ingest to the ESA
 * WorldCover numbering, so one vocabulary covers both products and the
 * envelopes do not have to be rewritten if the source ever changes. This is
 * the metric that decides what is permanently off limits — open water,
 * built-up ground — so getting a code wrong here turns an honest "look
 * elsewhere" into a wrong one.
 */
export const LAND_COVER_NAMES: Record<number, string> = {
    10: 'Tree cover',
    20: 'Shrubland',
    30: 'Grassland',
    40: 'Cropland',
    50: 'Built-up',
    60: 'Bare or sparse',
    70: 'Snow and ice',
    80: 'Water',
    90: 'Herbaceous wetland',
    95: 'Mangrove',
};

export function landCoverName(value: number | null): string | null {
    return value === null ? null : (LAND_COVER_NAMES[Math.round(value)] ?? `Class ${value}`);
}

function round(value: number, places: number): number {
    const factor = Math.pow(10, places);

    return Math.round(value * factor) / factor;
}
