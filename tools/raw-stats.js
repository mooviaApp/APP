'use strict';
const fs = require('fs');

const f = process.argv[2];
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
const s = j.samples;
console.log('=== ' + f.split(/[\\/]/).pop() + ' ===');
console.log('N=', s.length, 'dur_s=', ((s[s.length - 1].timestampMs - s[0].timestampMs) / 1000).toFixed(3));

const axes = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'];
let ie = 0;
while (ie < s.length && s[ie].timestampMs - s[0].timestampMs < 1500) ie++;
console.log('--- IDLE n=' + ie + ' (first 1.5s) ---');
axes.forEach(function (a) {
    let sum = 0, sq = 0;
    for (let i = 0; i < ie; i++) { sum += s[i][a]; sq += s[i][a] * s[i][a]; }
    const m = sum / ie;
    console.log('  ' + a + ' mean=' + m.toFixed(5) + ' std=' + Math.sqrt(sq / ie - m * m).toFixed(5));
});

const seqs = new Set();
for (let i = 0; i < s.length; i++) seqs.add(s[i].packetSeq16);
console.log('packets unique=', seqs.size, 'samples=', s.length, 'ratio=', (s.length / seqs.size).toFixed(3));

let maxAccel = 0, maxGyro = 0, satA = 0, satG = 0;
for (let i = 0; i < s.length; i++) {
    const ax = s[i].ax, ay = s[i].ay, az = s[i].az;
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    if (mag > maxAccel) maxAccel = mag;
    if (Math.abs(ax) > 7.9 || Math.abs(ay) > 7.9 || Math.abs(az) > 7.9) satA++;
    const gx = s[i].gx, gy = s[i].gy, gz = s[i].gz;
    const gmag = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (gmag > maxGyro) maxGyro = gmag;
    if (Math.abs(gx) > 990 || Math.abs(gy) > 990 || Math.abs(gz) > 990) satG++;
}
console.log('peak |a|=', maxAccel.toFixed(3), 'g (range +/-8g)  near-saturation samples:', satA);
console.log('peak |w|=', maxGyro.toFixed(3), 'dps (range +/-1000dps)  near-saturation samples:', satG);

// dt jitter
const dts = [];
for (let i = 1; i < s.length; i++) dts.push(s[i].timestampMs - s[i - 1].timestampMs);
dts.sort((a, b) => a - b);
console.log('dt(ms): p1=' + dts[Math.floor(dts.length * 0.01)].toFixed(4) +
    ' p50=' + dts[Math.floor(dts.length * 0.5)].toFixed(4) +
    ' p99=' + dts[Math.floor(dts.length * 0.99)].toFixed(4) +
    ' max=' + dts[dts.length - 1].toFixed(4));

// Packet seq diagnostics
let maxSeq = 0, minSeq = 65535;
for (let i = 0; i < s.length; i++) {
    if (s[i].packetSeq16 > maxSeq) maxSeq = s[i].packetSeq16;
    if (s[i].packetSeq16 < minSeq) minSeq = s[i].packetSeq16;
}
const expectedPackets = Math.ceil(s.length / 15);
console.log('packetSeq16 range: ' + minSeq + '-' + maxSeq + '  expected_packets=' + expectedPackets);
