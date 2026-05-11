#!/usr/bin/env node
/**
 * Replay / visualizer for MOOVIA captures.
 *
 * Detects the file format and acts accordingly:
 *
 * - Raw IMU sample array  : runs the (current, post-fix) sensor-core
 *                           TrajectoryService over each sample and reports
 *                           VBT metrics + ASCII charts.
 * - Post-processed columnar dump  : just renders the existing per-sample
 *                                   columns (z, v/vz, lin) and reports the
 *                                   metrics that can still be derived from
 *                                   them.
 *
 * Usage:
 *   node tools/replay-trajectory.js <path-to-json> [...]
 *
 * Outputs to stdout. No browser, no web-test.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Lazy-require sensor-core only when we need to replay raw samples.
function loadSensorCore() {
    const distIndex = path.resolve(
        __dirname,
        '..',
        'packages',
        'sensor-core',
        'dist',
        'index.js'
    );
    if (!fs.existsSync(distIndex)) {
        throw new Error(
            `sensor-core dist not built. Run: npm --prefix packages/sensor-core run build`
        );
    }
    return require(distIndex);
}

// --- ASCII chart helpers ----------------------------------------------------

function downsample(arr, n) {
    if (arr.length <= n) return arr.slice();
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const start = Math.floor((i * arr.length) / n);
        const end = Math.floor(((i + 1) * arr.length) / n);
        let max = -Infinity;
        let abs = 0;
        for (let k = start; k < end; k++) {
            const v = arr[k];
            if (Math.abs(v) > Math.abs(abs)) abs = v;
            if (v > max) max = v;
        }
        out[i] = abs;
    }
    return out;
}

function asciiChart(values, opts) {
    const width = (opts && opts.width) || 120;
    const height = (opts && opts.height) || 14;
    const label = (opts && opts.label) || '';
    const series = downsample(values, width);

    let min = Infinity;
    let max = -Infinity;
    for (const v of series) {
        if (Number.isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return `${label} (no data)`;
    }
    if (max === min) {
        max = min + 1;
    }
    const range = max - min;

    const grid = [];
    for (let r = 0; r < height; r++) grid.push(new Array(width).fill(' '));

    const zeroRow =
        min < 0 && max > 0
            ? height - 1 - Math.round(((0 - min) / range) * (height - 1))
            : -1;
    if (zeroRow >= 0) {
        for (let c = 0; c < width; c++) grid[zeroRow][c] = '-';
    }

    for (let c = 0; c < width; c++) {
        const v = series[c];
        if (!Number.isFinite(v)) continue;
        const row = height - 1 - Math.round(((v - min) / range) * (height - 1));
        if (row >= 0 && row < height) grid[row][c] = '*';
    }

    const yAxisFmt = (v) => v.toFixed(2).padStart(7, ' ');
    const lines = [];
    lines.push(
        `${label}  [min=${min.toFixed(3)}  max=${max.toFixed(3)}  n=${values.length}]`
    );
    for (let r = 0; r < height; r++) {
        const yVal = max - (range * r) / (height - 1);
        const tick =
            r === 0 || r === height - 1 || r === zeroRow ? yAxisFmt(yVal) : '       ';
        lines.push(`${tick} | ${grid[r].join('')}`);
    }
    lines.push(`        +${'-'.repeat(width)}`);
    return lines.join('\n');
}

// --- Statistics -------------------------------------------------------------

function basicStats(arr) {
    if (!arr || !arr.length) return { n: 0 };
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const v of arr) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
    }
    return { n: arr.length, min, max, mean: sum / arr.length };
}

// --- Format detection -------------------------------------------------------

function detectFormat(json) {
    if (Array.isArray(json)) {
        const s = json[0] || {};
        if (
            'ax' in s &&
            'ay' in s &&
            'az' in s &&
            'gx' in s &&
            'gy' in s &&
            'gz' in s
        ) {
            return 'raw_array';
        }
        return 'unknown_array';
    }
    if (json && typeof json === 'object') {
        if (Array.isArray(json.samples) && json.samples.length) {
            const s = json.samples[0];
            if ('ax' in s && 'gx' in s) return 'session_export';
        }
        if (Array.isArray(json.rawData)) {
            return 'session_with_rawdata';
        }
        if (
            Array.isArray(json.z) &&
            Array.isArray(json.ts) &&
            Array.isArray(json.dt)
        ) {
            return 'columnar_post';
        }
    }
    return 'unknown';
}

// --- Replay -----------------------------------------------------------------

function replayRaw(samples) {
    const sc = loadSensorCore();
    // Silence the per-sample console logs from TrajectoryService for a clean
    // CLI report. We restore them after the replay finishes.
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    const svc = new sc.TrajectoryService();

    // Reproduce the production flow: the app calls calibrateAsync(2000) which
    // collects ~2 s of static samples, computes the initial orientation AND
    // the gyro bias from the buffer, then resumes streaming. We emulate that
    // here by toggling the (technically private) `isCalibrating` flag and
    // feeding the first 2 seconds of samples into the calibration buffer
    // without integration. The next sample after the toggle triggers init
    // from the buffered data inside processSample.
    const CALIBRATION_MS = 2000;
    const t0 = samples[0]?.timestampMs ?? 0;
    let calibrationEnd = 0;
    for (calibrationEnd = 0; calibrationEnd < samples.length; calibrationEnd++) {
        if (samples[calibrationEnd].timestampMs - t0 >= CALIBRATION_MS) break;
    }
    svc.isCalibrating = true;
    for (let i = 0; i < calibrationEnd; i++) {
        svc.processSample(samples[i]);
    }
    svc.isCalibrating = false;

    const v_z = [];
    const acc_z = [];
    const z_rel = [];
    const dts = [];
    const isStat = [];

    let baseline_z = null;
    for (let i = calibrationEnd; i < samples.length; i++) {
        const s = samples[i];
        const ts = s.timestampMs ?? s.ts ?? s.timestamp ?? null;
        if (ts == null) continue;
        svc.processSample({
            timestampMs: ts,
            ax: s.ax,
            ay: s.ay,
            az: s.az,
            gx: s.gx,
            gy: s.gy,
            gz: s.gz,
        });
    }

    const raw = svc.getRawData();
    if (raw.length === 0) {
        return { mpv: 0, peakAcc: 0, maxHeight: 0, v_z, acc_z, z_rel };
    }
    baseline_z = raw[0].p_raw.z;
    let prevTs = raw[0].timestamp;
    for (const r of raw) {
        v_z.push(r.v_raw.z);
        acc_z.push(r.acc_net.z);
        z_rel.push(r.p_raw.z - baseline_z);
        const dt = (r.timestamp - prevTs) / 1000;
        dts.push(dt > 0 && dt < 0.05 ? dt : 0.001);
        prevTs = r.timestamp;
    }
    const duration_s =
        raw.length > 1 ? (raw[raw.length - 1].timestamp - raw[0].timestamp) / 1000 : 0;

    // Legacy MPV approximation (old criterion: any v_z > 0.05) for comparison.
    let sumLegacy = 0;
    let countLegacy = 0;
    let peakPos = 0;
    let peakNeg = 0;
    for (let i = 0; i < v_z.length; i++) {
        const v = v_z[i];
        if (v > 0.05) {
            sumLegacy += v;
            countLegacy++;
        }
        if (v > peakPos) peakPos = v;
        if (v < peakNeg) peakNeg = v;
    }
    const mpvLegacy = countLegacy > 0 ? sumLegacy / countLegacy : 0;

    // Crude rep-count heuristic: count positive crossings of v_z above 0.2 m/s
    // followed by a return below 0.05.
    let reps = 0;
    let inRep = false;
    for (const v of v_z) {
        if (!inRep && v > 0.2) {
            inRep = true;
            reps++;
        } else if (inRep && v < 0.05) {
            inRep = false;
        }
    }

    const finalZ = z_rel.length ? z_rel[z_rel.length - 1] : 0;
    const result = {
        mpv: svc.getMeanPropulsiveVelocity(),
        mpvLegacy,
        peakAcc: svc.getPeakLinearAcceleration(),
        maxHeight: svc.getMaxHeight(),
        finalZ,
        peakPos,
        peakNeg,
        reps,
        v_z,
        acc_z,
        z_rel,
        dts,
        duration_s,
        n: raw.length,
    };
    console.log = origLog;
    console.warn = origWarn;
    return result;
}

// --- Post-processed visualization ------------------------------------------

function visualizePost(json, label) {
    const z = json.z;
    const x = json.x || null;
    const y = json.y || null;
    const v = json.v || json.vz || null;
    const lin = json.lin || null;
    const ts = json.ts;

    const out = [];
    out.push('='.repeat(80));
    out.push(`Post-processed columnar dump: ${label}`);
    const dur = (ts[ts.length - 1] - ts[0]) / 1000;
    out.push(
        `samples=${z.length}  duration=${dur.toFixed(2)}s  rate=${(
            z.length / dur
        ).toFixed(1)} Hz`
    );
    out.push(
        'NOTE: this is OLD-pipeline output. The new pipeline cannot be replayed because'
    );
    out.push('      raw IMU samples (ax, ay, az, gx, gy, gz) are not in this file.');
    out.push('');

    if (z) {
        const s = basicStats(z);
        out.push(
            `z   min=${s.min.toFixed(3)}  max=${s.max.toFixed(3)}  mean=${s.mean.toFixed(
                3
            )}  drift_total=${(z[z.length - 1] - z[0]).toFixed(3)} m`
        );
    }
    if (v) {
        const s = basicStats(v);
        out.push(
            `v   min=${s.min.toFixed(3)}  max=${s.max.toFixed(3)}  mean=${s.mean.toFixed(
                3
            )} m/s   (≈ vertical velocity)`
        );
    }
    if (lin) {
        const s = basicStats(lin);
        out.push(
            `lin min=${s.min.toFixed(3)}  max=${s.max.toFixed(3)}  mean=${s.mean.toFixed(
                3
            )} m/s²  (linear acc magnitude)`
        );
    }
    if (x) {
        const s = basicStats(x);
        out.push(
            `x   drift_total=${(x[x.length - 1] - x[0]).toFixed(
                3
            )} m  range=[${s.min.toFixed(3)}, ${s.max.toFixed(3)}]`
        );
    }
    if (y) {
        const s = basicStats(y);
        out.push(
            `y   drift_total=${(y[y.length - 1] - y[0]).toFixed(
                3
            )} m  range=[${s.min.toFixed(3)}, ${s.max.toFixed(3)}]`
        );
    }
    out.push('');

    // Old-pipeline MPV approximation: average of v while v > 0.05.
    // We cannot apply the propulsive criterion (acc_net.z >= -g) without
    // signed vertical linear acceleration.
    if (v) {
        let sum = 0;
        let count = 0;
        for (const vv of v) {
            if (vv > 0.05) {
                sum += vv;
                count++;
            }
        }
        const mpvAsc = count > 0 ? sum / count : 0;
        out.push(
            `MPV-asc (legacy, all v>0.05) = ${mpvAsc.toFixed(
                4
            )} m/s   [from ${count}/${v.length} samples]`
        );
        out.push(
            `Peak +v = ${Math.max(...v).toFixed(
                3
            )} m/s    Peak -v = ${Math.min(...v).toFixed(3)} m/s`
        );
    }
    out.push('');

    if (z) out.push(asciiChart(z, { label: 'z (vertical position, m)', height: 12 }));
    if (v) {
        out.push('');
        out.push(asciiChart(v, { label: 'v (vertical velocity, m/s)', height: 12 }));
    }
    if (lin) {
        out.push('');
        out.push(
            asciiChart(lin, { label: 'lin (|linear acc|, m/s²)', height: 10 })
        );
    }
    if (x && y) {
        out.push('');
        out.push(asciiChart(x, { label: 'x (lateral, m)', height: 8 }));
        out.push('');
        out.push(asciiChart(y, { label: 'y (lateral, m)', height: 8 }));
    }
    return out.join('\n');
}

// --- Rep segmentation (heuristic on acc_net.z) -----------------------------
//
// IMU-only integration drifts monotonically over a multi-rep set, so global
// v_z and z_rel are unreliable past the first rep. To recover useful per-rep
// metrics we segment reps by acceleration peaks and re-integrate locally:
//   * trigger when acc_net.z > +5 m/s² (lift acceleration phase)
//   * extend to the next return to ~0
//   * for each segment, integrate v_z and z_rel from rest using the EMA
//     gravity estimate that was active at segment start
//
// This is a stand-in for the proper IDLE/MOVING/APEX/RETURN state machine
// promised by the spec. Numbers should still be treated as experimental.

function detectReps(acc_z, v_z, dts) {
    const reps = [];
    const TRIGGER = 5.0; // m/s², onset of concentric acceleration
    const RELAX = 0.5;
    let i = 0;
    while (i < acc_z.length) {
        if (acc_z[i] > TRIGGER) {
            // Walk back to find quiet onset (last sample below RELAX before trigger)
            let start = i;
            while (start > 0 && Math.abs(acc_z[start - 1]) > RELAX) start--;
            // Walk forward to find quiet end (first sustained near-zero after trigger)
            let end = i;
            let quietRun = 0;
            while (end < acc_z.length && quietRun < 200) {
                if (Math.abs(acc_z[end]) < RELAX) quietRun++;
                else quietRun = 0;
                end++;
            }
            reps.push({ start, peak: i, end: Math.min(end, acc_z.length - 1) });
            i = end;
        } else {
            i++;
        }
    }
    return reps;
}

function repLocalIntegrate(acc_z, dts, repStart, repEnd) {
    let v = 0;
    let z = 0;
    const v_arr = [];
    const z_arr = [];
    for (let i = repStart; i <= repEnd; i++) {
        const dt = dts[i] ?? 0.001;
        v += acc_z[i] * dt;
        z += v * dt;
        v_arr.push(v);
        z_arr.push(z);
    }
    return { v_arr, z_arr };
}

function visualizeReplayResult(res, label) {
    const out = [];
    out.push('='.repeat(80));
    out.push(`Replay through current sensor-core: ${label}`);
    out.push('');
    out.push(
        `samples=${res.n}  duration=${(res.duration_s || 0).toFixed(2)} s`
    );
    out.push('');
    out.push('--- SESSION-GLOBAL (drifty, reference only) ---');
    out.push(
        `  MPV-propulsive (global, Sanchez-Medina) = ${res.mpv.toFixed(4)} m/s`
    );
    out.push(`  peak |acc_net| = ${res.peakAcc.toFixed(3)} m/s²`);
    out.push(`  max height (path)  = ${res.maxHeight.toFixed(3)} m`);
    out.push(
        `  final z drift = ${res.finalZ.toFixed(3)} m   <- IMU-only artifact`
    );
    out.push('');
    out.push(
        asciiChart(res.acc_z, { label: 'acc_net.z (m/s²) - full session', height: 10 })
    );
    out.push('');

    // --- Per-rep, with local re-integration ---
    const reps = detectReps(res.acc_z, res.v_z, res.dts);
    out.push(`--- PER-REP (rep-local re-integration on acc_net.z) ---`);
    out.push(`  detected reps = ${reps.length} (acc_net.z > 5 m/s² triggers)`);
    if (reps.length === 0) {
        out.push('  (no reps detected — try lower trigger if expected reps are missing)');
    } else {
        const mpvList = [];
        const peakVList = [];
        const peakHList = [];
        for (let r = 0; r < reps.length; r++) {
            const seg = reps[r];
            const t_s = (seg.start * 0.001).toFixed(2);
            const t_e = (seg.end * 0.001).toFixed(2);
            const local = repLocalIntegrate(
                res.acc_z,
                res.dts,
                seg.start,
                seg.end
            );
            const v_local = local.v_arr;
            const z_local = local.z_arr;
            // Per-rep propulsive MPV (Sanchez-Medina): mean v while v>0.05 and a>=-g
            let sum = 0,
                cnt = 0;
            for (let k = 0; k < v_local.length; k++) {
                if (
                    v_local[k] > 0.05 &&
                    res.acc_z[seg.start + k] >= -9.81
                ) {
                    sum += v_local[k];
                    cnt++;
                }
            }
            const mpv = cnt > 0 ? sum / cnt : 0;
            const peakV = Math.max(...v_local, 0);
            const peakH = Math.max(...z_local, 0);
            mpvList.push(mpv);
            peakVList.push(peakV);
            peakHList.push(peakH);
            out.push('');
            out.push(
                `  rep #${r + 1}  t=${t_s}-${t_e}s  MPV=${mpv.toFixed(
                    3
                )} m/s  peak_v=${peakV.toFixed(3)} m/s  peak_h=${peakH.toFixed(
                    3
                )} m  duration=${((seg.end - seg.start) * 0.001).toFixed(2)} s`
            );
            out.push(
                asciiChart(v_local, {
                    label: `    v_z (m/s)   rep ${r + 1}`,
                    height: 7,
                    width: 90,
                })
            );
            out.push(
                asciiChart(z_local, {
                    label: `    z_rel (m)   rep ${r + 1}`,
                    height: 7,
                    width: 90,
                })
            );
        }
        out.push('');
        const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
        out.push(
            `  AVG across reps:  MPV=${avg(mpvList).toFixed(
                3
            )} m/s  peak_v=${avg(peakVList).toFixed(
                3
            )} m/s  peak_h=${avg(peakHList).toFixed(3)} m`
        );
        out.push(
            `  BEST rep      :  MPV=${Math.max(...mpvList).toFixed(
                3
            )} m/s  peak_v=${Math.max(...peakVList).toFixed(
                3
            )} m/s  peak_h=${Math.max(...peakHList).toFixed(3)} m`
        );
    }
    return out.join('\n');
}

// --- Main -------------------------------------------------------------------

function processFile(p) {
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    const fmt = detectFormat(json);
    const label = path.basename(p);

    if (fmt === 'raw_array') {
        const res = replayRaw(json);
        return visualizeReplayResult(res, label);
    }
    if (fmt === 'session_export') {
        const res = replayRaw(json.samples);
        return visualizeReplayResult(res, label);
    }
    if (fmt === 'columnar_post') {
        return visualizePost(json, label);
    }
    return `Unsupported format: ${fmt} for ${label}`;
}

function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: node tools/replay-trajectory.js <file.json> [...]');
        process.exit(2);
    }
    for (const f of args) {
        try {
            console.log(processFile(f));
            console.log('');
        } catch (err) {
            console.error(`[error] ${f}: ${err.message}`);
        }
    }
}

main();
