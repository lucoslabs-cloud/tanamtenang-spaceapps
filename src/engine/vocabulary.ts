/**
 * The metric vocabulary, loaded rather than retyped.
 *
 * Forty-five metrics, each with a label, a unit, a group, the dataset it
 * actually comes from, a rounding precision and a plain-language definition.
 * All of it is exported from the platform's PHP enum by
 * `tools/export.mjs`, so a label cannot drift and — the part that matters —
 * a metric cannot end up citing a dataset it does not come from. The
 * platform found that bug by printing provenance beside every definition;
 * this build inherits the fix by inheriting the data.
 */

import type {
    ClassCode,
    ClassDefinition,
    Meta,
    MetricDefinition,
    MetricGroupDefinition,
    MetricGroupKey,
    MetricKey,
} from './types';

export interface Vocabulary {
    metrics: MetricDefinition[];
    metricGroups: MetricGroupDefinition[];
    classes: ClassDefinition[];
}

let vocabulary: Vocabulary = { metrics: [], metricGroups: [], classes: [] };
let byKey = new Map<MetricKey, MetricDefinition>();
let classByCode = new Map<ClassCode, ClassDefinition>();
let groupByKey = new Map<MetricGroupKey, MetricGroupDefinition>();
let thresholds: Meta['suitability']['classThresholds'] = {
    S1: 85,
    S2: 70,
    S3: 50,
    N1: 25,
};

export function configureVocabulary(
    loaded: Vocabulary,
    classThresholds: Meta['suitability']['classThresholds'],
): void {
    vocabulary = loaded;
    byKey = new Map(loaded.metrics.map((m) => [m.key, m]));
    classByCode = new Map(loaded.classes.map((c) => [c.value, c]));
    groupByKey = new Map(loaded.metricGroups.map((g) => [g.key, g]));
    thresholds = classThresholds;
}

export function metric(key: MetricKey): MetricDefinition | undefined {
    return byKey.get(key);
}

export function metrics(): MetricDefinition[] {
    return vocabulary.metrics;
}

export function metricsInGroup(group: MetricGroupKey): MetricDefinition[] {
    return vocabulary.metrics.filter((m) => m.group === group);
}

export function climateMetricKeys(): MetricKey[] {
    return vocabulary.metrics.filter((m) => m.group === 'climate').map((m) => m.key);
}

export function metricGroups(): MetricGroupDefinition[] {
    return vocabulary.metricGroups;
}

export function metricGroup(key: MetricGroupKey): MetricGroupDefinition | undefined {
    return groupByKey.get(key);
}

export function classes(): ClassDefinition[] {
    return vocabulary.classes;
}

export function classInfo(code: ClassCode): ClassDefinition | undefined {
    return classByCode.get(code);
}

/**
 * Map a 0-100 score onto an FAO class.
 *
 * `criticalFail` forces the N band: a requirement marked critical that falls
 * outside its absolute range means the enterprise cannot run here regardless
 * of how good everything else is. `permanentFail` then separates N2 from N1.
 *
 * Everything below S3 falls to N1, however low. N2 means *permanently*
 * unsuitable and a low score does not establish that — a site failing badly
 * on drainage, pH and heat load is still a site that drainage, lime and
 * shade could rescue. Collapsing a bad score into N2 would tell a farmer to
 * abandon land that is merely expensive.
 */
export function classFromScore(
    score: number,
    criticalFail = false,
    permanentFail = false,
): ClassCode {
    if (criticalFail) {
        return permanentFail ? 'N2' : 'N1';
    }

    if (score >= thresholds.S1) return 'S1';
    if (score >= thresholds.S2) return 'S2';
    if (score >= thresholds.S3) return 'S3';

    return 'N1';
}

export function classRank(code: ClassCode): number {
    return { S1: 0, S2: 1, S3: 2, N1: 3, N2: 4 }[code];
}

export function isSuitable(code: ClassCode): boolean {
    return code === 'S1' || code === 'S2' || code === 'S3';
}
