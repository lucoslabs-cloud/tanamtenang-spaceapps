/**
 * FAO-56 Penman-Monteith reference evapotranspiration.
 *
 * ET₀ is the demand side of the water budget: how much water a reference
 * grass crop would lose to the air in a day. Rainfall alone cannot tell a
 * farmer whether a site runs dry, because 150 mm of rain in a month where the
 * air pulls back 160 mm is a deficit. Every irrigation figure, pond volume
 * and dry-spell severity in this project is built on it.
 *
 * Allen, Pereira, Raes & Smith (1998), FAO Irrigation and Drainage Paper 56,
 * equation 6:
 *
 *     ET₀ = [0.408 Δ (Rn − G) + γ (900/(T+273)) u₂ (es − ea)]
 *           / [Δ + γ (1 + 0.34 u₂)]
 *
 * A port of `App\Geo\Climate\Et0Calculator`. In the district this is not
 * recomputed — the exported climate already carries the platform's own ET₀,
 * which is checked against four worked examples from FAO-56 itself including
 * Example 18 (Bangkok, ET₀ = 5.72 mm/day). It runs here only for a point
 * outside the snapshot, where POWER gives the drivers and nobody has
 * computed the demand yet.
 */

const STEFAN_BOLTZMANN = 4.903e-9;
const ALBEDO = 0.23;
const SOLAR_CONSTANT = 0.082;

export interface Et0Inputs {
    tMax: number | null;
    tMin: number | null;
    tMean?: number | null;
    solarMj: number | null;
    clearSkyMj?: number | null;
    windMs?: number | null;
    dewPointC?: number | null;
    relHumidity?: number | null;
    pressureKpa?: number | null;
    latitude: number;
    dayOfYear: number;
    elevationM?: number;
}

/**
 * Daily reference evapotranspiration, mm.
 *
 * Null when a required input is missing, rather than silently substituting a
 * default — a fabricated ET₀ would propagate into pond sizing and irrigation
 * advice without ever looking wrong.
 */
export function et0(inputs: Et0Inputs): number | null {
    const { tMax, tMin, solarMj, latitude, dayOfYear } = inputs;

    if (tMax === null || tMin === null || solarMj === null) {
        return null;
    }

    const elevationM = inputs.elevationM ?? 0;
    const tMean = inputs.tMean ?? (tMax + tMin) / 2;

    // FAO-56 recommends 2 m/s where wind is unmeasured; POWER always provides
    // it, so this only guards a gap in the record.
    const u2 = Math.max(inputs.windMs ?? 2, 0.5);

    const pressure = inputs.pressureKpa ?? pressureFromElevation(elevationM);

    const esMax = saturationVapourPressure(tMax);
    const esMin = saturationVapourPressure(tMin);
    const es = (esMax + esMin) / 2;

    const ea = actualVapourPressure(
        inputs.dewPointC ?? null,
        inputs.relHumidity ?? null,
        esMax,
        esMin,
    );

    if (ea === null) {
        return null;
    }

    // Vapour pressure deficit cannot be negative; measurement noise can push
    // ea slightly above es on saturated tropical nights.
    const vpd = Math.max(0, es - ea);

    // Slope of the vapour pressure curve, kPa/°C (eq. 13).
    const delta = (4098 * saturationVapourPressure(tMean)) / Math.pow(tMean + 237.3, 2);

    // Psychrometric constant, kPa/°C (eq. 8).
    const gamma = 0.000665 * pressure;

    const rns = (1 - ALBEDO) * solarMj;
    const rso = inputs.clearSkyMj ?? clearSkyRadiation(latitude, dayOfYear, elevationM);
    const rnl = netLongwaveRadiation(tMax, tMin, ea, solarMj, rso);
    const rn = rns - rnl;

    // Soil heat flux is negligible over a day (eq. 42).
    const numerator = 0.408 * delta * rn + gamma * (900 / (tMean + 273)) * u2 * vpd;
    const denominator = delta + gamma * (1 + 0.34 * u2);

    if (denominator <= 0) {
        return null;
    }

    // ET₀ is a demand and cannot be negative. On rare overcast days the
    // radiation term can go slightly negative; clamping is standard.
    return Math.max(0, round(numerator / denominator, 3));
}

/** Saturation vapour pressure at a temperature, kPa (eq. 11). */
export function saturationVapourPressure(tempC: number): number {
    return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

function actualVapourPressure(
    dewPointC: number | null,
    relHumidity: number | null,
    esMax: number,
    esMin: number,
): number | null {
    // Dew point is the most reliable source (eq. 14); relative humidity is
    // the documented fallback (eq. 19).
    if (dewPointC !== null) {
        return saturationVapourPressure(dewPointC);
    }

    if (relHumidity !== null) {
        return (relHumidity / 100) * ((esMax + esMin) / 2);
    }

    return null;
}

/** Atmospheric pressure from elevation, kPa (eq. 7). */
export function pressureFromElevation(elevationM: number): number {
    return 101.3 * Math.pow((293 - 0.0065 * elevationM) / 293, 5.26);
}

/** Net outgoing longwave radiation, MJ/m²/day (eq. 39). */
function netLongwaveRadiation(
    tMax: number,
    tMin: number,
    ea: number,
    solarMj: number,
    rso: number,
): number {
    const tMaxK4 = Math.pow(tMax + 273.16, 4);
    const tMinK4 = Math.pow(tMin + 273.16, 4);

    // Cloudiness factor, guarded against Rs exceeding Rso — which happens
    // with measurement noise and would drive the term negative.
    const ratio = rso > 0 ? Math.min(1, solarMj / rso) : 1;
    const cloudiness = Math.max(0.05, Math.min(1, 1.35 * ratio - 0.35));

    return (
        STEFAN_BOLTZMANN *
        ((tMaxK4 + tMinK4) / 2) *
        (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) *
        cloudiness
    );
}

/** Clear-sky solar radiation, MJ/m²/day (eq. 37). */
export function clearSkyRadiation(
    latitude: number,
    dayOfYear: number,
    elevationM: number,
): number {
    return (0.75 + 2e-5 * elevationM) * extraterrestrialRadiation(latitude, dayOfYear);
}

/**
 * Extraterrestrial radiation, MJ/m²/day (eq. 21): the radiation arriving at
 * the top of the atmosphere, a purely astronomical quantity, which caps what
 * can reach the ground.
 */
export function extraterrestrialRadiation(latitude: number, dayOfYear: number): number {
    const phi = (latitude * Math.PI) / 180;

    const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
    const declination = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39);

    // Sunset hour angle (eq. 25), clamped for polar day and polar night where
    // the unclamped argument leaves the domain of acos.
    const cosOmega = Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(declination)));
    const omega = Math.acos(cosOmega);

    return (
        ((24 * 60) / Math.PI) *
        SOLAR_CONSTANT *
        dr *
        (omega * Math.sin(phi) * Math.sin(declination) +
            Math.cos(phi) * Math.cos(declination) * Math.sin(omega))
    );
}

/** The middle day of each month, for a monthly climatology. */
export const MONTH_MID_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

export const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function round(value: number, places: number): number {
    const factor = Math.pow(10, places);

    return Math.round(value * factor) / factor;
}
