/**
 * The vocabulary, as types.
 *
 * Every shape here has a counterpart in the platform's PHP, and the names
 * are kept close enough to grep across both. Where they differ it is only
 * camelCase against snake_case, because the exporter renames on the way out
 * and the browser should not have to care.
 */

export type MetricKey = string;

export type MetricGroupKey = 'climate' | 'terrain' | 'soil' | 'water' | 'vegetation';

export type ClassCode = 'S1' | 'S2' | 'S3' | 'N1' | 'N2';

export interface MetricDefinition {
    key: MetricKey;
    label: string;
    unit: string;
    group: MetricGroupKey;
    /** Slug of the dataset this number actually comes from. */
    dataset: string;
    precision: number;
    categorical: boolean;
    ordinal: boolean;
    describe: string;
}

export interface MetricGroupDefinition {
    key: MetricGroupKey;
    label: string;
    description: string;
    icon: string;
    color: string;
}

export interface ClassDefinition {
    value: ClassCode;
    label: string;
    short_label: string;
    description: string;
    color: string;
    color_dark: string;
    icon: string;
    improvable: boolean;
}

/* ------------------------------------------------------------ envelopes -- */

export interface Requirement {
    metric: MetricKey;
    weight: number;
    isCritical: boolean;
    isPermanentWhenFailed: boolean;
    absMin: number | null;
    optMin: number | null;
    optMax: number | null;
    absMax: number | null;
    allowedCodes: Array<number | string> | null;
    unit: string | null;
    remedyKey: string | null;
    sourceCitation: string | null;
    notes: string | null;
}

export interface RotationRule {
    followsSlug: string | null;
    followsFamily: string | null;
    effect: 'beneficial' | 'neutral' | 'harmful' | 'forbidden';
    magnitude: number;
    minGapSeasons: number;
    reason: string | null;
    source: string | null;
}

export type EnterpriseCategoryKey =
    | 'perennial'
    | 'seasonal'
    | 'short_cycle'
    | 'aquaculture'
    | 'livestock';

export interface Enterprise {
    slug: string;
    name: string;
    localName: string | null;
    scientificName: string | null;
    category: EnterpriseCategoryKey;
    subcategory: string | null;
    description: string | null;
    farmerNote: string | null;
    isPerennial: boolean;
    cycleDaysMin: number | null;
    cycleDaysMax: number | null;
    establishmentMonths: number | null;
    productiveLifeYears: number | null;
    plantFamily: string | null;
    nitrogenRole: string | null;
    rootingDepthCm: number | null;
    residueClass: string | null;
    isCoverCrop: boolean;
    waterDemandMmCycle: number | null;
    kcMid: number | null;
    yieldMin: number | null;
    yieldMax: number | null;
    yieldUnit: string | null;
    labourIntensity: number | null;
    capitalIntensity: number | null;
    icon: string | null;
    color: string | null;
    sortOrder: number;
    sourceReferences: unknown;
    requirements: Requirement[];
    rotationRules: RotationRule[];
}

export interface EnterpriseCategoryDefinition {
    value: EnterpriseCategoryKey;
    label: string;
    local_label: string;
    examples: string;
    description: string;
    planning_horizon_years: number;
    icon: string;
    enterprises?: unknown;
}

export interface Intervention {
    key: string;
    name: string;
    localName: string | null;
    category: string;
    description: string | null;
    howItWorks: string | null;
    improvesMetrics: MetricKey[] | null;
    unitCostMyr: number | null;
    costUnit: string | null;
    lifespanYears: number | null;
    complexity: number | null;
    sourceReferences: unknown;
}

export interface DataSource {
    slug: string;
    name: string;
    provider: string;
    program: string | null;
    instrument: string | null;
    product: string | null;
    resolution: string | null;
    temporalResolution: string | null;
    role: string;
    url: string | null;
    doi: string | null;
    citation: string | null;
    licence: string | null;
    usedFor: string | null;
    requiresAuth: boolean;
    lastIngestedAt: string | null;
}

export interface GlossaryEntry {
    term: string;
    also?: string | null;
    body: string;
    [key: string]: unknown;
}

/* -------------------------------------------------------------- climate -- */

export interface ClimatePoint {
    id: number;
    label: string | null;
    lat: number;
    lon: number;
    source: string;
    elevationM: number | null;
    recordStart: string | null;
    recordEnd: string | null;
}

/** One row of `climate_point_metrics`: the annual climate for one point under one scenario. */
export interface ClimateMetrics {
    point: number;
    climate_point_id: number;
    scenario: string;
    temp_mean_annual: number | null;
    temp_max_hottest_month: number | null;
    temp_min_coolest_month: number | null;
    diurnal_range: number | null;
    heat_stress_days: number | null;
    thi_max: number | null;
    precip_annual: number | null;
    precip_driest_month: number | null;
    precip_wettest_month: number | null;
    dry_months: number | null;
    max_dry_spell_days: number | null;
    rainfall_variability_cv: number | null;
    solar_radiation: number | null;
    relative_humidity: number | null;
    wind_max: number | null;
    et0_annual: number | null;
    water_balance_annual: number | null;
    rainfall_erosivity: number | null;
    [key: string]: number | string | null;
}

export interface MonthlyNormal {
    point: number;
    scenario: string;
    month: number;
    t2mMean: number | null;
    t2mMaxMean: number | null;
    t2mMinMean: number | null;
    precipMean: number | null;
    precipP10: number | null;
    precipP90: number | null;
    rainDays: number | null;
    et0: number | null;
    waterBalance: number | null;
    rhMean: number | null;
    solarMean: number | null;
    windMean: number | null;
    heatStressDays: number | null;
    maxDrySpellDays: number | null;
}

export interface AnnualStat {
    point: number;
    scenario: string;
    year: number;
    precipTotal: number | null;
    precipMax1Day: number | null;
    precipMax5Day: number | null;
    rainDays: number | null;
    t2mMean: number | null;
    t2mMaxAbs: number | null;
    heatStressDays: number | null;
    maxDrySpellDays: number | null;
    dryMonths: number | null;
    et0Total: number | null;
    waterBalance: number | null;
    completeness: number | null;
}

export interface Projection {
    ssp: string;
    horizon: number;
    warming: number;
    warmingLow: number;
    warmingHigh: number;
    rainPct: number;
    rainPctLow: number;
    rainPctHigh: number;
    driestMonthPct: number;
    wettestMonthPct: number;
    models: string | null;
    memberCount: number;
    dataset: string;
}

export interface Scenario {
    key: string;
    label: string;
    description: string | null;
    ssp: string | null;
    horizon: number | null;
    available: boolean;
    projection: Projection | null;
}

/* ----------------------------------------------------------------- meta -- */

export interface PriorityDefinition {
    label: string;
    description: string;
    icon: string;
    default: number;
    metric_multipliers: Record<MetricKey, number>;
}

export interface PriorityPreset {
    label: string;
    description: string;
    weights: Record<string, number>;
}

export interface GridMetricInfo {
    scale: number;
    min: number;
    max: number;
    coverage: number;
    bytes: number;
}

export interface GridMeta {
    cols: number;
    rows: number;
    cells: number;
    resolutionM: number;
    west: number;
    south: number;
    east: number;
    north: number;
    stepLon: number;
    stepLat: number;
    nodata: number;
    metrics: Record<string, GridMetricInfo | null>;
}

export interface Meta {
    generatedAt: string;
    source: string;
    region: {
        id: number;
        name: string;
        localName: string | null;
        adm1: string | null;
        adm2: string | null;
        country: string | null;
        pcode: string | null;
        level: number;
        areaKm2: number;
        centroid: [number, number];
        bbox: [number, number, number, number];
        sourceDataset: string | null;
        sourceVersion: string | null;
    };
    grid: GridMeta;
    scenarios: Scenario[];
    suitability: {
        classThresholds: Record<'S1' | 'S2' | 'S3' | 'N1', number>;
        aggregation: { method: string; score_floor: number; minimum_factor_pull: number };
        limitingFactors: {
            threshold: number;
            max_reported: number;
            severity: { severe: number; moderate: number; slight: number };
        };
        groupWeights: Record<MetricGroupKey, number>;
        priorities: Record<string, PriorityDefinition>;
        priorityPresets: Record<string, PriorityPreset>;
        waterTemperature: { lapse_rate_c_per_km: number; pond_warming_c: number };
        erosion: { reference_rkls: number; structure_code: number; slope_length_m: number };
    };
    rotation: {
        horizon_seasons: number;
        max_candidates: number;
        min_score: number;
        max_cover_candidates: number;
        min_cover_score: number;
        penalty_weight: number;
        bonus_weight: number;
        strategies: {
            build_soil: {
                weight: number;
                legume_share: number;
                residue_share: number;
                variety_share: number;
            };
            least_water: { weight: number; reference_mm_per_season: number };
        };
        residue_weights: Record<string, number>;
    };
    climateConstants: { dryMonthMm: number; normalStartYear: number; normalEndYear: number };
    counts: Record<string, number>;
}

/* ---------------------------------------------------------------- sites -- */

/**
 * One place the engine can score: every metric it knows about, resolved.
 *
 * A grid cell becomes one of these, and so does a point anywhere on Earth
 * fetched live from NASA POWER. The engine never learns which it got, which
 * is what lets the same arithmetic serve the baked district and a farm in
 * Kenya a judge typed in.
 */
export interface SiteValues {
    [metric: string]: number | null;
}

export interface Site {
    values: SiteValues;
    /** Where the climate half came from, for provenance and the monthly chart. */
    climatePoint: number | null;
    lat: number;
    lon: number;
    /** Set when the site is a cell of the baked grid. */
    cellIndex?: number;
    /** Set for a drawn plot: how many cells it covers and their weights. */
    cells?: Array<{ index: number; weight: number }>;
    /** True when the values came from a live fetch rather than the snapshot. */
    live?: boolean;
}

export interface FactorScore {
    metric: MetricKey;
    label: string;
    value: number | null;
    unit: string;
    score: number | null;
    weight: number;
    severity: 'severe' | 'moderate' | 'slight' | null;
    direction: 'below' | 'above' | null;
    isCritical: boolean;
    failed: boolean;
    remedyKey: string | null;
    dataset: string;
    absMin: number | null;
    optMin: number | null;
    optMax: number | null;
    absMax: number | null;
    sourceCitation: string | null;
    notes: string | null;
}

export interface Assessment {
    slug: string;
    name: string;
    score: number;
    classCode: ClassCode;
    /** Share of the weighted requirements that had data behind them, 0..1. */
    coverage: number;
    criticalFail: boolean;
    permanentFail: boolean;
    factors: FactorScore[];
    limiting: FactorScore[];
}
