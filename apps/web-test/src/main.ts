import '../style.css';
import { Chart, registerables } from 'chart.js';
import { 
    IMUSample, 
    TrajectoryService, 
    SENSOR_CONFIG 
} from '@moovia/sensor-core';

Chart.register(...registerables);

// UI State
let samples: IMUSample[] = [];
let rawPackets: any[] = [];
let charts: { [key: string]: Chart } = {};
const trajectoryService = new TrajectoryService();
const GAP_THRESHOLD_MS = 4;

interface CaptureStats {
    avgRateHz: number;
    medianDtMs: number;
    maxDtMs: number;
    gapsPct: number;
    maxGapMs: number;
    totalPackets: number;
    invalidPackets: number;
    estimatedMissingSamples: number;
    droppedPackets: number;
}

// DOM Elements
const fileInput = document.getElementById('file-upload') as HTMLInputElement;
const vmpEl = document.getElementById('vmp-value') as HTMLElement;
const accPeakEl = document.getElementById('acc-peak') as HTMLElement;
const heightPeakEl = document.getElementById('height-peak') as HTMLElement;
const lateralMaxEl = document.getElementById('lateral-max') as HTMLElement;
const lateralFinalEl = document.getElementById('lateral-final') as HTMLElement;
const sessionMetaEl = document.getElementById('session-meta') as HTMLElement;
const rawTableBody = document.querySelector('#raw-table tbody') as HTMLElement;
const packetTableBody = document.querySelector('#packet-table tbody') as HTMLElement;
const captureStatusEl = document.getElementById('capture-status') as HTMLElement;
const captureMetricsEl = {
    avgRate: document.getElementById('cap-avgRate') as HTMLElement,
    medianDt: document.getElementById('cap-medianDt') as HTMLElement,
    maxDt: document.getElementById('cap-maxDt') as HTMLElement,
    gapsPct: document.getElementById('cap-gapsPct') as HTMLElement,
    maxGap: document.getElementById('cap-maxGap') as HTMLElement,
    packets: document.getElementById('cap-packets') as HTMLElement,
    invalid: document.getElementById('cap-invalid') as HTMLElement,
    missing: document.getElementById('cap-missing') as HTMLElement,
    dropped: document.getElementById('cap-dropped') as HTMLElement,
};
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

// Initialize
function init() {
    setupTabs();
    setupFileUpload();
    setupCharts();
}

function setupTabs() {
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${tab}`)?.classList.add('active');
        });
    });
}

function setupFileUpload() {
    fileInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target?.result as string;
                const data = JSON.parse(text);
                
                // Handle different JSON formats (array of samples or full export)
                rawPackets = [];
                if (Array.isArray(data)) {
                    samples = data;
                } else if (data.samples) {
                    samples = data.samples;
                    if (data.rawPackets) rawPackets = data.rawPackets;
                } else if (data.rawData) {
                    // If it's the rawTrajectory record format
                    processRawTrajectory(data.rawData);
                    return;
                }

                processData();
            } catch (err) {
                console.error('Error parsing JSON:', err);
                alert('Invalid JSON file');
            }
        };
        reader.readAsText(file);
    });
}

function processRawTrajectory(rawData: any[]) {
    // This is for when we export the rawDataBuffer from TrajectoryService directly
    trajectoryService.reset();
    
    // Inject existing data points into charts
    updateChartsFromRaw(rawData);
    updateMetricsFromRaw(rawData);
}

function updateMetricsFromRaw(rawData: any[]) {
    // Find peaks manually since the service isn't re-running the integration
    let maxAcc = 0;
    let maxZ = 0;
    
    rawData.forEach(d => {
        const mag = Math.sqrt(d.acc_net.x**2 + d.acc_net.y**2 + d.acc_net.z**2);
        if (mag > maxAcc) maxAcc = mag;
        if (d.p_raw.z > maxZ) maxZ = d.p_raw.z;
    });

    accPeakEl.innerText = maxAcc.toFixed(2);
    heightPeakEl.innerText = maxZ.toFixed(2);
}

function updateChartsFromRaw(rawData: any[]) {
    // Accel Chart
    charts.accel.data.labels = rawData.map((_, i) => i);
    charts.accel.data.datasets[0].data = rawData.map(d => d.acc_net.x);
    charts.accel.data.datasets[1].data = rawData.map(d => d.acc_net.y);
    charts.accel.data.datasets[2].data = rawData.map(d => d.acc_net.z);
    charts.accel.update();

    // Velocity Chart
    charts.velocity.data.labels = rawData.map((_, i) => i);
    charts.velocity.data.datasets[0].data = rawData.map(d => d.v_raw.z);
    charts.velocity.update();

    // Position Chart
    charts.position.data.labels = rawData.map((_, i) => i);
    charts.position.data.datasets[0].data = rawData.map(d => d.p_raw.z);
    charts.position.update();

    // Path 2D (X vs Z)
    charts.path2d.data.datasets[0].data = rawData.map(d => ({ x: d.p_raw.x, y: d.p_raw.z }));
    charts.path2d.update();
}

function processData() {
    if (samples.length === 0) return;

    // Sort by timestamp to avoid out-of-order issues
    samples = [...samples].sort((a, b) => a.timestampMs - b.timestampMs);

    trajectoryService.reset();
    
    // Process all samples through the service
    samples.forEach(s => {
        trajectoryService.processSample(s);
    });

    // Run post-processing
    trajectoryService.applyPostProcessingCorrections();

    // Update UI
    updateMetrics();
    updateTable();
    updatePacketTable();
    updateCharts();
    updateMeta();
    updateCaptureHealth();
}

function updateMetrics() {
    const vmp = trajectoryService.getMeanPropulsiveVelocity();
    const peakAcc = trajectoryService.getPeakLinearAcceleration();
    const maxHeight = trajectoryService.getMaxHeight();
    const maxLateral = trajectoryService.getMaxLateral();
    const finalLateral = trajectoryService.getFinalLateral();

    vmpEl.innerText = vmp.toFixed(2);
    accPeakEl.innerText = peakAcc.toFixed(2);
    heightPeakEl.innerText = maxHeight.toFixed(2);
    lateralMaxEl.innerText = maxLateral.toFixed(2);
    lateralFinalEl.innerText = finalLateral.toFixed(2);
}

function updateMeta() {
    if (samples.length === 0) return;
    
    const duration = (samples[samples.length - 1].timestampMs - samples[0].timestampMs) / 1000;
    const rate = samples.length / duration;

    sessionMetaEl.innerHTML = `
        <p><strong>Samples:</strong> ${samples.length}</p>
        <p><strong>Duration:</strong> ${duration.toFixed(2)}s</p>
        <p><strong>Avg Rate:</strong> ${rate.toFixed(0)} Hz</p>
        <p><strong>ODR Config:</strong> ${SENSOR_CONFIG.ODR_HZ} Hz</p>
    `;
}

function updateTable() {
    // Show first 50 samples to avoid lag
    const displaySamples = samples.slice(0, 50);
    rawTableBody.innerHTML = displaySamples.map((s, idx) => {
        const prev = idx === 0 ? displaySamples[0] : displaySamples[idx - 1];
        const dt = idx === 0 ? 0 : (s.timestampMs - prev.timestampMs);
        return `
        <tr>
            <td>${s.timestampMs.toFixed(0)}</td>
            <td>${dt.toFixed(3)}</td>
            <td>${s.ax.toFixed(3)}</td>
            <td>${s.ay.toFixed(3)}</td>
            <td>${s.az.toFixed(3)}</td>
            <td>${s.gx.toFixed(1)}</td>
            <td>${s.gy.toFixed(1)}</td>
            <td>${s.gz.toFixed(1)}</td>
            <td>${s.hwTs16 ?? '--'}</td>
        </tr>`;
    }).join('') + (samples.length > 50 ? `<tr><td colspan="9" style="text-align:center">... ${samples.length - 50} more samples ...</td></tr>` : '');
}

function updatePacketTable() {
    if (!rawPackets || rawPackets.length === 0) {
        packetTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color: var(--text-muted);">No packets loaded</td></tr>`;
        return;
    }

    const rows = [];
    let prev: any = null;
    const displayPackets = rawPackets.slice(0, 50);
    displayPackets.forEach((p: any) => {
        const gap = prev ? (p.receivedAt - prev.receivedAt) : 0;
        rows.push(`<tr>
            <td>${p.index}</td>
            <td>${p.receivedAt}</td>
            <td>${gap.toFixed(1)}</td>
            <td>${p.length}</td>
            <td>${p.sampleCount}</td>
        </tr>`);
        prev = p;
    });
    if (rawPackets.length > 50) {
        rows.push(`<tr><td colspan="5" style="text-align:center; padding:12px; color: var(--text-muted);">... ${rawPackets.length - 50} more packets ...</td></tr>`);
    }
    packetTableBody.innerHTML = rows.join('');
}

function setupCharts() {
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        scales: {
            x: { display: false },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } }
        },
        plugins: { legend: { display: false } }
    };

    charts.accel = new Chart(document.getElementById('accel-chart') as HTMLCanvasElement, {
        type: 'line',
        data: { labels: [], datasets: [
            { label: 'X', data: [], borderColor: '#501FF0', borderWidth: 1.5, pointRadius: 0 },
            { label: 'Y', data: [], borderColor: '#1DF09F', borderWidth: 1.5, pointRadius: 0 },
            { label: 'Z', data: [], borderColor: '#F0411D', borderWidth: 1.5, pointRadius: 0 }
        ]},
        options: commonOptions
    });

    charts.velocity = new Chart(document.getElementById('velocity-chart') as HTMLCanvasElement, {
        type: 'line',
        data: { labels: [], datasets: [
            { label: 'Vel Z', data: [], borderColor: '#501FF0', borderWidth: 2, pointRadius: 0, fill: true, backgroundColor: 'rgba(80, 31, 240, 0.1)' }
        ]},
        options: commonOptions
    });

    charts.position = new Chart(document.getElementById('position-chart') as HTMLCanvasElement, {
        type: 'line',
        data: { labels: [], datasets: [
            { label: 'Pos Z', data: [], borderColor: '#1DF09F', borderWidth: 3, pointRadius: 0 }
        ]},
        options: { ...commonOptions, plugins: { legend: { display: true, labels: { color: '#fff' } } } }
    });

    charts.path2d = new Chart(document.getElementById('path-2d-chart') as HTMLCanvasElement, {
        type: 'scatter',
        data: { datasets: [
            { label: 'X vs Z', data: [], borderColor: '#1DF09F', borderWidth: 2, showLine: true, pointRadius: 0 }
        ]},
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: { title: { display: true, text: 'Lateral (m)', color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#ccc' } },
                y: { title: { display: true, text: 'Vertical Z (m)', color: '#ccc' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#ccc' } }
            },
            plugins: { legend: { display: true, labels: { color: '#fff' } } }
        }
    });
}

function updateCharts() {
    const rawData = trajectoryService.getRawData(); // contains vel_raw, etc
    const path = trajectoryService.getPath();      // contains relativePosition

    // Accel Chart
    charts.accel.data.labels = rawData.map((_, i) => i);
    charts.accel.data.datasets[0].data = rawData.map(d => d.acc_net.x);
    charts.accel.data.datasets[1].data = rawData.map(d => d.acc_net.y);
    charts.accel.data.datasets[2].data = rawData.map(d => d.acc_net.z);
    charts.accel.update();

    // Velocity Chart
    charts.velocity.data.labels = rawData.map((_, i) => i);
    charts.velocity.data.datasets[0].data = rawData.map(d => d.v_raw.z);
    charts.velocity.update();

    // Position Chart
    charts.position.data.labels = path.map((_, i) => i);
    charts.position.data.datasets[0].data = path.map(d => d.relativePosition.z);
    charts.position.update();

    charts.path2d.data.datasets[0].data = path.map(p => ({ x: p.relativePosition.x, y: p.relativePosition.z }));
    charts.path2d.update();
}

function updateCaptureHealth() {
    const stats = computeCaptureStats(samples, rawPackets, SENSOR_CONFIG.ODR_HZ);
    const status = stats.gapsPct < 1 && stats.maxGapMs < 8 ? 'status-good'
        : stats.gapsPct < 5 && stats.maxGapMs < 20 ? 'status-warn'
        : 'status-bad';
    captureStatusEl.className = `status-pill ${status}`;
    captureStatusEl.innerText = status === 'status-good' ? 'Good' : status === 'status-warn' ? 'Warning' : 'Attention';

    captureMetricsEl.avgRate.innerText = stats.avgRateHz.toFixed(0);
    captureMetricsEl.medianDt.innerText = stats.medianDtMs.toFixed(3);
    captureMetricsEl.maxDt.innerText = stats.maxDtMs.toFixed(3);
    captureMetricsEl.gapsPct.innerText = stats.gapsPct.toFixed(2);
    captureMetricsEl.maxGap.innerText = stats.maxGapMs.toFixed(2);
    captureMetricsEl.packets.innerText = stats.totalPackets.toString();
    captureMetricsEl.invalid.innerText = stats.invalidPackets.toString();
    captureMetricsEl.missing.innerText = stats.estimatedMissingSamples.toFixed(0);
    captureMetricsEl.dropped.innerText = stats.droppedPackets.toString();
}

function computeCaptureStats(s: IMUSample[], packets: any[], odrHz: number): CaptureStats {
    if (!s || s.length < 2) {
        return {
            avgRateHz: 0, medianDtMs: 0, maxDtMs: 0, gapsPct: 0, maxGapMs: 0,
            totalPackets: packets?.length || 0, invalidPackets: 0,
            estimatedMissingSamples: 0, droppedPackets: 0
        };
    }

    const sorted = [...s].sort((a, b) => a.timestampMs - b.timestampMs);
    const dts = [];
    for (let i = 0; i < sorted.length - 1; i++) {
        dts.push(sorted[i + 1].timestampMs - sorted[i].timestampMs);
    }
    const durationMs = sorted[sorted.length - 1].timestampMs - sorted[0].timestampMs;
    const avgRateHz = durationMs > 0 ? sorted.length / (durationMs / 1000) : 0;
    const medianDtMs = median(dts);
    const maxDtMs = Math.max(...dts);
    const gaps = dts.filter(dt => dt > GAP_THRESHOLD_MS);
    const gapsPct = dts.length > 0 ? (gaps.length / dts.length) * 100 : 0;
    const thresholdPacketMs = GAP_THRESHOLD_MS * 5;
    let maxGapMs = 0;
    let droppedPackets = 0;
    let invalidPackets = 0;
    if (packets && packets.length > 0) {
        let prev = packets[0];
        maxGapMs = 0;
        packets.forEach((p: any, idx: number) => {
            if (p.length && p.length !== SENSOR_CONFIG.PACKET_SIZE_BYTES) invalidPackets++;
            if (p.sampleCount === 0) droppedPackets++;
            if (idx > 0) {
                const gap = p.receivedAt - prev.receivedAt;
                if (gap > maxGapMs) maxGapMs = gap;
                prev = p;
            }
        });
    }

    const expectedSamples = durationMs > 0 ? Math.round((durationMs / 1000) * odrHz) : 0;
    const estimatedMissingSamples = Math.max(0, expectedSamples - sorted.length);

    return {
        avgRateHz,
        medianDtMs,
        maxDtMs,
        gapsPct,
        maxGapMs: Math.max(maxGapMs, maxDtMs),
        totalPackets: packets?.length || 0,
        invalidPackets,
        estimatedMissingSamples,
        droppedPackets
    };
}

function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

init();
