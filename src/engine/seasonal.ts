/**
 * When in the year the crop already on this field is under pressure.
 *
 * The suitability score answers *where*: it takes annual summaries —
 * hottest month, driest month, annual rainfall — and says whether this ground
 * suits this enterprise. That split leaves the brief's "seasons when current
 * crops appear more vulnerable" unanswered, because an annual figure cannot
 * say which month hurt.
 *
 * **Nothing new is calibrated here.** Every annual climate metric is an
 * aggregate over the twelve monthly normals, so for a whole class of them the
 * monthly value is exactly what the annual figure was built from.
 * `temp_max_hottest_month` is `MAX(t2m_max_mean)`; scoring January's
 * `t2m_max_mean` against that same envelope asks "is January too hot for this
 * crop" in the crop's own published terms.
 *
 * **Only MIN, MAX and AVG metrics qualify, and that is the whole trick.** An
 * envelope over a SUM describes the year, not a month: annual rainfall wants
 * 1,500 to 3,000 mm, and scoring a 250 mm January against it would report
 * lethal drought in the wettest district in Borneo, every month, for every
 * crop. Those are listed in ANNUAL_ONLY and named in the output as skipped
 * rather than dropped silently — a panel that quietly omits half a crop's
 * requirements is worse than one that says what it could not look at.
 *
 * **This one moves with the scenario.** The same question can be asked of
 * 2070, and the answer — a crop uncomfortable for two months now and five
 * months then — is the adaptation argument this project exists to make. The
 * baseline count travels alongside so the comparison is on the panel rather
 * than in the reader's memory.
 *
 * A port of `App\Suitability\SeasonalStress`.
 */

import { pondTemperature, thi } from './derived';
import { direction, score as membership, severity } from './membership';
import { limitingThreshold } from './suitability';
import { metric } from './vocabulary';
import type { Enterprise, MonthlyNormal, Requirement } from './types';

/**
 * Annual metric => the monthly column its value comes from. Each of these is
 * a MIN, MAX or AVG over the months, so the annual envelope and a single
 * month are in the same units and on the same scale.
 */
const MONTHLY_SOURCE: Record<string, keyof MonthlyNormal> = {
    temp_mean_annual: 't2mMean',
    temp_max_hottest_month: 't2mMaxMean',
    temp_min_coolest_month: 't2mMinMean',
    precip_driest_month: 'precipMean',
    precip_wettest_month: 'precipMean',
    relative_humidity: 'rhMean',
    solar_radiation: 'solarMean',
    wind_max: 'windMean',
};

/** Computed per month by the same arithmetic their annual versions use. */
const DERIVED = new Set(['thi_max', 'water_temp_mean']);

/**
 * Requirements this panel cannot speak to, with the reason, because the
 * honest thing is to name them rather than let the reader assume the crop was
 * checked against everything it needs.
 */
const ANNUAL_ONLY: Record<string, string> = {
    precip_annual: 'a yearly total, not a monthly one',
    et0_annual: 'a yearly total, not a monthly one',
    water_balance_annual: 'a yearly total, not a monthly one',
    heat_stress_days: 'counted over the whole year',
    dry_months: 'counted over the whole year',
    max_dry_spell_days: 'measured across years, not within one',
    rainfall_variability_cv: 'measured across years, not within one',
    diurnal_range: 'averaged over the year',
};

/**
 * How much a requirement's score must move across the year before it counts
 * as a seasonal story rather than an annual fact.
 *
 * This exists because of laying hen. Its envelope wants air movement of at
 * least 0.5 m/s; POWER's 2 m wind over closed forest canopy runs 0.05 to 0.14
 * all year, so the requirement scores zero in all twelve months. True or not
 * — a poultry house's internal ventilation is not the reanalysis wind over a
 * forest — it is not a *season*, and leaving it in made it the binding factor
 * every month and buried the heat-humidity curve that actually moves.
 */
const VARIATION_EPSILON = 0.05;

export interface MonthFactor {
    metric: string;
    label: string;
    value: number;
    unit: string;
    score: number;
    severity: 'severe' | 'moderate' | 'slight' | null;
    direction: 'below' | 'above' | null;
    /**
     * On a constant factor only: the range the value actually covers across
     * the year.
     *
     * A requirement counts as constant when its *score* does not move, which
     * is not the same as its value not moving — wet paddy's wettest-month
     * rainfall scores 1.00 in all twelve months here while the rainfall
     * itself runs from 200 to 400 mm. Reporting one month's figure as though
     * it held all year would be a plain untruth, so the panel reports the
     * span and says the envelope does not notice it.
     */
    valueMin?: number;
    valueMax?: number;
}

export interface MonthPressure {
    month: number;
    pressure: number | null;
    strained: boolean;
    tightest: MonthFactor | null;
    factors: MonthFactor[];
}

export interface SeasonalSummary {
    strainedMonths: number[];
    peakPressure: number | null;
    worstMonth: number | null;
}

export interface SeasonalStress {
    enterprise: { slug: string; name: string };
    scenario: string;
    months: MonthPressure[];
    strainedMonths: number[];
    peakPressure: number | null;
    worstMonth: number | null;
    baseline: SeasonalSummary | null;
    seasonal: boolean;
    constant: MonthFactor[];
    evaluated: string[];
    skipped: Array<{ label: string; reason: string }>;
}

export function seasonalStress(
    enterprise: Enterprise,
    months: MonthlyNormal[],
    baselineMonths: MonthlyNormal[],
    scenario: string,
    cellElevationM: number | null,
    pointElevationM: number | null,
): SeasonalStress | null {
    const split = splitRequirements(enterprise);

    if (split.evaluable.length === 0 || months.length < 12) {
        return null;
    }

    const scored = scoreYear(split.evaluable, months, cellElevationM, pointElevationM);

    // The same question asked of today, so the panel can say what changes
    // rather than leaving the reader to hold two numbers in mind. A count of
    // strained months is not enough on its own: in this district a
    // heat-sensitive enterprise is already strained in all twelve, and the
    // count cannot then move however much worse it gets. The peak is what
    // moves.
    let baseline: SeasonalSummary | null = null;

    if (scenario !== 'baseline' && baselineMonths.length === 12) {
        const base = scoreYear(
            split.evaluable,
            baselineMonths,
            cellElevationM,
            pointElevationM,
        );

        baseline = summarise(base.months);
    }

    const summary = summarise(scored.months);
    const anyPressure = scored.months.some((m) => m.pressure !== null);

    return {
        enterprise: { slug: enterprise.slug, name: enterprise.name },
        scenario,
        months: scored.months,
        strainedMonths: summary.strainedMonths,
        peakPressure: summary.peakPressure,
        worstMonth: summary.worstMonth,
        baseline,

        // False when nothing in this crop's climate requirements moves enough
        // across the year to call a season. The panel then says so instead of
        // drawing a flat chart and letting the reader find a pattern in it.
        seasonal: anyPressure,

        // Requirements that read the same in every month. Still shown,
        // because they can be the reason a crop struggles — they are simply
        // not a *season*, and they are already in the annual score.
        constant: scored.constant,

        evaluated: split.labels,
        skipped: split.skipped,
    };
}

function summarise(months: MonthPressure[]): SeasonalSummary {
    const strained: number[] = [];
    let peak: number | null = null;
    let worstMonth: number | null = null;

    for (const row of months) {
        if (row.strained) {
            strained.push(row.month);
        }

        if (row.pressure !== null && (peak === null || row.pressure > peak)) {
            peak = row.pressure;
            worstMonth = row.month;
        }
    }

    return { strainedMonths: strained, peakPressure: peak, worstMonth };
}

interface Evaluable {
    requirement: Requirement;
    key: string;
    label: string;
    unit: string;
    precision: number;
}

function splitRequirements(enterprise: Enterprise): {
    evaluable: Evaluable[];
    labels: string[];
    skipped: Array<{ label: string; reason: string }>;
} {
    const evaluable: Evaluable[] = [];
    const labels: string[] = [];
    const skipped: Array<{ label: string; reason: string }> = [];

    for (const requirement of enterprise.requirements) {
        const definition = metric(requirement.metric);

        if (definition === undefined) {
            continue;
        }

        const reason = ANNUAL_ONLY[requirement.metric];

        if (reason !== undefined) {
            skipped.push({ label: definition.label, reason });
            continue;
        }

        if (!(requirement.metric in MONTHLY_SOURCE) && !DERIVED.has(requirement.metric)) {
            // Soil, slope, land cover and the rest. Not skipped with a reason
            // because they have no season at all — naming them here would
            // imply they might have.
            continue;
        }

        evaluable.push({
            requirement,
            key: requirement.metric,
            label: definition.label,
            unit: requirement.unit ?? definition.unit,
            precision: definition.precision,
        });

        labels.push(definition.label);
    }

    return { evaluable, labels, skipped };
}

function scoreYear(
    requirements: Evaluable[],
    months: MonthlyNormal[],
    cellElevationM: number | null,
    pointElevationM: number | null,
): { months: MonthPressure[]; constant: MonthFactor[] } {
    const threshold = limitingThreshold();

    // Every requirement scored in every month first, because whether one
    // belongs in the seasonal story depends on how it behaves across the
    // whole year, not in any single month.
    const matrix: Array<Map<number, MonthFactor>> = [];

    for (const evaluable of requirements) {
        const byMonth = new Map<number, MonthFactor>();

        for (const normal of months) {
            const value = monthlyValue(evaluable.key, normal, cellElevationM, pointElevationM);

            const s = membership(
                value,
                evaluable.requirement.absMin,
                evaluable.requirement.optMin,
                evaluable.requirement.optMax,
                evaluable.requirement.absMax,
            );

            if (s === null || value === null) {
                continue;
            }

            byMonth.set(normal.month, {
                metric: evaluable.key,
                label: evaluable.label,
                value: round(value, evaluable.precision),
                unit: evaluable.unit,
                score: round(s, 3),
                severity: severity(s),
                direction: direction(
                    value,
                    evaluable.requirement.absMin,
                    evaluable.requirement.optMin,
                    evaluable.requirement.optMax,
                    evaluable.requirement.absMax,
                ),
            });
        }

        matrix.push(byMonth);
    }

    const varying: Array<Map<number, MonthFactor>> = [];
    const constant: MonthFactor[] = [];

    for (const byMonth of matrix) {
        if (byMonth.size < 12) {
            continue;
        }

        const scores = [...byMonth.values()].map((f) => f.score);
        const spread = Math.max(...scores) - Math.min(...scores);

        if (spread >= VARIATION_EPSILON) {
            varying.push(byMonth);
            continue;
        }

        const all = [...byMonth.values()];
        const first = all[0];
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const values = all.map((f) => f.value);

        constant.push({
            metric: first.metric,
            label: first.label,
            score: round(mean, 3),
            severity: severity(mean),
            value: first.value,
            unit: first.unit,
            direction: first.direction,
            valueMin: Math.min(...values),
            valueMax: Math.max(...values),
        });
    }

    const out: MonthPressure[] = [];

    for (const normal of months) {
        const factors: MonthFactor[] = [];

        for (const byMonth of varying) {
            const factor = byMonth.get(normal.month);

            if (factor !== undefined) {
                factors.push(factor);
            }
        }

        if (factors.length === 0) {
            out.push({
                month: normal.month,
                pressure: null,
                strained: false,
                tightest: null,
                factors: [],
            });

            continue;
        }

        factors.sort((a, b) => a.score - b.score);
        const worst = factors[0];

        out.push({
            month: normal.month,

            // Liebig, as everywhere else here: the month is as hard as its
            // hardest single requirement, not the average of them.
            // Deliberately NOT called a score — it is built from the climate
            // requirements alone and would contradict the FAO class if read
            // as one.
            pressure: round(1 - worst.score, 3),
            strained: worst.score < threshold,

            // The tightest requirement this month, whatever its score. Named
            // "tightest" rather than "binding" because at a score of 1
            // nothing is binding and the panel should not imply otherwise.
            tightest: worst,
            factors: factors.filter((f) => f.score < threshold),
        });
    }

    return { months: out, constant };
}

function monthlyValue(
    key: string,
    normal: MonthlyNormal,
    cellElevationM: number | null,
    pointElevationM: number | null,
): number | null {
    if (key === 'thi_max') {
        return thi(normal.t2mMaxMean, normal.rhMean);
    }

    if (key === 'water_temp_mean') {
        return pondTemperature(normal.t2mMean, cellElevationM, pointElevationM);
    }

    const column = MONTHLY_SOURCE[key];

    if (column === undefined) {
        return null;
    }

    const value = normal[column];

    return typeof value === 'number' ? value : null;
}

function round(value: number, places: number): number {
    const factor = Math.pow(10, places);

    return Math.round(value * factor) / factor;
}

export const MONTH_NAMES = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];
