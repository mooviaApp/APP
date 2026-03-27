import '../style.css';
import { Chart, registerables } from 'chart.js';
import {
    analyzeCaptureHealth,
    CaptureHealthStats,
    IMUSample,
    RawPacketRecord,
    SessionAnalysisSummary,
    TrajectoryService,
    SENSOR_CONFIG,
} from '@moovia/sensor-core';

Chart.register(...registerables);

type ProjectionMode = 'norm' | 'x' | 'y';

type PlotlyModule = {
    react: (element: HTMLElement, data: unknown[], layout: Record<string, unknown>, config?: Record<string, unknown>) => Promise<unknown>;
    purge: (element: HTMLElement) => void;
};

interface DisplayPoint {
    x: number;
    y: number;
    z: number;
}

// UI State
let samples: IMUSample[] = [];
let rawPackets: RawPacketRecord[] = [];
let charts: { [key: string]: Chart } = {};
let currentProjection: ProjectionMode = 'norm';
let currentPath: DisplayPoint[] = [];
let plotlyPromise: Promise<PlotlyModule> | null = null;
let plotlyRenderToken = 0;
const trajectoryService = new TrajectoryService();

// DOM Elements
const fileInput = document.getElementById('file-upload') as HTMLInputElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const vmpEl = document.getElementById('vmp-value') as HTMLElement;
const accPeakEl = document.getElementById('acc-peak') as HTMLElement;
const heightPeakEl = document.getElementById('height-peak') as HTMLElement;
const lateralMaxEl = document.getElementById('lateral-max') as HTMLElement;
const lateralFinalEl = document.getElementById('lateral-final') as HTMLElement;
const sessionMetaEl = document.getElementById('session-meta') as HTMLElement;
const segmentMetaEl = document.getElementById('segment-meta') as HTMLElement;
const segmentNoteEl = document.getElementById('segment-note') as HTMLElement;
const processedNoteEl = document.getElementById('processed-note') as HTMLElement;
const analysisNoteEl = document.getElementById('analysis-note') as HTMLElement;
const geometryMetaEl = document.getElementById('geometry-meta') as HTMLElement;
const algorithmLimitsEl = document.getElementById('algorithm-limits') as HTMLElement;
const path2dTitleEl = document.getElementById('path-2d-title') as HTMLElement;
const trajectory3dEl = document.getElementById('trajectory-3d') as HTMLElement;
const rawTableBody = document.querySelector('#raw-table tbody') as HTMLElement;
const packetTableBody = document.querySelector('#packet-table tbody') as HTMLElement;
const captureStatusEl = document.getElementById('capture-status') as HTMLElement;
const projectionButtons = Array.from(document.querySelectorAll('.projection-btn')) as HTMLButtonElement[];
const captureMetricsEl = {
    avgRate: document.getElementById('cap-avgRate') as HTMLElement,
    medianDt: document.getElementById('cap-medianDt') as HTMLElement,
    maxDt: document.getElementById('cap-maxDt') as HTMLElement,
    gapsPct: document.getElementById('cap-gapsPct') as HTMLElement,
    maxGap: document.getElementById('cap-maxGap') as HTMLElement,
    packets: document.getElementById('cap-packets') as HTMLElement,
    invalid: document.getElementById('cap-invalid') as HTMLElement,
    missingPackets: document.getElementById('cap-missingPackets') as HTMLElement,
    missing: document.getElementById('cap-missing') as HTMLElement,
    duplicates: document.getElementById('cap-duplicates') as HTMLElement,
    reordered: document.getElementById('cap-reordered') as HTMLElement,
    dropped: document.getElementById('cap-dropped') as HTMLElement,
    effectiveTick: document.getElementById('cap-effectiveTick') as HTMLElement,
};
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

function getPlotly(): Promise<PlotlyModule> {
    if (!plotlyPromise) {
        plotlyPromise = import('plotly.js-dist-min').then((module) => (module.default ?? module) as PlotlyModule);
    }
    return plotlyPromise;
}

function getProjectionMeta(mode: ProjectionMode) {
    switch (mode) {
        case 'x':
            return {
                title: 'Trajectory Plan View (X vs Z)',
                axisTitle: 'Lateral X (m)',
                datasetLabel: 'X vs Z',
                project: (point: DisplayPoint) => point.x,
            };
        case 'y':
            return {
                title: 'Trajectory Plan View (Y vs Z)',
                axisTitle: 'Lateral Y (m)',
                datasetLabel: 'Y vs Z',
                project: (point: DisplayPoint) => point.y,
            };
        case 'norm':
        default:
            return {
                title: 'Trajectory Plan View (|XY| vs Z)',
                axisTitle: 'Lateral |XY| (m)',
                datasetLabel: '|XY| vs Z',
                project: (point: DisplayPoint) => Math.hypot(point.x, point.y),
            };
    }
}

function buildDisplayPath(analysis: SessionAnalysisSummary): DisplayPoint[] {
    const path = analysis.activePath.length > 0 ? analysis.activePath : analysis.fullPath;
    return path.map((point) => ({
        x: point.relativePosition.x,
        y: point.relativePosition.y,
        z: point.relativePosition.z,
    }));
}

function resetTables() {
    rawTableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-muted);">Please load a JSON file</td></tr>';
    packetTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No packets loaded</td></tr>';
}

function resetCharts() {
    Object.values(charts).forEach((chart) => {
        chart.data.labels = [];
        chart.data.datasets.forEach((dataset) => {
            dataset.data = [];
        });
        chart.update();
    });
}

function resetMetrics() {
    vmpEl.innerText = '---';
    accPeakEl.innerText = '---';
    heightPeakEl.innerText = '---';
    lateralMaxEl.innerText = '---';
    lateralFinalEl.innerText = '---';
    sessionMetaEl.innerHTML = '<p>No data loaded</p>';
    segmentMetaEl.innerHTML = '<p>No segment available</p>';
    segmentNoteEl.innerText = 'La captura completa incluye colocacion y reposo; las metricas se calculan sobre el tramo activo.';
    processedNoteEl.innerText = 'La captura completa incluye colocacion/reposo; las graficas y metricas usan el tramo activo detectado.';
    analysisNoteEl.innerText = 'La trayectoria 3D es una reconstruccion relativa basada solo en IMU; el yaw puede derivar.';
    geometryMetaEl.innerHTML = '<p>No data loaded</p>';
    algorithmLimitsEl.innerHTML = '<p>No data loaded</p>';
    captureStatusEl.className = 'status-pill status-unknown';
    captureStatusEl.innerText = 'No data';
    Object.values(captureMetricsEl).forEach((element) => {
        element.innerText = '--';
    });
}

function setCaptureHealthUnavailable(message = 'Legacy') {
    captureStatusEl.className = 'status-pill status-unknown';
    captureStatusEl.innerText = message;
    Object.values(captureMetricsEl).forEach((element) => {
        element.innerText = '--';
    });
}

function formatVector(x: number, y: number, z: number) {
    return `X ${x.toFixed(3)}, Y ${y.toFixed(3)}, Z ${z.toFixed(3)}`;
}

async function reset3dPlot() {
    plotlyRenderToken += 1;
    if (trajectory3dEl) {
        trajectory3dEl.innerHTML = '<p class="text-muted">Load a JSON to render the 3D path.</p>';
    }
    if (plotlyPromise) {
        const Plotly = await plotlyPromise;
        Plotly.purge(trajectory3dEl);
    }
}

function clearDashboard() {
    samples = [];
    rawPackets = [];
    currentPath = [];
    currentProjection = 'norm';
    fileInput.value = '';
    trajectoryService.reset();
    updateProjectionButtons();
    updatePath2dMetadata();
    resetMetrics();
    resetTables();
    resetCharts();
    void reset3dPlot();
}

// Initialize
function init() {
    setupTabs();
    setupProjectionControls();
    setupResetButton();
    setupFileUpload();
    setupCharts();
    clearDashboard();
}

function setupTabs() {
    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            tabBtns.forEach((button) => button.classList.remove('active'));
            tabPanes.forEach((pane) => pane.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${tab}`)?.classList.add('active');
        });
    });
}

function setupProjectionControls() {
    projectionButtons.forEach((button) => {
        button.addEventListener('click', () => {
            currentProjection = button.dataset.projection as ProjectionMode;
            updateProjectionButtons();
            updatePath2dMetadata();
            if (currentPath.length > 0) {
                updateProjectionChart(currentPath);
            }
        });
    });
}

function updateProjectionButtons() {
    projectionButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.projection === currentProjection);
    });
}

function updatePath2dMetadata() {
    const projection = getProjectionMeta(currentProjection);
    path2dTitleEl.innerText = projection.title;
    if (charts.path2d) {
        charts.path2d.data.datasets[0].label = projection.datasetLabel;
        const xScale = charts.path2d.options.scales?.x;
        if (xScale && 'title' in xScale && xScale.title) {
            xScale.title.text = projection.axisTitle;
        }
    }
}

function setupResetButton() {
    resetBtn.addEventListener('click', () => {
        clearDashboard();
    });
}

function setupFileUpload() {
    fileInput.addEventListener('change', async (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            try {
                const text = loadEvent.target?.result as string;
                const data = JSON.parse(text);

                rawPackets = [];
                if (Array.isArray(data)) {
                    samples = data;
                } else if (data.samples) {
                    samples = data.samples;
                    if (data.rawPackets) rawPackets = data.rawPackets;
                } else if (data.rawData) {
                    processRawTrajectory(data.rawData);
                    return;
                } else {
                    throw new Error('Unsupported JSON format');
                }

                processData();
            } catch (error) {
                console.error('Error parsing JSON:', error);
                alert('Invalid JSON file');
            }
        };
        reader.readAsText(file);
    });
}

function processRawTrajectory(rawData: any[]) {
    trajectoryService.reset();
    currentPath = rawData.map((point) => ({
        x: point.p_raw?.x ?? 0,
        y: point.p_raw?.y ?? 0,
        z: point.p_raw?.z ?? 0,
    }));

    sessionMetaEl.innerHTML = `
        <p><strong>Status:</strong> Legacy processed export</p>
        <p><strong>Points:</strong> ${rawData.length}</p>
        <p><strong>Mode:</strong> 3D path rendered from embedded rawData</p>
    `;
    segmentMetaEl.innerHTML = '<p><strong>Status:</strong> Legacy export</p><p><strong>Segmentation:</strong> not available in this JSON</p>';
    segmentNoteEl.innerText = 'This file already contains processed rawData and does not include the full raw session for idle/move/idle segmentation.';
    processedNoteEl.innerText = 'Legacy mode: charts use the processed path included in the file.';
    analysisNoteEl.innerText = 'Legacy mode: la trayectoria 3D se dibuja desde rawData ya procesado y no incluye diagnostico activo/asentado.';
    algorithmLimitsEl.innerHTML = '<p><strong>Modo legacy:</strong> este fichero no trae suficiente contexto para separar endpoint activo y posicion asentada final.</p>';
    setCaptureHealthUnavailable();

    updateMetricsFromRaw(rawData);
    updateTable();
    updatePacketTable();
    updateChartsFromRaw(rawData);
    updateGeometryDiagnostics(currentPath, null, null, true);
    updateAlgorithmLimits(null, null, true);
    void renderTrajectory3D(currentPath);
}

function updateMetricsFromRaw(rawData: any[]) {
    let maxAcc = 0;
    let maxZ = Number.NEGATIVE_INFINITY;
    let maxLateral = 0;
    let finalLateral = 0;

    rawData.forEach((entry, index) => {
        const mag = Math.sqrt(entry.acc_net.x ** 2 + entry.acc_net.y ** 2 + entry.acc_net.z ** 2);
        const lateral = Math.hypot(entry.p_raw.x, entry.p_raw.y);
        if (mag > maxAcc) maxAcc = mag;
        if (entry.p_raw.z > maxZ) maxZ = entry.p_raw.z;
        if (lateral > maxLateral) maxLateral = lateral;
        if (index === rawData.length - 1) finalLateral = lateral;
    });

    vmpEl.innerText = '0.00';
    accPeakEl.innerText = maxAcc.toFixed(2);
    heightPeakEl.innerText = Number.isFinite(maxZ) ? maxZ.toFixed(2) : '0.00';
    lateralMaxEl.innerText = maxLateral.toFixed(2);
    lateralFinalEl.innerText = finalLateral.toFixed(2);
}

function updateChartsFromRaw(rawData: any[]) {
    charts.accel.data.labels = rawData.map((_: unknown, index: number) => index);
    charts.accel.data.datasets[0].data = rawData.map((entry) => entry.acc_net.x);
    charts.accel.data.datasets[1].data = rawData.map((entry) => entry.acc_net.y);
    charts.accel.data.datasets[2].data = rawData.map((entry) => entry.acc_net.z);
    charts.accel.update();

    charts.velocity.data.labels = rawData.map((_: unknown, index: number) => index);
    charts.velocity.data.datasets[0].data = rawData.map((entry) => entry.v_raw.z);
    charts.velocity.update();

    charts.position.data.labels = rawData.map((_: unknown, index: number) => index);
    charts.position.data.datasets[0].data = rawData.map((entry) => entry.p_raw.z);
    charts.position.update();

    updateProjectionChart(currentPath);
}

function processData() {
    if (samples.length === 0) return;

    samples = [...samples].sort((a, b) => a.timestampMs - b.timestampMs);
    trajectoryService.reset();
    samples.forEach((sample) => {
        trajectoryService.processSample(sample);
    });

    trajectoryService.applyPostProcessingCorrections();
    const analysis = trajectoryService.getSessionAnalysis();
    const captureStats = analyzeCaptureHealth(samples, rawPackets, SENSOR_CONFIG.ODR_HZ);
    currentPath = buildDisplayPath(analysis);

    updateMetrics(analysis);
    updateTable();
    updatePacketTable();
    updateCharts(analysis);
    updateMeta(analysis, captureStats);
    updateCaptureHealth(captureStats);
    updateGeometryDiagnostics(currentPath, captureStats, analysis, false);
    updateAlgorithmLimits(analysis, captureStats, false);
    void renderTrajectory3D(currentPath);
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
        segmentMetaEl.innerHTML = '<p><strong>Status:</strong> No active segment detected</p>';
        segmentNoteEl.innerText = 'The full capture includes placement and rest; no reliable active segment was detected.';
        processedNoteEl.innerText = 'The full capture includes placement/rest; charts are running in fallback mode.';
        return;
    }

    const activeEnd = analysis.activeEndPoint?.relativePosition;
    const settledEnd = analysis.settledEndPoint?.relativePosition;

    segmentMetaEl.innerHTML = `
        <p><strong>Idle initial:</strong> ${(movementSegment.initialIdleMs / 1000).toFixed(2)}s</p>
        <p><strong>Movement:</strong> ${(movementSegment.activeDurationMs / 1000).toFixed(2)}s</p>
        <p><strong>Idle final:</strong> ${(movementSegment.finalIdleMs / 1000).toFixed(2)}s</p>
        <p><strong>Trimmed tail:</strong> ${(movementSegment.trimmedTailMs / 1000).toFixed(2)}s</p>
        <p><strong>End reason:</strong> ${movementSegment.endReason}</p>
        <p><strong>Confidence:</strong> ${movementSegment.confidence}</p>
        <p><strong>Residual speed at cutoff:</strong> ${analysis.movementMetrics.residualSpeedAtEnd.toFixed(3)} m/s</p>
        <p><strong>Active end:</strong> ${activeEnd ? formatVector(activeEnd.x, activeEnd.y, activeEnd.z) : '--'}</p>
        <p><strong>Settled end:</strong> ${settledEnd ? formatVector(settledEnd.x, settledEnd.y, settledEnd.z) : '--'}</p>
    `;
    segmentNoteEl.innerText = 'La captura completa incluye colocacion y reposo; el tramo activo se cierra por energia fisica y la posicion asentada final se reporta aparte.';
    processedNoteEl.innerText = `La trayectoria mostrada es la reconstruccion activa estabilizada (${(movementSegment.startTimeMs - samples[0].timestampMs).toFixed(0)}-${(movementSegment.endTimeMs - samples[0].timestampMs).toFixed(0)} ms); la posicion asentada final se reporta aparte.`;
}

function updateTable() {
    if (samples.length === 0) {
        resetTables();
        return;
    }

    const displaySamples = samples.slice(0, 50);
    rawTableBody.innerHTML = displaySamples.map((sample, index) => {
        const previous = index === 0 ? displaySamples[0] : displaySamples[index - 1];
        const dt = index === 0 ? 0 : sample.timestampMs - previous.timestampMs;
        return `
        <tr>
            <td>${sample.timestampMs.toFixed(0)}</td>
            <td>${dt.toFixed(3)}</td>
            <td>${sample.ax.toFixed(3)}</td>
            <td>${sample.ay.toFixed(3)}</td>
            <td>${sample.az.toFixed(3)}</td>
            <td>${sample.gx.toFixed(1)}</td>
            <td>${sample.gy.toFixed(1)}</td>
            <td>${sample.gz.toFixed(1)}</td>
            <td>${sample.hwTs16 ?? '--'}</td>
        </tr>`;
    }).join('') + (samples.length > 50 ? `<tr><td colspan="9" style="text-align:center">... ${samples.length - 50} more samples ...</td></tr>` : '');
}

function updatePacketTable() {
    if (!rawPackets || rawPackets.length === 0) {
        packetTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color: var(--text-muted);">No packets loaded</td></tr>';
        return;
    }

    const rows: string[] = [];
    let previous: RawPacketRecord | null = null;
    const displayPackets = rawPackets.slice(0, 50);
    displayPackets.forEach((packet) => {
        const gap = previous ? packet.receivedAt - previous.receivedAt : 0;
        rows.push(`<tr>
            <td>${packet.index}</td>
            <td>${packet.seq16 ?? '--'}</td>
            <td>${packet.receivedAt}</td>
            <td>${gap.toFixed(1)}</td>
            <td>${packet.length}</td>
            <td>${packet.sampleCount}</td>
        </tr>`);
        previous = packet;
    });
    if (rawPackets.length > 50) {
        rows.push(`<tr><td colspan="6" style="text-align:center; padding:12px; color: var(--text-muted);">... ${rawPackets.length - 50} more packets ...</td></tr>`);
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
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
        },
        plugins: { legend: { display: false } },
    };

    charts.accel = new Chart(document.getElementById('accel-chart') as HTMLCanvasElement, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'X', data: [], borderColor: '#501FF0', borderWidth: 1.5, pointRadius: 0 },
                { label: 'Y', data: [], borderColor: '#1DF09F', borderWidth: 1.5, pointRadius: 0 },
                { label: 'Z', data: [], borderColor: '#F0411D', borderWidth: 1.5, pointRadius: 0 },
            ],
        },
        options: commonOptions,
    });

    charts.velocity = new Chart(document.getElementById('velocity-chart') as HTMLCanvasElement, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Vel Z', data: [], borderColor: '#501FF0', borderWidth: 2, pointRadius: 0, fill: true, backgroundColor: 'rgba(80, 31, 240, 0.1)' },
            ],
        },
        options: commonOptions,
    });

    charts.position = new Chart(document.getElementById('position-chart') as HTMLCanvasElement, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Pos Z', data: [], borderColor: '#1DF09F', borderWidth: 3, pointRadius: 0 },
            ],
        },
        options: { ...commonOptions, plugins: { legend: { display: true, labels: { color: '#fff' } } } },
    });

    charts.path2d = new Chart(document.getElementById('path-2d-chart') as HTMLCanvasElement, {
        type: 'scatter',
        data: {
            datasets: [
                { label: '|XY| vs Z', data: [], borderColor: '#1DF09F', borderWidth: 2, showLine: true, pointRadius: 0 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: {
                    title: { display: true, text: 'Lateral |XY| (m)', color: '#ccc' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#ccc' },
                },
                y: {
                    title: { display: true, text: 'Vertical Z (m)', color: '#ccc' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#ccc' },
                },
            },
            plugins: { legend: { display: true, labels: { color: '#fff' } } },
        },
    });

    updatePath2dMetadata();
}

function updateCharts(analysis: SessionAnalysisSummary) {
    const rawData = trajectoryService.getActiveRawData();

    charts.accel.data.labels = rawData.map((_: unknown, index: number) => index);
    charts.accel.data.datasets[0].data = rawData.map((entry) => entry.acc_net.x);
    charts.accel.data.datasets[1].data = rawData.map((entry) => entry.acc_net.y);
    charts.accel.data.datasets[2].data = rawData.map((entry) => entry.acc_net.z);
    charts.accel.update();

    charts.velocity.data.labels = rawData.map((_: unknown, index: number) => index);
    charts.velocity.data.datasets[0].data = rawData.map((entry) => entry.v_raw.z);
    charts.velocity.update();

    charts.position.data.labels = currentPath.map((_: DisplayPoint, index: number) => index);
    charts.position.data.datasets[0].data = currentPath.map((point) => point.z);
    charts.position.update();

    updateProjectionChart(currentPath);

    if (analysis.activePath.length === 0 && analysis.fullPath.length > 0) {
        processedNoteEl.innerText += ' Fallback: no active path was available, so the full reconstructed path is displayed.';
    }
}

function updateProjectionChart(path: DisplayPoint[]) {
    const projection = getProjectionMeta(currentProjection);
    charts.path2d.data.datasets[0].label = projection.datasetLabel;
    charts.path2d.data.datasets[0].data = path.map((point) => ({
        x: projection.project(point),
        y: point.z,
    }));

    const xScale = charts.path2d.options.scales?.x;
    if (xScale && 'title' in xScale && xScale.title) {
        xScale.title.text = projection.axisTitle;
    }
    if (path.length === 0) {
        charts.path2d.data.datasets[0].data = [];
    }
    charts.path2d.update();
}

function updateGeometryDiagnostics(
    path: DisplayPoint[],
    captureStats: CaptureHealthStats | null,
    analysis: SessionAnalysisSummary | null,
    isLegacy: boolean,
) {
    if (path.length === 0) {
        geometryMetaEl.innerHTML = '<p>No path points available.</p>';
        return;
    }

    const xs = path.map((point) => point.x);
    const ys = path.map((point) => point.y);
    const zs = path.map((point) => point.z);
    const start = path[0];
    const end = path[path.length - 1];
    const fmt = (value: number) => value.toFixed(3);
    const activeEnd = analysis?.activeEndPoint?.relativePosition ?? null;
    const settledEnd = analysis?.settledEndPoint?.relativePosition ?? null;
    const metrics = analysis?.movementMetrics ?? null;
    const diagnostics = analysis?.diagnostics ?? null;

    geometryMetaEl.innerHTML = `
        <p><strong>Mode:</strong> ${isLegacy ? 'legacy path' : 'active path'}</p>
        <p><strong>X range:</strong> ${fmt(Math.min(...xs))} .. ${fmt(Math.max(...xs))} m</p>
        <p><strong>Y range:</strong> ${fmt(Math.min(...ys))} .. ${fmt(Math.max(...ys))} m</p>
        <p><strong>Z range:</strong> ${fmt(Math.min(...zs))} .. ${fmt(Math.max(...zs))} m</p>
        <p><strong>Start:</strong> X ${fmt(start.x)}, Y ${fmt(start.y)}, Z ${fmt(start.z)}</p>
        <p><strong>End:</strong> X ${fmt(end.x)}, Y ${fmt(end.y)}, Z ${fmt(end.z)}</p>
        ${activeEnd ? `<p><strong>End of active segment:</strong> ${formatVector(activeEnd.x, activeEnd.y, activeEnd.z)}</p>` : ''}
        ${settledEnd ? `<p><strong>Settled final position:</strong> ${formatVector(settledEnd.x, settledEnd.y, settledEnd.z)}</p>` : ''}
        ${metrics ? `<p><strong>Residual speed at cutoff:</strong> ${metrics.residualSpeedAtEnd.toFixed(3)} m/s</p>` : ''}
        <p><strong>Final lateral |XY|:</strong> ${fmt(Math.hypot(end.x, end.y))} m</p>
        ${diagnostics ? `<p><strong>barAxis confidence:</strong> ${diagnostics.barAxisConfidence}</p>` : ''}
        ${diagnostics?.effectiveTickUs ? `<p><strong>effectiveTickUs:</strong> ${diagnostics.effectiveTickUs.toFixed(2)} us</p>` : ''}
        ${captureStats ? `<p><strong>missingPackets:</strong> ${captureStats.missingPackets} | <strong>missingSamples:</strong> ${captureStats.estimatedMissingSamples}</p>` : ''}
    `;
    analysisNoteEl.innerText = 'La trayectoria mostrada es la reconstruccion activa estabilizada basada solo en IMU; la posicion asentada final se reporta aparte. Z se presenta como vertical mundo y el yaw puede derivar.';
}

function updateAlgorithmLimits(analysis: SessionAnalysisSummary | null, captureStats: CaptureHealthStats | null, isLegacy: boolean) {
    if (isLegacy) {
        algorithmLimitsEl.innerHTML = '<p><strong>Modo legacy:</strong> solo podemos mostrar la trayectoria ya procesada incluida en el archivo.</p>';
        return;
    }

    if (!analysis) {
        algorithmLimitsEl.innerHTML = '<p>No analysis available.</p>';
        return;
    }

    const lowConfidence = analysis.movementSegment?.confidence !== 'segmented'
        || analysis.movementMetrics.residualSpeedAtEnd > 0.5
        || (captureStats?.missingPackets ?? 0) > 0;

    algorithmLimitsEl.innerHTML = `
        <p><strong>Confiable ahora:</strong> forma vertical del gesto, inicio/fin aproximado del movimiento y altura relativa en levantamientos estructurados.</p>
        <p><strong>Solo cualitativo:</strong> yaw absoluto, lateral durante giro de manga y trayectoria 3D absoluta.</p>
        <p><strong>Baja confianza:</strong> cuando la velocidad residual al corte es alta, falta reposo inicial/final o el eje de barra no se detecta con claridad.</p>
        <p><strong>Estado de esta sesion:</strong> ${lowConfidence ? 'baja o media confianza' : 'confianza razonable'}.</p>
        <p><strong>Residual speed:</strong> ${analysis.movementMetrics.residualSpeedAtEnd.toFixed(3)} m/s | <strong>barAxis:</strong> ${analysis.diagnostics.barAxisConfidence}</p>
        <p><strong>Techo IMU-only:</strong> describe bien el gesto, pero no equivale a un registro absoluto tipo dron sin sensores auxiliares.</p>
    `;
}

async function renderTrajectory3D(path: DisplayPoint[]) {
    const renderToken = ++plotlyRenderToken;

    if (path.length === 0) {
        trajectory3dEl.innerHTML = '<p class="text-muted">No path available for 3D rendering.</p>';
        return;
    }

    const Plotly = await getPlotly();
    if (renderToken !== plotlyRenderToken) return;

    const xs = path.map((point) => point.x);
    const ys = path.map((point) => point.y);
    const zs = path.map((point) => point.z);
    const start = path[0];
    const end = path[path.length - 1];

    await Plotly.react(
        trajectory3dEl,
        [
            {
                type: 'scatter3d',
                mode: 'lines',
                x: xs,
                y: ys,
                z: zs,
                line: { color: '#1DF09F', width: 6 },
                name: 'Trajectory',
            },
            {
                type: 'scatter3d',
                mode: 'markers',
                x: [start.x],
                y: [start.y],
                z: [start.z],
                marker: { color: '#501FF0', size: 5 },
                name: 'Start',
            },
            {
                type: 'scatter3d',
                mode: 'markers',
                x: [end.x],
                y: [end.y],
                z: [end.z],
                marker: { color: '#F0411D', size: 5 },
                name: 'End',
            },
        ],
        {
            margin: { l: 0, r: 0, t: 0, b: 0 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            showlegend: true,
            legend: { font: { color: '#ffffff' } },
            scene: {
                aspectmode: 'cube',
                bgcolor: 'rgba(0,0,0,0)',
                camera: { eye: { x: 1.45, y: 1.25, z: 0.95 } },
                xaxis: {
                    title: 'X (m)',
                    color: '#cccccc',
                    gridcolor: 'rgba(255,255,255,0.08)',
                    zerolinecolor: 'rgba(255,255,255,0.12)',
                },
                yaxis: {
                    title: 'Y (m)',
                    color: '#cccccc',
                    gridcolor: 'rgba(255,255,255,0.08)',
                    zerolinecolor: 'rgba(255,255,255,0.12)',
                },
                zaxis: {
                    title: 'Z (m)',
                    color: '#cccccc',
                    gridcolor: 'rgba(255,255,255,0.08)',
                    zerolinecolor: 'rgba(255,255,255,0.12)',
                },
            },
        },
        {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['lasso3d', 'select2d', 'toImage'],
        },
    );
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
    captureMetricsEl.missingPackets.innerText = stats.missingPackets.toString();
    captureMetricsEl.missing.innerText = stats.estimatedMissingSamples.toFixed(0);
    captureMetricsEl.duplicates.innerText = stats.duplicatePackets.toString();
    captureMetricsEl.reordered.innerText = stats.reorderedPackets.toString();
    captureMetricsEl.dropped.innerText = stats.droppedPackets.toString();
    captureMetricsEl.effectiveTick.innerText = stats.effectiveTickUs ? stats.effectiveTickUs.toFixed(2) : '--';
}

init();
