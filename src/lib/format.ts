/**
 * How numbers are said.
 *
 * One rule runs through all of it: a figure nobody measured is printed as
 * "no data", never as a zero or a dash that could be mistaken for one. The
 * engine is careful to keep "unmeasured" and "lethal" apart and the display
 * has to be too, or the care is wasted at the last step.
 */

import { metric } from '@/engine/vocabulary';

export function num(value: number | null | undefined, places = 0): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return 'no data';
    }

    return value.toLocaleString('en-US', {
        minimumFractionDigits: places,
        maximumFractionDigits: places,
    });
}

/** A metric's value with its own precision and unit. */
export function metricValue(key: string, value: number | null | undefined): string {
    const definition = metric(key);

    if (value === null || value === undefined || !Number.isFinite(value)) {
        return 'no data';
    }

    const places = definition?.precision ?? 1;
    const unit = definition?.unit ?? '';

    return `${num(value, places)}${unit === '' ? '' : ` ${unit}`}`;
}

export function percent(value: number | null | undefined, places = 0): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return 'no data';
    }

    return `${num(value * 100, places)}%`;
}

export function mm(value: number | null | undefined): string {
    return value === null || value === undefined ? 'no data' : `${num(value)} mm`;
}

export function hectares(value: number | null | undefined): string {
    if (value === null || value === undefined) {
        return 'no data';
    }

    return value < 1 ? `${num(value, 2)} ha` : `${num(value, 1)} ha`;
}

export function coordinates(lon: number, lat: number): string {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';

    return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

/** An envelope said in words, for the panel under a limiting factor. */
export function envelope(
    absMin: number | null,
    optMin: number | null,
    optMax: number | null,
    absMax: number | null,
    unit: string,
): string {
    const u = unit === '' ? '' : ` ${unit}`;
    const optimal =
        optMin !== null && optMax !== null
            ? `best between ${num(optMin, 1)} and ${num(optMax, 1)}${u}`
            : optMin !== null
              ? `best above ${num(optMin, 1)}${u}`
              : optMax !== null
                ? `best below ${num(optMax, 1)}${u}`
                : null;

    const absolute =
        absMin !== null && absMax !== null
            ? `fails outside ${num(absMin, 1)} to ${num(absMax, 1)}${u}`
            : absMin !== null
              ? `fails below ${num(absMin, 1)}${u}`
              : absMax !== null
                ? `fails above ${num(absMax, 1)}${u}`
                : null;

    return [optimal, absolute].filter((part) => part !== null).join('; ');
}

export function severityLabel(value: 'severe' | 'moderate' | 'slight' | null): string {
    return value === null ? 'comfortable' : value;
}

export const MONTH_SHORT = [
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

export const MONTH_LONG = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

/** "January", "January and March", "January, March and July". */
export function monthList(months: number[]): string {
    const names = months.map((m) => MONTH_LONG[m - 1]).filter(Boolean);

    if (names.length === 0) return 'no month';
    if (names.length === 1) return names[0];

    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
