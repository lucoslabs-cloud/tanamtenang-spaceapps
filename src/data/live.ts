/**
 * Anywhere else on Earth.
 *
 * The snapshot covers one district at 250 m. This covers everywhere else at
 * whatever resolution the open APIs will answer at, by asking the two
 * auth-free sources the platform already uses — NASA POWER for the climate
 * and ISRIC SoilGrids for the soil — straight from the browser, and then
 * deriving exactly what the platform derives from them.
 *
 * **What it cannot get, it does not invent.** There is no digital elevation
 * model reachable without an Earthdata token, so slope, wetness, height above
 * drainage and flood hazard come back null. Dry-spell length and rainfall
 * variability need the daily record rather than a climatology, so they come
 * back null too. The engine already handles that honestly: a null metric
 * drops out of the geometric mean and the coverage figure falls, so a live
 * point reports a lower coverage than a district cell and the panel says
 * which requirements it could not look at.
 *
 * That is the point of showing it rather than hiding it. A farmer in Kenya
 * gets a real answer about their climate and their soil, with the gaps named,
 * instead of a polished answer with the gaps painted over.
 */

import { configureDerived, erosionExposure, pondTemperature, thi } from '@/engine/derived';
import { DAYS_IN_MONTH, et0, MONTH_MID_DOY } from '@/engine/et0';
import {
    availableWaterCapacity,
    drainageClass,
    peatDepthIndicator,
    textureClass,
} from '@/engine/soil';
import type { MonthlyNormal, Site, SiteValues } from '@/engine/types';

const POWER_ENDPOINT = 'https://power.larc.nasa.gov/api/temporal/climatology/point';
const SOILGRIDS_ENDPOINT = 'https://rest.isric.org/soilgrids/v2.0/properties/query';

/** The parameters the platform's own POWER ingest asks for. */
const POWER_PARAMETERS = [
    'T2M',
    'T2M_MAX',
    'T2M_MIN',
    'T2MDEW',
    'RH2M',
    'PRECTOTCORR',
    'WS2M',
    'WS10M_MAX',
    'ALLSKY_SFC_SW_DWN',
    'CLRSKY_SFC_SW_DWN',
    'PS',
].join(',');

const MONTH_KEYS = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
];

/** SoilGrids properties, with the depth weighting the platform uses. */
const SOIL_PROPERTIES = ['phh2o', 'clay', 'sand', 'silt', 'soc', 'cec', 'bdod', 'nitrogen'];

/**
 * Thirty centimetres is where the great majority of root activity is, even
 * for the deep perennials, and it is the depth agronomic advice is written
 * for. Each interval contributes its own thickness.
 */
const SOIL_DEPTHS: Array<[string, number]> = [
    ['0-5cm', 5],
    ['5-15cm', 10],
    ['15-30cm', 15],
];

export interface LiveGap {
    metrics: string[];
    reason: string;
}

export interface LiveSite {
    site: Site;
    months: MonthlyNormal[];
    /** What could not be fetched, and why, in words for the panel. */
    gaps: LiveGap[];
    sources: Array<{ name: string; detail: string }>;
    /** A warning where a figure stands in for one the platform computes better. */
    caveats: string[];
}

/* ----------------------------------------------------------------- power -- */

interface PowerSeries {
    [parameter: string]: Record<string, number>;
}

/**
 * A fetch that gives up.
 *
 * SoilGrids in particular can take a minute under load, and a tool that
 * hangs is worse than one that says what it could not get: the engine is
 * built to report a missing metric honestly, so letting it do that beats
 * making a farmer watch a spinner.
 */
async function fetchWithin(url: string, ms: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);

    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchPower(
    lat: number,
    lon: number,
): Promise<{ series: PowerSeries; units: Record<string, string>; elevationM: number | null }> {
    const url =
        `${POWER_ENDPOINT}?parameters=${POWER_PARAMETERS}&community=AG` +
        `&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;

    const response = await fetchWithin(url, 25_000);

    if (!response.ok) {
        throw new Error(`NASA POWER returned ${response.status}`);
    }

    const json = (await response.json()) as {
        geometry?: { coordinates?: number[] };
        properties?: { parameter?: PowerSeries };
        parameters?: Record<string, { units?: string }>;
    };

    const series = json.properties?.parameter;

    if (series === undefined) {
        throw new Error('NASA POWER returned no parameters for this point.');
    }

    const units: Record<string, string> = {};

    for (const [key, meta] of Object.entries(json.parameters ?? {})) {
        units[key] = meta.units ?? '';
    }

    // POWER returns the elevation of its own grid cell as the third
    // coordinate. It is not the field's elevation — the cell is about
    // 55 x 69 km — but it is the right datum for the pressure term in
    // FAO-56, and it is honest about what it is.
    const coordinates = json.geometry?.coordinates;
    const elevationM =
        Array.isArray(coordinates) && typeof coordinates[2] === 'number' ? coordinates[2] : null;

    return { series, units, elevationM };
}

/**
 * Radiation to MJ/m²/day, which is what FAO-56 Penman-Monteith works in.
 *
 * POWER may report kW-hr/m²/day depending on the community, so the
 * conversion is driven by the response rather than assumed: 1 kWh = 3.6 MJ.
 * The platform learned this the expensive way — getting it wrong scales every
 * evapotranspiration figure by 3.6.
 */
function radiationFactor(unit: string): number {
    return unit.toLowerCase().replace(/\s/g, '').includes('kwh/m2/day') ? 3.6 : 1;
}

/* ------------------------------------------------------------- soilgrids -- */

interface SoilGridsResponse {
    properties?: {
        layers?: Array<{
            name: string;
            unit_measure?: { d_factor?: number };
            depths?: Array<{ label: string; values?: { mean?: number | null } }>;
        }>;
    };
}

async function fetchSoil(lat: number, lon: number): Promise<Record<string, number | null>> {
    const params = new URLSearchParams();
    params.set('lon', lon.toFixed(5));
    params.set('lat', lat.toFixed(5));
    params.set('value', 'mean');

    for (const property of SOIL_PROPERTIES) {
        params.append('property', property);
    }

    for (const [depth] of SOIL_DEPTHS) {
        params.append('depth', depth);
    }

    // SoilGrids allows a handful of requests a minute per address and can
    // take a minute under load. Twenty seconds, then the soil half comes
    // back empty and says so, rather than leaving a farmer watching a
    // spinner for a service that may never answer.
    const response = await fetchWithin(`${SOILGRIDS_ENDPOINT}?${params.toString()}`, 20_000);

    if (!response.ok) {
        throw new Error(`SoilGrids returned ${response.status}`);
    }

    const json = (await response.json()) as SoilGridsResponse;
    const out: Record<string, number | null> = {};

    for (const layer of json.properties?.layers ?? []) {
        // SoilGrids stores integers and publishes the divisor that turns them
        // back into the unit it names.
        const factor = layer.unit_measure?.d_factor ?? 1;

        let weighted = 0;
        let thickness = 0;

        for (const [label, cm] of SOIL_DEPTHS) {
            const value = layer.depths?.find((d) => d.label === label)?.values?.mean;

            if (value === null || value === undefined) {
                continue;
            }

            weighted += (value / factor) * cm;
            thickness += cm;
        }

        out[layer.name] = thickness === 0 ? null : weighted / thickness;
    }

    return out;
}

/* ------------------------------------------------------------- assembly -- */

/**
 * A scoreable site for any point on Earth, from the open APIs alone.
 *
 * `elevationM` is optional and the caller supplies it only if it has one —
 * MapLibre's terrain tiles can give a rough figure where the basemap has
 * them. Without it the pond temperature falls back to the uncorrected air
 * temperature, which is stated as a caveat rather than silently assumed.
 */
export async function loadLiveSite(
    lat: number,
    lon: number,
    dryMonthMm: number,
    elevationM: number | null = null,
): Promise<LiveSite> {
    let soilReached = true;

    const [power, soil] = await Promise.all([
        fetchPower(lat, lon),
        fetchSoil(lat, lon).catch(() => {
            soilReached = false;

            return {} as Record<string, number | null>;
        }),
    ]);

    // POWER knows the elevation of its own grid cell, which is a better
    // datum for the pressure term than sea level and is all there is
    // outside the district.
    elevationM ??= power.elevationM;

    const factor = radiationFactor(power.units.ALLSKY_SFC_SW_DWN ?? '');
    const clearFactor = radiationFactor(power.units.CLRSKY_SFC_SW_DWN ?? '');

    const read = (parameter: string, month: number): number | null => {
        const value = power.series[parameter]?.[MONTH_KEYS[month - 1]];

        // POWER fills gaps with -999.
        return typeof value === 'number' && value > -900 ? value : null;
    };

    const months: MonthlyNormal[] = [];

    for (let month = 1; month <= 12; month++) {
        const days = DAYS_IN_MONTH[month - 1];
        const tMax = read('T2M_MAX', month);
        const tMin = read('T2M_MIN', month);
        const tMean = read('T2M', month);
        const solarRaw = read('ALLSKY_SFC_SW_DWN', month);
        const clearRaw = read('CLRSKY_SFC_SW_DWN', month);
        const solar = solarRaw === null ? null : solarRaw * factor;
        const rain = read('PRECTOTCORR', month);

        const daily = et0({
            tMax,
            tMin,
            tMean,
            solarMj: solar,
            clearSkyMj: clearRaw === null ? null : clearRaw * clearFactor,
            windMs: read('WS2M', month),
            dewPointC: read('T2MDEW', month),
            relHumidity: read('RH2M', month),
            pressureKpa: read('PS', month),
            latitude: lat,
            dayOfYear: MONTH_MID_DOY[month - 1],
            elevationM: elevationM ?? 0,
        });

        // PRECTOTCORR in the climatology is a daily mean, so the monthly
        // total is that times the length of the month.
        const precipMean = rain === null ? null : rain * days;
        const et0Month = daily === null ? null : daily * days;

        months.push({
            point: -1,
            scenario: 'baseline',
            month,
            t2mMean: tMean,
            t2mMaxMean: tMax,
            t2mMinMean: tMin,
            precipMean,
            // A climatology has no distribution behind it, only a mean. The
            // year chart draws the one-in-ten wet and dry bands from these,
            // so off the snapshot it has to leave them out rather than draw
            // a band it does not have.
            precipP10: null,
            precipP90: null,
            rainDays: null,
            et0: et0Month,
            waterBalance:
                precipMean === null || et0Month === null ? null : precipMean - et0Month,
            rhMean: read('RH2M', month),
            solarMean: solar,
            windMean: read('WS10M_MAX', month),
            heatStressDays: null,
            maxDrySpellDays: null,
        });
    }

    const values = annualFromMonths(months, dryMonthMm);

    // Terrain. Nothing here without a DEM, and nothing is guessed.
    values.elevation = elevationM;
    values.slope_pct = null;
    values.aspect = null;
    values.twi = null;
    values.hand_m = null;
    values.flood_hazard = null;
    values.distance_to_water_m = null;
    values.ndvi_mean = null;
    values.ndvi_amplitude = null;
    values.lst_day_mean = null;
    values.soil_moisture_mean = null;
    values.soil_moisture_dry_season = null;

    // Land cover decides the model's permanent exclusions, and MODIS
    // MCD12Q1 needs the ORNL DAAC subsetting service rather than a browser
    // fetch. Left null, which means no enterprise is excluded on land cover
    // here — a judge who drops a pin in a lake should be told that, so the
    // caveats below do.
    values.land_cover = null;

    const clay = soil.clay ?? null;
    const sand = soil.sand ?? null;
    const silt = soil.silt ?? null;
    const soc = soil.soc ?? null;
    const bdod = soil.bdod ?? null;

    const texture = textureClass(clay, silt, sand);

    values.soil_ph = soil.phh2o ?? null;
    values.soil_clay_pct = clay;
    values.soil_sand_pct = sand;
    values.soil_silt_pct = silt;
    values.soil_organic_carbon = soc;
    values.soil_cec = soil.cec ?? null;
    values.soil_bulk_density = bdod;
    values.soil_nitrogen = soil.nitrogen ?? null;
    values.soil_texture_class = texture;
    values.soil_drainage_class = drainageClass(texture, bdod, null, soc);
    values.soil_awc = availableWaterCapacity(texture, soc, bdod);
    values.peat_depth_cm = peatDepthIndicator(soc);

    values.water_temp_mean = pondTemperature(
        values.temp_mean_annual,
        elevationM,
        elevationM,
    );

    values.erosion_exposure = erosionExposure(
        values.rainfall_erosivity ?? null,
        null,
        sand,
        clay,
        soc,
        values.soil_drainage_class,
    );

    const gaps: LiveGap[] = [
        {
            metrics: ['slope_pct', 'twi', 'hand_m', 'flood_hazard', 'distance_to_water_m'],
            reason:
                'There is no elevation model reachable from a browser without an Earthdata ' +
                'token, so nothing here knows the shape of your land. Slope, wetness, height ' +
                'above the nearest drain and flood hazard are all missing, and on a ' +
                'floodplain those are usually the metrics that decide the answer. In the ' +
                'Sri Aman district the tool has SRTM at 30 m and does know them.',
        },
        {
            metrics: ['max_dry_spell_days', 'rainfall_variability_cv', 'heat_stress_days'],
            reason:
                'These three are measured across years, not within one, and need the daily ' +
                'POWER record rather than the climatology a browser can fetch in a second. ' +
                'The longest dry spell is referenced by most envelopes in the catalogue and ' +
                'carries extra weight under "avoid total loss", so losing it costs more than ' +
                'its share of the coverage figure suggests.',
        },
        {
            metrics: ['land_cover'],
            reason:
                'MODIS land cover is what rules land permanently out — open water, built-up ' +
                'ground, ground too steep to farm — and it comes through a subsetting ' +
                'service rather than a plain fetch. Without it nothing here is excluded on ' +
                'what currently covers the ground, so check the basemap before believing a ' +
                'score.',
        },
        {
            metrics: ['ndvi_mean', 'ndvi_amplitude'],
            reason:
                'Greenness is evidence rather than a scored requirement in this project, so ' +
                'its absence costs no coverage. It would have told you what already grows ' +
                'here and how it moves through the year.',
        },
    ];

    const caveats = [
        'Peak wind here is the mean of the daily maximum in the windiest month, not the ' +
            '98th percentile of the daily maximum that the district uses. It is a surrogate, ' +
            'and on an exposed site it will read lower than the gust a tall perennial ' +
            'actually has to stand in.',
        'There is no climate projection outside the district. CMIP6 change factors were ' +
            'built for Sri Aman only, so this point is scored against the observed ' +
            'climatology and the scenario picker does nothing here.',
    ];

    if (elevationM === null) {
        caveats.push(
            'No elevation for this point, so pond temperature is the air temperature plus ' +
                'the shallow-pond offset with no lapse correction. At altitude that reads ' +
                'too warm.',
        );
    } else {
        caveats.push(
            `Elevation here is NASA POWER's own figure for its grid cell, ${Math.round(
                elevationM,
            )} m, not this field's. The cell is about 55 × 70 km, so on broken ground that ` +
                'can be a hundred metres out either way.',
        );
    }

    if (!soilReached) {
        gaps.unshift({
            metrics: [
                'soil_ph',
                'soil_clay_pct',
                'soil_sand_pct',
                'soil_organic_carbon',
                'soil_cec',
                'soil_texture_class',
                'soil_drainage_class',
                'soil_awc',
                'peat_depth_cm',
            ],
            reason:
                'SoilGrids did not answer in time. It is a free public service that allows ' +
                'only a few requests a minute per address and is often slow under load, so ' +
                'this is usually a wait rather than a failure. Everything about the soil is ' +
                'missing from this answer — which is most of what decides whether ground will ' +
                'carry a crop — so treat the scores below as a climate check and nothing ' +
                'more, and pick the point again in a minute.',
        });
    }

    return {
        site: { values, climatePoint: null, lat, lon, live: true },
        months,
        gaps,
        caveats,
        sources: [
            {
                name: 'NASA POWER climatology',
                detail:
                    'Monthly 1991–2020 climatology at 0.5° × 0.625°, AG community. ' +
                    'Temperature, rainfall, humidity, radiation and wind, with reference ' +
                    'evapotranspiration computed here by FAO-56 Penman-Monteith.',
            },
            {
                name: 'ISRIC SoilGrids 2.0',
                detail:
                    'pH, texture, organic carbon, CEC, bulk density and nitrogen at 250 m, ' +
                    'weighted over 0–30 cm. Texture class, natural drainage, available water ' +
                    'capacity and the peat indicator are derived from them.',
            },
        ],
    };
}

/**
 * The annual climate metrics, by the same aggregation the platform's
 * `climate_point_metrics` view performs over its monthly normals.
 *
 * Keeping this in step with that view is what makes a live point comparable
 * to a district cell at all: the envelopes are calibrated against these
 * definitions, and an annual rainfall computed a different way would be
 * scored against a bound that does not mean the same thing.
 */
export function annualFromMonths(months: MonthlyNormal[], dryMonthMm: number): SiteValues {
    const out: SiteValues = {};

    const mean = (pick: (m: MonthlyNormal) => number | null): number | null => {
        const values = months.map(pick).filter((v): v is number => v !== null);

        return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
    };

    const sum = (pick: (m: MonthlyNormal) => number | null): number | null => {
        const values = months.map(pick).filter((v): v is number => v !== null);

        return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
    };

    const min = (pick: (m: MonthlyNormal) => number | null): number | null => {
        const values = months.map(pick).filter((v): v is number => v !== null);

        return values.length === 0 ? null : Math.min(...values);
    };

    const max = (pick: (m: MonthlyNormal) => number | null): number | null => {
        const values = months.map(pick).filter((v): v is number => v !== null);

        return values.length === 0 ? null : Math.max(...values);
    };

    out.temp_mean_annual = mean((m) => m.t2mMean);
    out.temp_max_hottest_month = max((m) => m.t2mMaxMean);
    out.temp_min_coolest_month = min((m) => m.t2mMinMean);
    out.diurnal_range = mean((m) =>
        m.t2mMaxMean === null || m.t2mMinMean === null ? null : m.t2mMaxMean - m.t2mMinMean,
    );

    out.precip_annual = sum((m) => m.precipMean);
    out.precip_driest_month = min((m) => m.precipMean);
    out.precip_wettest_month = max((m) => m.precipMean);
    out.dry_months = months.filter(
        (m) => m.precipMean !== null && m.precipMean < dryMonthMm,
    ).length;

    out.solar_radiation = mean((m) => m.solarMean);
    out.relative_humidity = mean((m) => m.rhMean);
    out.wind_max = max((m) => m.windMean);

    out.et0_annual = sum((m) => m.et0);
    out.water_balance_annual =
        out.precip_annual === null || out.et0_annual === null
            ? null
            : out.precip_annual - out.et0_annual;

    out.thi_max = max((m) => thi(m.t2mMaxMean, m.rhMean));

    // Modified Fournier Index: the rainfall erosivity surrogate the platform
    // builds from monthly totals, since sub-hourly intensity needs IMERG.
    const rain = months.map((m) => m.precipMean).filter((v): v is number => v !== null);
    const total = rain.reduce((a, b) => a + b, 0);
    out.rainfall_erosivity =
        total > 0 ? rain.reduce((a, b) => a + b * b, 0) / total : null;

    // Across-year statistics cannot come from a climatology. Null, not zero.
    out.max_dry_spell_days = null;
    out.rainfall_variability_cv = null;
    out.heat_stress_days = null;

    return out;
}

/** Ensures the derived-metric constants are set before a live point is built. */
export function primeLive(suitability: Parameters<typeof configureDerived>[0]): void {
    configureDerived(suitability);
}
