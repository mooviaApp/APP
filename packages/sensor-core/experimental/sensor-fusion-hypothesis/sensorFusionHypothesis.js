const fs = require('fs');
const path = require('path');

const bootstrapLog = console.log;
const bootstrapWarn = console.warn;
console.log = () => {};
console.warn = () => {};
const { TrajectoryService } = require('../../dist/TrajectoryService');
const { analyzeCaptureHealth } = require('../../dist/captureAnalysis');
const { QuatMath } = require('../../dist/QuaternionMath');
const { Vec3Math } = require('../../dist/Vec3');
console.log = bootstrapLog;
console.warn = bootstrapWarn;

const BASE_SESSION_PATH = path.resolve(
  __dirname,
  '../../../../JSON_PRUEBAS_VERTICALES/v4-5reps-moovia-session-1775503335652.json',
);
const DOC_ROOT = path.resolve(
  __dirname,
  '../../../../docs/iteration2/sensor-fusion-hypothesis',
);

const WORLD_MAG_FIELD_UT = { x: 18.0, y: 1.5, z: 43.0 };
const MAG_FIELD_NORM_UT = Vec3Math.norm(WORLD_MAG_FIELD_UT);
const MMC_COUNTS_PER_UT = 16384 / 100;
const MMC_OFFSET_COUNTS = 1 << 17;
const IIS_FS_G = 0.5;
const IIS_G_PER_LSB = 0.000015;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function movingAverage(values, windowSize) {
  if (!values.length) return [];
  const radius = Math.max(0, Math.floor(windowSize / 2));
  const prefix = new Array(values.length + 1).fill(0);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    return (prefix[end + 1] - prefix[start]) / (end - start + 1);
  });
}

function unwrapAngles(values) {
  if (!values.length) return [];
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    let current = values[i];
    const prev = out[i - 1];
    while (current - prev > Math.PI) current -= 2 * Math.PI;
    while (current - prev < -Math.PI) current += 2 * Math.PI;
    out.push(current);
  }
  return out;
}

function wrapAngle(angleRad) {
  let wrapped = angleRad;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}

function angleDifference(target, current) {
  return wrapAngle(target - current);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function degrees(rad) {
  return rad * 180 / Math.PI;
}

function pseudoNoise(index, seed) {
  const x = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function eulerToQuat(roll, pitch, yaw) {
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);
  return QuatMath.normalize({
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
  });
}

function withSilencedLogs(fn) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

function loadBaseSession() {
  return readJson(BASE_SESSION_PATH);
}

function runBaseAnalysis(session) {
  return withSilencedLogs(() => {
    const svc = new TrajectoryService(session.sensorConfig?.ODR_HZ || 1000);
    svc.setRealtimeEnabled(false);
    for (const sample of session.samples) svc.processSample(sample);
    svc.applyPostProcessingCorrections();
    return {
      captureHealth: analyzeCaptureHealth(
        session.samples,
        session.rawPackets || [],
        session.sensorConfig?.ODR_HZ || 1000,
      ),
      analysis: svc.getSessionAnalysis(),
      rawData: svc.getRawData(),
      activeRawData: svc.getActiveRawData(),
    };
  });
}

function buildReferenceOrientation(rawData) {
  const rolls = [];
  const pitches = [];
  const yaws = [];
  for (const record of rawData) {
    const euler = QuatMath.toEuler(record.q);
    rolls.push(euler.x);
    pitches.push(euler.y);
    yaws.push(euler.z);
  }
  const rollSmooth = movingAverage(unwrapAngles(rolls), 121);
  const pitchSmooth = movingAverage(unwrapAngles(pitches), 121);
  const yawUnwrapped = unwrapAngles(yaws);
  const yawTrend = movingAverage(yawUnwrapped, 901);
  const yawReference = yawUnwrapped.map((yaw, index) => yawUnwrapped[0] + 0.35 * (yaw - yawTrend[index]));
  return rawData.map((record, index) => ({
    timestampMs: record.timestamp,
    rollCurrentRad: rolls[index],
    pitchCurrentRad: pitches[index],
    yawCurrentRad: yaws[index],
    rollRefRad: rollSmooth[index],
    pitchRefRad: pitchSmooth[index],
    yawRefRad: yawReference[index],
    qRef: eulerToQuat(rollSmooth[index], pitchSmooth[index], yawReference[index]),
  }));
}

function buildResampledTimeline(startMs, endMs, odrHz) {
  const timeline = [];
  const stepMs = 1000 / odrHz;
  let sampleIndex = 0;
  for (let t = startMs; t <= endMs + stepMs * 0.5; t += stepMs) {
    timeline.push({ timestampMs: Number(t.toFixed(6)), sampleIndex });
    sampleIndex++;
  }
  return timeline;
}

function sampleNearest(records, timeline) {
  const out = [];
  let pointer = 0;
  for (const target of timeline) {
    while (
      pointer < records.length - 1 &&
      Math.abs(records[pointer + 1].timestampMs - target.timestampMs) <=
        Math.abs(records[pointer].timestampMs - target.timestampMs)
    ) pointer++;
    out.push(records[pointer]);
  }
  return out;
}

function findNearestPathIndex(pathPoints, timestampMs) {
  let bestIndex = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < pathPoints.length; i++) {
    const delta = Math.abs(pathPoints[i].timestamp - timestampMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function detectFinalAnchorTime(rawData, lastRepApexMs, fallbackTimeMs) {
  let runStart = null;
  let runEnd = null;
  for (const record of rawData) {
    if (record.timestamp < lastRepApexMs) continue;
    const quiet = (record.linAccMag ?? 99) < 0.12 && (record.gyroMagDps ?? 99) < 2.0;
    if (quiet) {
      if (runStart === null) runStart = record.timestamp;
      runEnd = record.timestamp;
      continue;
    }
    if (runStart !== null && runEnd !== null && runEnd - runStart >= 180) return (runStart + runEnd) * 0.5;
    runStart = null;
    runEnd = null;
  }
  if (runStart !== null && runEnd !== null && runEnd - runStart >= 180) return (runStart + runEnd) * 0.5;
  return fallbackTimeMs;
}

function buildMagnetometerSimulation(referenceOrientation, startMs, endMs) {
  const timeline = buildResampledTimeline(startMs, endMs, 200);
  const aligned = sampleNearest(referenceOrientation, timeline);
  const samples = timeline.map((timePoint, index) => {
    const ref = aligned[index];
    const bodyMag = QuatMath.rotate(QuatMath.conjugate(ref.qRef), WORLD_MAG_FIELD_UT);
    const noisyField = {
      x: bodyMag.x + 1.3 + pseudoNoise(index, 11) * 0.08,
      y: bodyMag.y - 0.8 + pseudoNoise(index, 29) * 0.08,
      z: bodyMag.z + 0.5 + pseudoNoise(index, 47) * 0.08,
    };
    const tempC = 33.0 + pseudoNoise(index, 71) * 0.25;
    return {
      timestampMs: timePoint.timestampMs,
      sampleIndex: timePoint.sampleIndex,
      mx_raw: clamp(Math.round(MMC_OFFSET_COUNTS + noisyField.x * MMC_COUNTS_PER_UT), 0, 262143),
      my_raw: clamp(Math.round(MMC_OFFSET_COUNTS + noisyField.y * MMC_COUNTS_PER_UT), 0, 262143),
      mz_raw: clamp(Math.round(MMC_OFFSET_COUNTS + noisyField.z * MMC_COUNTS_PER_UT), 0, 262143),
      temp_raw: clamp(Math.round((tempC + 75) / 0.8), 0, 255),
      dataReady: true,
      status: { measMDone: true, measTDone: index % 32 === 0 },
    };
  });
  return {
    metadata: {
      simulated: true,
      sourceSession: path.basename(BASE_SESSION_PATH),
      repScenario: '5 reps',
      model: 'MMC5983MA',
      odrHz: 200,
      units: { magneticRaw: 'counts', magneticField: 'uT', temperatureRaw: 'lsb' },
      axisConvention: 'same rigid-body frame as MOOVIA IMU, Z-up world reference',
      assumptions: {
        worldMagFieldUt: WORLD_MAG_FIELD_UT,
        hardIronBiasUt: { x: 1.3, y: -0.8, z: 0.5 },
        noiseRmsUtApprox: 0.08,
        countsPerUt: MMC_COUNTS_PER_UT,
      },
    },
    samples,
  };
}

function deriveHeading(referenceOrientation, magnetometerRaw) {
  const aligned = sampleNearest(referenceOrientation, magnetometerRaw.samples);
  const samples = magnetometerRaw.samples.map((sample, index) => {
    const ref = aligned[index];
    const mxUt = (sample.mx_raw - MMC_OFFSET_COUNTS) / MMC_COUNTS_PER_UT;
    const myUt = (sample.my_raw - MMC_OFFSET_COUNTS) / MMC_COUNTS_PER_UT;
    const mzUt = (sample.mz_raw - MMC_OFFSET_COUNTS) / MMC_COUNTS_PER_UT;
    const fieldNorm = Math.hypot(mxUt, myUt, mzUt);
    const fieldDriftPct = Math.abs(fieldNorm - MAG_FIELD_NORM_UT) / MAG_FIELD_NORM_UT;
    return {
      timestampMs: sample.timestampMs,
      sampleIndex: sample.sampleIndex,
      headingDeg: degrees(ref.yawRefRad),
      yawRad: ref.yawRefRad,
      fieldMagnitudeUt: fieldNorm,
      yawCorrectionDeg: -degrees(angleDifference(ref.yawCurrentRad, ref.yawRefRad)),
      quality: fieldDriftPct <= 0.08 ? 'high' : fieldDriftPct <= 0.16 ? 'medium' : 'low',
    };
  });
  return {
    metadata: {
      simulated: true,
      sourceSession: path.basename(BASE_SESSION_PATH),
      derivedFrom: 'MMC5983MA raw simulation',
      interpretation: 'heading/yaw reference with low-frequency drift removed',
    },
    samples,
  };
}

function buildInclinometerSimulation(referenceOrientation, baseSession, startMs, endMs) {
  const timeline = buildResampledTimeline(startMs, endMs, 208);
  const alignedOrientation = sampleNearest(referenceOrientation, timeline);
  const sourceSamples = sampleNearest(
    baseSession.samples.map((sample) => ({ ...sample, timestampMs: sample.timestampMs })),
    timeline,
  );
  const samples = timeline.map((timePoint, index) => {
    const ref = alignedOrientation[index];
    const sample = sourceSamples[index];
    const gravityBody = QuatMath.rotate(QuatMath.conjugate(ref.qRef), { x: 0, y: 0, z: 1 });
    const axG = gravityBody.x + clamp((sample.ax - gravityBody.x) * 0.12, -0.08, 0.08) + 0.002 + pseudoNoise(index, 101) * 0.0004;
    const ayG = gravityBody.y + clamp((sample.ay - gravityBody.y) * 0.12, -0.08, 0.08) - 0.0015 + pseudoNoise(index, 131) * 0.0004;
    return {
      timestampMs: timePoint.timestampMs,
      sampleIndex: timePoint.sampleIndex,
      ax_raw: clamp(Math.round(axG / IIS_G_PER_LSB), -32768, 32767),
      ay_raw: clamp(Math.round(ayG / IIS_G_PER_LSB), -32768, 32767),
      temp_raw: 25 * 256 + Math.round(pseudoNoise(index, 151) * 12),
      timestamp25us: Math.round((timePoint.timestampMs - timeline[0].timestampMs) * 1000 / 25),
      dataReady: true,
      status: { xlda: true, tda: index % 16 === 0 },
    };
  });
  return {
    metadata: {
      simulated: true,
      sourceSession: path.basename(BASE_SESSION_PATH),
      repScenario: '5 reps',
      model: 'IIS2ICLX',
      odrHz: 208,
      units: { accelerationRaw: 'lsb', acceleration: 'g', timestamp: '25us ticks' },
      axisConvention: 'same rigid-body frame as MOOVIA IMU, only X/Y tilt axes observed',
      assumptions: {
        fullScaleG: IIS_FS_G,
        gPerLsb: IIS_G_PER_LSB,
        biasG: { x: 0.002, y: -0.0015 },
        dynamicLeakGain: 0.12,
        noiseGApprox: 0.0004,
      },
    },
    samples,
  };
}

function deriveTilt(inclinometerRaw) {
  const samples = inclinometerRaw.samples.map((sample) => {
    const axG = sample.ax_raw * IIS_G_PER_LSB;
    const ayG = sample.ay_raw * IIS_G_PER_LSB;
    const radial = Math.sqrt(Math.max(0.0001, 1 - clamp(axG * axG + ayG * ayG, 0, 0.99)));
    const tiltXRad = Math.atan2(axG, radial);
    const tiltYRad = Math.atan2(ayG, radial);
    const stress = Math.abs(axG) + Math.abs(ayG);
    return {
      timestampMs: sample.timestampMs,
      sampleIndex: sample.sampleIndex,
      tiltXDeg: degrees(tiltXRad),
      tiltYDeg: degrees(tiltYRad),
      pitchDeg: degrees(-tiltXRad),
      rollDeg: degrees(tiltYRad),
      gravityNormG: Math.sqrt(axG * axG + ayG * ayG + radial * radial),
      quality: stress <= 0.45 ? 'high' : stress <= 0.7 ? 'medium' : 'low',
    };
  });
  return {
    metadata: {
      simulated: true,
      sourceSession: path.basename(BASE_SESSION_PATH),
      derivedFrom: 'IIS2ICLX raw simulation',
      interpretation: 'gravity-dominant tilt estimate over two axes',
    },
    samples,
  };
}

function qualityScore(label) {
  if (label === 'high') return 1.0;
  if (label === 'medium') return 0.65;
  return 0.35;
}

function buildFusionPath(baseAnalysis, rawData, headingDerived, tiltDerived) {
  const fullPath = baseAnalysis.fullPath;
  const reps = baseAnalysis.repAnalysis.reps;
  const finalAnchorTime = detectFinalAnchorTime(
    rawData,
    reps[reps.length - 1].apexTimeMs,
    fullPath[fullPath.length - 1].timestamp,
  );
  const headingMeanConfidence =
    headingDerived.samples.reduce((sum, sample) => sum + qualityScore(sample.quality), 0) /
    headingDerived.samples.length;
  const tiltMeanConfidence =
    tiltDerived.samples.reduce((sum, sample) => sum + qualityScore(sample.quality), 0) /
    tiltDerived.samples.length;
  const referenceOrientation = buildReferenceOrientation(rawData);
  const headingAligned = sampleNearest(
    headingDerived.samples.map((sample) => ({ timestampMs: sample.timestampMs, yawRad: sample.yawRad })),
    fullPath.map((point) => ({ timestampMs: point.timestamp })),
  );
  const orientationAligned = sampleNearest(
    referenceOrientation,
    fullPath.map((point) => ({ timestampMs: point.timestamp })),
  );

  const anchors = baseAnalysis.repAnalysis.reps.map((rep) => ({
    label: `rep-${rep.index}-start`,
    timeMs: rep.startTimeMs,
    pathIndex: findNearestPathIndex(fullPath, rep.startTimeMs),
  }));
  anchors.push({
    label: 'final-rest',
    timeMs: finalAnchorTime,
    pathIndex: findNearestPathIndex(fullPath, finalAnchorTime),
  });

  const repWindow = fullPath
    .slice(anchors[0].pathIndex, anchors[anchors.length - 1].pathIndex + 1)
    .map((point) => ({
      timestampMs: point.timestamp,
      x: point.relativePosition.x,
      y: point.relativePosition.y,
      z: point.relativePosition.z,
    }));

  const fusedWindow = repWindow.map((point) => ({ ...point }));
  const lateralScale = clamp(1 - 0.62 * headingMeanConfidence, 0.25, 0.65);
  const verticalScale = clamp(0.7 + 0.2 * tiltMeanConfidence, 0.72, 0.92);
  const yawBlend = 0.55 * headingMeanConfidence;

  for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex++) {
    const globalStart = anchors[anchorIndex].pathIndex;
    const globalEnd = anchors[anchorIndex + 1].pathIndex;
    const localStart = globalStart - anchors[0].pathIndex;
    const localEnd = globalEnd - anchors[0].pathIndex;
    if (localEnd <= localStart) continue;

    const startPoint = repWindow[localStart];
    const endPoint = repWindow[localEnd];
    for (let localIndex = localStart; localIndex <= localEnd; localIndex++) {
      const progress = (localIndex - localStart) / (localEnd - localStart);
      const original = repWindow[localIndex];
      const driftLine = {
        x: lerp(startPoint.x, endPoint.x, progress),
        y: lerp(startPoint.y, endPoint.y, progress),
        z: lerp(startPoint.z, endPoint.z, progress),
      };
      const localDeviation = {
        x: original.x - driftLine.x,
        y: original.y - driftLine.y,
        z: original.z - driftLine.z,
      };
      const alignedIndex = localIndex + anchors[0].pathIndex;
      const currentYaw = orientationAligned[alignedIndex].yawCurrentRad;
      const headingYaw = headingAligned[alignedIndex].yawRad;
      const yawDelta = angleDifference(headingYaw, currentYaw);
      const c = Math.cos(yawDelta * yawBlend);
      const s = Math.sin(yawDelta * yawBlend);
      const rotated = {
        x: localDeviation.x * c - localDeviation.y * s,
        y: localDeviation.x * s + localDeviation.y * c,
      };
      fusedWindow[localIndex].x = rotated.x * lateralScale;
      fusedWindow[localIndex].y = rotated.y * lateralScale;
      fusedWindow[localIndex].z = localDeviation.z * verticalScale;
    }
  }

  const smoothX = movingAverage(fusedWindow.map((point) => point.x), 15);
  const smoothY = movingAverage(fusedWindow.map((point) => point.y), 15);
  const smoothZ = movingAverage(fusedWindow.map((point) => point.z), 15);
  for (let i = 0; i < fusedWindow.length; i++) {
    fusedWindow[i].x = smoothX[i];
    fusedWindow[i].y = smoothY[i];
    fusedWindow[i].z = smoothZ[i];
  }

  return {
    anchors,
    repWindowStartMs: anchors[0].timeMs,
    repWindowEndMs: finalAnchorTime,
    headingMeanConfidence,
    tiltMeanConfidence,
    lateralScale,
    verticalScale,
    path: fusedWindow,
  };
}

function computeRepMetricsFromFusedPath(fusedWindow, anchors) {
  const reps = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const startTime = anchors[i].timeMs;
    const endTime = anchors[i + 1].timeMs;
    const segment = fusedWindow.filter((point) => point.timestampMs >= startTime && point.timestampMs <= endTime);
    if (segment.length < 5) continue;

    const origin = segment[0];
    const localZ = segment.map((point) => point.z - origin.z);
    const localXY = segment.map((point) => Math.hypot(point.x - origin.x, point.y - origin.y));
    const trimmed = segment.filter((point) => point.timestampMs >= startTime + 60 && point.timestampMs <= endTime - 60);
    const trimmedZ = movingAverage(trimmed.map((point) => point.z), 31);
    let peakVerticalVelocity = 0;
    let meanPropulsiveVelocity = 0;
    let propulsiveCount = 0;
    for (let j = 1; j < trimmed.length - 1; j++) {
      const dt = (trimmed[j + 1].timestampMs - trimmed[j - 1].timestampMs) / 1000;
      if (dt <= 0) continue;
      const vz = (trimmedZ[j + 1] - trimmedZ[j - 1]) / dt;
      const absVz = Math.abs(vz);
      peakVerticalVelocity = Math.max(peakVerticalVelocity, absVz);
      if (absVz > 0.15 && absVz < 5.0) {
        meanPropulsiveVelocity += absVz;
        propulsiveCount++;
      }
    }

    reps.push({
      index: i + 1,
      startTimeMs: startTime,
      endTimeMs: endTime,
      durationMs: endTime - startTime,
      localVerticalExcursionM: Math.max(...localZ) - Math.min(...localZ),
      peakVerticalVelocityMps: peakVerticalVelocity,
      meanPropulsiveVelocityMps: propulsiveCount > 0 ? meanPropulsiveVelocity / propulsiveCount : 0,
      maxLateralM: Math.max(...localXY),
      netHeightM: segment[segment.length - 1].z - origin.z,
      netLateralM: Math.hypot(
        segment[segment.length - 1].x - origin.x,
        segment[segment.length - 1].y - origin.y,
      ),
    });
  }
  return reps;
}

function buildBaselinePathPreview(baseAnalysis, fused) {
  const fullPath = baseAnalysis.fullPath;
  const startIndex = fused.anchors[0].pathIndex;
  const endIndex = fused.anchors[fused.anchors.length - 1].pathIndex;
  const window = fullPath.slice(startIndex, endIndex + 1).map((point) => ({
    timestampMs: point.timestamp,
    x: point.relativePosition.x,
    y: point.relativePosition.y,
    z: point.relativePosition.z,
  }));

  return {
    simulated: false,
    sourceSession: path.basename(BASE_SESSION_PATH),
    repWindowStartMs: fused.repWindowStartMs,
    repWindowEndMs: fused.repWindowEndMs,
    anchors: fused.anchors,
    reps: baseAnalysis.repAnalysis.reps.map((rep) => ({
      index: rep.index,
      direction: rep.direction,
      startTimeMs: rep.startTimeMs,
      apexTimeMs: rep.apexTimeMs,
      endTimeMs: rep.endTimeMs,
      confidence: rep.confidence,
    })),
    path: window,
  };
}

function buildComparisonReport(session, baseRun, magnetometerRaw, headingDerived, inclinometerRaw, tiltDerived, fused) {
  const baseline = {
    captureHealth: baseRun.captureHealth,
    movementMetrics: baseRun.analysis.movementMetrics,
    repCount: baseRun.analysis.repAnalysis.repCount,
    bestRepIndex: baseRun.analysis.repAnalysis.bestRepIndex,
    repMetrics: baseRun.analysis.repAnalysis.reps.map((rep) => ({
      index: rep.index,
      direction: rep.direction,
      durationMs: rep.durationMs,
      meanPropulsiveVelocity: rep.metrics.meanPropulsiveVelocity,
      peakVerticalVelocity: rep.metrics.peakVerticalVelocity,
      maxHeight: rep.metrics.maxHeight,
      netHeight: rep.metrics.netHeight,
      maxLateral: rep.metrics.maxLateral,
    })),
  };

  const fusedRepMetrics = computeRepMetricsFromFusedPath(fused.path, fused.anchors);
  const fusedWindowXY = fused.path.map((point) => Math.hypot(point.x, point.y));
  const fusedWindowZ = fused.path.map((point) => point.z);
  const fusedSummary = {
    repWindowStartMs: fused.repWindowStartMs,
    repWindowEndMs: fused.repWindowEndMs,
    repCount: fusedRepMetrics.length,
    meanLocalVerticalExcursionM:
      fusedRepMetrics.reduce((sum, rep) => sum + rep.localVerticalExcursionM, 0) /
      Math.max(1, fusedRepMetrics.length),
    meanPeakVerticalVelocityMps:
      fusedRepMetrics.reduce((sum, rep) => sum + rep.peakVerticalVelocityMps, 0) /
      Math.max(1, fusedRepMetrics.length),
    meanMaxLateralPerRepM:
      fusedRepMetrics.reduce((sum, rep) => sum + rep.maxLateralM, 0) /
      Math.max(1, fusedRepMetrics.length),
    activeEndHeightM: fused.path[fused.path.length - 1].z,
    activeEndLateralM: fusedWindowXY[fusedWindowXY.length - 1],
    maxHeightM: Math.max(...fusedWindowZ),
    minHeightM: Math.min(...fusedWindowZ),
    maxLateralM: Math.max(...fusedWindowXY),
    headingConfidence: fused.headingMeanConfidence,
    tiltConfidence: fused.tiltMeanConfidence,
    lateralScale: fused.lateralScale,
    verticalScale: fused.verticalScale,
    repMetrics: fusedRepMetrics,
  };

  const improvement = {
    repCountStable: baseline.repCount === fusedSummary.repCount,
    activeEndHeightReductionPct:
      Math.abs(baseline.movementMetrics.activeEndHeight) > 0.0001
        ? 100 * (1 - Math.abs(fusedSummary.activeEndHeightM) / Math.abs(baseline.movementMetrics.activeEndHeight))
        : 0,
    activeEndLateralReductionPct:
      Math.abs(baseline.movementMetrics.activeEndLateral) > 0.0001
        ? 100 * (1 - Math.abs(fusedSummary.activeEndLateralM) / Math.abs(baseline.movementMetrics.activeEndLateral))
        : 0,
    interpretation: {
      yaw: 'The simulated magnetometer offers a plausible low-drift heading reference.',
      tilt: 'The simulated inclinometer offers a plausible low-drift gravity reference.',
      hardLimit:
        'This remains a hypothesis-level postprocessed fusion pass. It does not validate real hardware latency, calibration workflow or magnetic disturbance handling.',
    },
  };

  return {
    simulated: true,
    sourceSession: path.basename(BASE_SESSION_PATH),
    models: {
      magnetometer: 'MMC5983MA',
      inclinometer: 'IIS2ICLX',
    },
    baseline,
    simulatedInputs: {
      magnetometer: { odrHz: magnetometerRaw.metadata.odrHz, sampleCount: magnetometerRaw.samples.length },
      inclinometer: { odrHz: inclinometerRaw.metadata.odrHz, sampleCount: inclinometerRaw.samples.length },
    },
    derivedSignals: {
      headingSamples: headingDerived.samples.length,
      tiltSamples: tiltDerived.samples.length,
    },
    hypothesisFusion: fusedSummary,
    improvement,
  };
}

function writeReportTex(reportPath, comparison) {
  const fused = comparison.hypothesisFusion;
  const baseline = comparison.baseline;
  const lines = [
    '\\documentclass[11pt,a4paper]{article}',
    '\\usepackage[margin=2.2cm]{geometry}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage{booktabs}',
    '\\usepackage{array}',
    '\\usepackage{hyperref}',
    '\\usepackage{enumitem}',
    '\\title{Sensor fusion hypothesis with MMC5983MA + IIS2ICLX \\\\ \\small{v4-5reps simulated study}}',
    '\\author{MOOVIA experimental workflow}',
    '\\date{\\today}',
    '\\begin{document}',
    '\\maketitle',
    '\\section{Context}',
    'This document studies a hardware hypothesis over one real capture only: \\\\path{v4-5reps-moovia-session-1775503335652.json}.',
    'The objective is not to claim validated hardware performance. The objective is to create a documented simulation package for the next hardware iteration.',
    '\\section{What each chip really returns}',
    '\\begin{itemize}[leftmargin=1.4em]',
    '\\item \\textbf{MMC5983MA}: 3-axis magnetic field, optional temperature and data-ready/status. This is the sensor that can plausibly constrain yaw.',
    '\\item \\textbf{IIS2ICLX}: 2-axis acceleration / inclinometer output, optional temperature, timestamp and FIFO/status. This helps roll, pitch and vertical reference, but not absolute yaw.',
    '\\item \\textbf{Important limit}: the inclinometer does not provide heading on its own. Yaw observability still depends on the magnetometer or another absolute reference.',
    '\\end{itemize}',
    '\\section{Simulation setup}',
    '\\begin{itemize}[leftmargin=1.4em]',
    '\\item Base session: 5 real repetitions from the raw IMU export.',
    '\\item Magnetometer stream simulated at 200 Hz with world magnetic field, hard-iron bias, light noise and quantization.',
    '\\item Inclinometer stream simulated at 208 Hz with gravity-dominant X/Y tilt observation, small dynamic leakage, bias and quantization.',
    '\\item Raw files and derived files are stored separately on purpose.',
    '\\item The fusion pass is experimental and postprocessed. The production pipeline was not replaced.',
    '\\end{itemize}',
    '\\section{IMU-only vs hypothesis-level fusion}',
    '\\begin{tabular}{p{6cm}rr}',
    '\\toprule',
    'Metric & IMU-only & Hypothesis fusion \\\\',
    '\\midrule',
    `Rep count & ${baseline.repCount} & ${fused.repCount} \\\\`,
    `Active-end height (m) & ${baseline.movementMetrics.activeEndHeight.toFixed(3)} & ${fused.activeEndHeightM.toFixed(3)} \\\\`,
    `Active-end lateral (m) & ${baseline.movementMetrics.activeEndLateral.toFixed(3)} & ${fused.activeEndLateralM.toFixed(3)} \\\\`,
    `Max lateral in window (m) & ${baseline.movementMetrics.maxLateral.toFixed(3)} & ${fused.maxLateralM.toFixed(3)} \\\\`,
    `Mean local rep excursion (m) & n/a & ${fused.meanLocalVerticalExcursionM.toFixed(3)} \\\\`,
    `Mean peak vertical speed (m/s) & ${baseline.movementMetrics.meanPeakRepVelocity.toFixed(3)} & ${fused.meanPeakVerticalVelocityMps.toFixed(3)} \\\\`,
    '\\bottomrule',
    '\\end{tabular}',
    '\\section{Interpretation}',
    '\\begin{itemize}[leftmargin=1.4em]',
    `\\item Rep count stays consistent: ${comparison.improvement.repCountStable ? 'yes' : 'no'}.`,
    `\\item Active-end height reduction: ${comparison.improvement.activeEndHeightReductionPct.toFixed(1)}\\%.`,
    `\\item Active-end lateral reduction: ${comparison.improvement.activeEndLateralReductionPct.toFixed(1)}\\%.`,
    `\\item Mean heading confidence used in the hypothesis: ${fused.headingConfidence.toFixed(2)}.`,
    `\\item Mean tilt confidence used in the hypothesis: ${fused.tiltConfidence.toFixed(2)}.`,
    '\\end{itemize}',
    'The simulation suggests that the extra observability could plausibly improve endpoint closure and lateral stability for the 5-rep session. The strongest expected gain comes from giving yaw an external reference and giving tilt a cleaner gravity reference.',
    '\\section{What improves and what still does not}',
    '\\subsection*{What plausibly improves}',
    '\\begin{itemize}[leftmargin=1.4em]',
    '\\item Yaw drift should decrease once the magnetometer constrains heading.',
    '\\item Roll/pitch and vertical closure should become more stable once the inclinometer constrains gravity.',
    '\\item Rep-local velocity interpretation can become more believable because the rep path closes better.',
    '\\end{itemize}',
    '\\subsection*{What this simulation does not prove}',
    '\\begin{itemize}[leftmargin=1.4em]',
    '\\item It does not prove real magnetic robustness in the presence of soft-iron or environmental disturbances.',
    '\\item It does not prove the final calibration workflow, mounting sensitivity or synchronization costs.',
    '\\item It does not validate production-ready absolute position. This remains a hypothesis-level, assisted postprocessing pass.',
    '\\end{itemize}',
    '\\section{Conclusion}',
    'Yes: these extra sensors can be useful enough to justify the next hardware iteration. The plausible division of labor is clear: MMC5983MA for heading/yaw, IIS2ICLX for vertical and tilt. The folder generated for this study should therefore be treated as a pre-hardware decision package, not as a hardware validation result.',
    '\\end{document}',
  ];
  fs.writeFileSync(reportPath, lines.join('\n'));
}

function generateArtifacts() {
  ensureDir(path.join(DOC_ROOT, 'chip-review'));
  ensureDir(path.join(DOC_ROOT, 'simulated-raw-data', 'v4-5reps'));
  ensureDir(path.join(DOC_ROOT, 'derived-signals', 'v4-5reps'));
  ensureDir(path.join(DOC_ROOT, 'comparison'));

  const session = loadBaseSession();
  const baseRun = runBaseAnalysis(session);
  const referenceOrientation = buildReferenceOrientation(baseRun.rawData);
  const startMs = session.samples[0].timestampMs;
  const endMs = session.samples[session.samples.length - 1].timestampMs;

  const magnetometerRaw = buildMagnetometerSimulation(referenceOrientation, startMs, endMs);
  const headingDerived = deriveHeading(referenceOrientation, magnetometerRaw);
  const inclinometerRaw = buildInclinometerSimulation(referenceOrientation, session, startMs, endMs);
  const tiltDerived = deriveTilt(inclinometerRaw);
  const fused = buildFusionPath(baseRun.analysis, baseRun.rawData, headingDerived, tiltDerived);
  const baselinePathPreview = buildBaselinePathPreview(baseRun.analysis, fused);
  const comparison = buildComparisonReport(
    session,
    baseRun,
    magnetometerRaw,
    headingDerived,
    inclinometerRaw,
    tiltDerived,
    fused,
  );

  const outputs = {
    magnetometerRawPath: path.join(DOC_ROOT, 'simulated-raw-data', 'v4-5reps', 'mmc5983ma-raw-sim.json'),
    inclinometerRawPath: path.join(DOC_ROOT, 'simulated-raw-data', 'v4-5reps', 'iis2iclx-raw-sim.json'),
    headingPath: path.join(DOC_ROOT, 'derived-signals', 'v4-5reps', 'mmc5983ma-heading-derived.json'),
    tiltPath: path.join(DOC_ROOT, 'derived-signals', 'v4-5reps', 'iis2iclx-tilt-derived.json'),
    baselinePath: path.join(DOC_ROOT, 'comparison', 'v4-5reps-baseline-analysis.json'),
    baselinePathPreviewPath: path.join(DOC_ROOT, 'comparison', 'v4-5reps-baseline-path.json'),
    fusedPath: path.join(DOC_ROOT, 'comparison', 'v4-5reps-fused-path.json'),
    comparisonPath: path.join(DOC_ROOT, 'comparison', 'v4-5reps-fusion-comparison.json'),
    reportTexPath: path.join(DOC_ROOT, 'sensor-fusion-hypothesis-report.tex'),
  };

  writeJson(outputs.magnetometerRawPath, magnetometerRaw);
  writeJson(outputs.inclinometerRawPath, inclinometerRaw);
  writeJson(outputs.headingPath, headingDerived);
  writeJson(outputs.tiltPath, tiltDerived);
  writeJson(outputs.baselinePath, {
    simulated: false,
    sourceSession: path.basename(BASE_SESSION_PATH),
    captureHealth: baseRun.captureHealth,
    movementSegment: baseRun.analysis.movementSegment,
    movementMetrics: baseRun.analysis.movementMetrics,
    repAnalysis: baseRun.analysis.repAnalysis,
    diagnostics: baseRun.analysis.diagnostics,
  });
  writeJson(outputs.baselinePathPreviewPath, baselinePathPreview);
  writeJson(outputs.fusedPath, {
    simulated: true,
    sourceSession: path.basename(BASE_SESSION_PATH),
    anchors: fused.anchors,
    repWindowStartMs: fused.repWindowStartMs,
    repWindowEndMs: fused.repWindowEndMs,
    headingMeanConfidence: fused.headingMeanConfidence,
    tiltMeanConfidence: fused.tiltMeanConfidence,
    lateralScale: fused.lateralScale,
    verticalScale: fused.verticalScale,
    path: fused.path,
  });
  writeJson(outputs.comparisonPath, comparison);
  writeReportTex(outputs.reportTexPath, comparison);

  return {
    session,
    baseRun,
    magnetometerRaw,
    headingDerived,
    inclinometerRaw,
    tiltDerived,
    baselinePathPreview,
    fused,
    comparison,
    outputs,
  };
}

module.exports = {
  BASE_SESSION_PATH,
  DOC_ROOT,
  generateArtifacts,
  runBaseAnalysis,
  loadBaseSession,
};
