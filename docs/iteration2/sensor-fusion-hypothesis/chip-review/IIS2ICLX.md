# IIS2ICLX review

Official sources:

- Datasheet PDF: <https://www.st.com/resource/en/datasheet/iis2iclx.pdf>
- Tilt application note:
  <https://www.st.com/resource/en/application_note/an5551-precise-and-accurate-tilt-sensing-in-industrial-applications-stmicroelectronics.pdf>

What it really returns:

- 2-axis accelerometer / inclinometer data
- optional temperature
- timestamp
- FIFO and data-ready related status

Useful integration facts for the hypothesis:

- the chip is aimed at high-accuracy tilt use cases
- ODR goes up to `833 Hz`
- full-scale options include `+-0.5 g`, `+-1 g`, `+-2 g`, `+-3 g`
- it has a 32-bit timestamp with `25 us` LSB
- it is useful for stabilizing gravity, vertical, roll and pitch

What it does not return:

- absolute yaw
- heading
- 3D position

Important system implication:

- an inclinometer helps with vertical reference and tilt
- it does **not** solve yaw on its own
- for yaw we still need the magnetometer or another external absolute reference

Simulation convention used in this repo:

- raw output is stored as `ax_raw`, `ay_raw`
- the synthetic generator models this as a high-precision 2-axis gravity-dominant
  signal, with small dynamic leakage, bias, noise and quantization
- derived tilt angles are written to a separate file and are not mixed with raw
