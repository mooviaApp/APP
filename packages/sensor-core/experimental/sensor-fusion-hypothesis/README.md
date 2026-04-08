# Sensor Fusion Hypothesis

This folder contains an isolated, non-production prototype used to study a
future sensor stack for MOOVIA:

- `MMC5983MA` as the auxiliary 3-axis magnetometer for heading/yaw control
- `IIS2ICLX` as the auxiliary 2-axis inclinometer for vertical, roll and pitch

Important boundaries:

- This code does **not** replace the current `TrajectoryService`
- This code uses **simulated** auxiliary sensor streams
- The simulation is anchored to one real session:
  `C:\MOOVIA_APP\APP\JSON_PRUEBAS_VERTICALES\v4-5reps-moovia-session-1775503335652.json`
- The goal is to estimate how much the extra observability could help before
  ordering and integrating the real hardware

Main files:

- `sensorFusionHypothesis.js`: reusable helpers for the simulation, derivation
  and hypothesis-level fusion pass
- `generate-hypothesis-artifacts.js`: end-to-end runner that generates the docs
  artifacts, JSON outputs and comparison report under
  `C:\MOOVIA_APP\APP\docs\iteration2\sensor-fusion-hypothesis`

The generated outputs are intentionally marked as simulated. They are meant to
support design decisions, not to claim hardware-validated performance.
