const path = require('path');
const { generateArtifacts } = require('./sensorFusionHypothesis');

function main() {
  const result = generateArtifacts();
  const comparison = result.comparison;

  process.stdout.write(
    [
      'Sensor-fusion hypothesis artifacts generated.',
      `Source session: ${comparison.sourceSession}`,
      `Rep count (baseline -> fused): ${comparison.baseline.repCount} -> ${comparison.hypothesisFusion.repCount}`,
      `Active-end height (baseline -> fused): ${comparison.baseline.movementMetrics.activeEndHeight.toFixed(3)} -> ${comparison.hypothesisFusion.activeEndHeightM.toFixed(3)} m`,
      `Active-end lateral (baseline -> fused): ${comparison.baseline.movementMetrics.activeEndLateral.toFixed(3)} -> ${comparison.hypothesisFusion.activeEndLateralM.toFixed(3)} m`,
      `Report tex: ${path.basename(result.outputs.reportTexPath)}`,
    ].join('\n') + '\n',
  );
}

main();
