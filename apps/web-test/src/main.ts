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
let charts: { [key: string]: Chart } = {};
const trajectoryService = new TrajectoryService();

// DOM Elements
const fileInput = document.getElementById('file-upload') as HTMLInputElement;
const vmpEl = document.getElementById('vmp-value') as HTMLElement;
const accPeakEl = document.getElementById('acc-peak') as HTMLElement;
const heightPeakEl = document.getElementById('height-peak') as HTMLElement;
const sessionMetaEl = document.getElementById('session-meta') as HTMLElement;
const rawTableBody = document.querySelector('#raw-table tbody') as HTMLElement;
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
                if (Array.isArray(data)) {
                    samples = data;
                } else if (data.samples) {
                    samples = data.samples;
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
}

function processData() {
    if (samples.length === 0) return;

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
    updateCharts();
    updateMeta();
}

function updateMetrics() {
    const vmp = trajectoryService.getMeanPropulsiveVelocity();
    const peakAcc = trajectoryService.getPeakLinearAcceleration();
    const maxHeight = trajectoryService.getMaxHeight();

    vmpEl.innerText = vmp.toFixed(2);
    accPeakEl.innerText = peakAcc.toFixed(2);
    heightPeakEl.innerText = maxHeight.toFixed(2);
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
    rawTableBody.innerHTML = displaySamples.map(s => `
        <tr>
            <td>${s.timestampMs.toFixed(0)}</td>
            <td>${s.ax.toFixed(3)}</td>
            <td>${s.ay.toFixed(3)}</td>
            <td>${s.az.toFixed(3)}</td>
            <td>${s.gx.toFixed(1)}</td>
            <td>${s.gy.toFixed(1)}</td>
            <td>${s.gz.toFixed(1)}</td>
        </tr>
    `).join('') + (samples.length > 50 ? `<tr><td colspan="7" style="text-align:center">... ${samples.length - 50} more samples ...</td></tr>` : '');
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
}

init();
