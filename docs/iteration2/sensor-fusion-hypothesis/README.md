# Sensor Fusion Hypothesis

This folder documents a hypothesis for the next hardware iteration.

Target pair:

- Magnetometer: `MMC5983MA`
- Inclinometer / electronic pendulum: `IIS2ICLX`

Why this folder exists:

- the current IMU-only pipeline is good enough to study rep counting and some
  relative metrics
- it is still weak in absolute yaw, lateral drift and vertical closure
- we want a documented, traceable simulation before touching hardware

Ground rules:

- everything in this folder is a **simulation**
- the only real capture used as a base is:
  `C:\MOOVIA_APP\APP\JSON_PRUEBAS_VERTICALES\v4-5reps-moovia-session-1775503335652.json`
- the simulated raw streams keep the same 5-rep timing as that session
- raw sensor outputs and derived angles are stored in separate files

Subfolders:

- `chip-review`: datasheet-oriented notes about what each chip really returns
- `simulated-raw-data\v4-5reps`: synthetic raw outputs for each added sensor
- `derived-signals\v4-5reps`: heading and tilt derived from those raw signals
- `comparison`: IMU-only vs hypothesis-fusion outputs and summaries

Useful comparison files for the web test:

- `comparison\v4-5reps-fusion-comparison.json`
- `comparison\v4-5reps-fused-path.json`
- `comparison\v4-5reps-baseline-path.json`

The report `sensor-fusion-hypothesis-report.pdf` is the main narrative summary.
