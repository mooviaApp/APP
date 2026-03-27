import '../style.css';
import { Chart, registerables } from 'chart.js';
import { 
    analyzeCaptureHealth,
    CaptureHealthStats,
    IMUSample, 
    RawPacketRecord,
    SessionAnalysisSummary,
    TrajectoryService, 
    SENSOR_CONFIG 
} from '@moovia/sensor-core';

Chart.register(...registerables);

// UI State
let samples: IMUSample[] = [];
let rawPackets: RawPacketRecord[] = [];
let charts: { [key: string]: Chart } = {};
const trajectoryService = new TrajectoryService();

// DOM Elements
const fileInput = document.getElementById('file-upload') as HTMLInputElement;
const vmpEl = document.getElementById('vmp-value') as HTMLElement;
const accPeakEl = document.getElementById('acc-peak') as HTMLElement;
const heightPeakEl = document.getElementById('height-peak') as HTMLElement;
const lateralMaxEl = document.getElementById('lateral-max') as HTMLElement;
const lateralFinalEl = document.getElementById('lateral-final') as HTMLElement;
const sessionMetaEl = document.getElementById('session-meta') as HTMLElement;
const segmentMetaEl = document.getElementById('segment-meta') as HTMLElement;
const segmentNoteEl = document.getElementById('segment-note') as HTMLElement;
const processedNoteEl = document.getElementById('processed-note') as HTMLElement;
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
    segmentMetaEl.innerHTML = `<p><strong>Status:</strong> Legacy export</p><p><strong>Segmentación:</strong> no disponible en este JSON</p>`;
    segmentNoteEl.innerText = 'Este archivo ya trae rawData procesado; no contiene la sesión raw completa para segmentar idle/move/idle.';
    processedNoteEl.innerText = 'Modo legacy: se muestran los datos procesados disponibles en el archivo.';
    
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

    vmpEl.innerText = '0.00';
    accPeakEl.innerText = maxAcc.toFixed(2);
    heightPeakEl.innerText = maxZ.toFixed(2);
    lateralMaxEl.innerText = '0.00';
    lateralFinalEl.innerText = '0.00';
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
    const analysis = trajectoryService.getSessionAnalysis();
    const captureStats = analyzeCaptureHealth(samples, rawPackets, SENSOR_CONFIG.ODR_HZ);

    // Update UI
    updateMetrics(analysis);
    updateTable();
    updatePacketTable();
    updateCharts(analysis);
    updateMeta(analysis, captureStats);
    updateCaptureHealth(captureStats);
}

function updateMetrics(analysis: SessionAnalysisSummary) {
    const metrics = analysis.movementMetrics;
    vmpEl.innerText = metrics.meanPropulsiveVelocity.toFixed(2);
    accPeakEl.innerText = metrics.peakLinearAcc.toFixed(2);
    heightPeakEl.innerText = metrics.maxHeight.toFixed(2);
    lateralMaxEl.innerText = metrics.maxLateral.toFixed(2);
    lateralFinalEl.innerText = metrics.finalLateral.toFixed(2);
}

function updateMeta(analysis: SessionAnalysisSummary, captureStats: CaptureHealthStats) {
    if (samples.length === 0) return;

    const duration = captureStats.durationMs / 1000;
    const rate = captureStats.avgRateHz;
    const movementSegment = analysis.movementSegment;
    const activeDuration = movementSegment
        ? Math.max(0, movementSegment.endTimeMs - movementSegment.startTimeMs) / 1000
        : 0;

    sessionMetaEl.innerHTML = `
        <p><strong>Samples:</strong> ${samples.length}</p>
        <p><strong>Duration:</strong> ${duration.toFixed(2)}s</p>
        <p><strong>Avg Rate:</strong> ${rate.toFixed(0)} Hz</p>
        <p><strong>Active:</strong> ${activeDuration.toFixed(2)}s</p>
        <p><strong>ODR Config:</strong> ${SENSOR_CONFIG.ODR_HZ} Hz</p>
    `;

    if (!movementSegment) {
        segmentMetaEl.innerHTML = `<p><strong>Status:</strong> No active segment detected</p>`;
        segmentNoteEl.innerText = 'La captura completa incluye colocación y reposo; no se detectó un tramo activo fiable.';
        processedNoteEl.innerText = 'La captura completa incluye colocación/reposo; las gráficas están en modo fallback.';
        return;
    }

    segmentMetaEl.innerHTML = `
        <p><strong>Idle inicial:</strong> ${(movementSegment.initialIdleMs / 1000).toFixed(2)}s</p>
        <p><strong>Movimiento:</strong> ${activeDuration.toFixed(2)}s</p>
        <p><strong>Idle final:</strong> ${(movementSegment.finalIdleMs / 1000).toFixed(2)}s</p>
        <p><strong>Confidence:</strong> ${movementSegment.confidence}</p>
        <p><strong>Final Z:</strong> ${analysis.movementMetrics.finalHeight.toFixed(2)} m</p>
    `;
    segmentNoteEl.innerText = 'La captura completa incluye colocación y reposo; las métricas se calculan sobre el tramo activo detectado.';
    processedNoteEl.innerText = `Tramo activo: ${(movementSegment.startTimeMs - samples[0].timestampMs).toFixed(0)}-${(movementSegment.endTimeMs - samples[0].timestampMs).toFixed(0)} ms dentro de la captura completa.`;
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
    let prev: RawPacketRecord | null = null;
    const displayPackets = rawPackets.slice(0, 50);
    displayPackets.forEach((p) => {
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

function updateCharts(analysis: SessionAnalysisSummary) {
    const rawData = trajectoryService.getActiveRawData();
    const path = analysis.activePath.length > 0 ? analysis.activePath : analysis.fullPath;

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

function updateCaptureHealth(stats: CaptureHealthStats) {
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

init();
