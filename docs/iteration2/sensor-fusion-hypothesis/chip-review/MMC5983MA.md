# MMC5983MA review

Official sources:

- Product page: <https://www.memsic.com/magnetometer-5>
- Datasheet PDF:
  <https://www.memsic.com/Public/Uploads/uploadfile/files/20220119/MMC5983MADatasheetRevA.pdf>

What it really returns:

- 3-axis magnetic field measurement
- optional temperature reading
- status / data-ready information

Useful integration facts for the hypothesis:

- magnetic output is 3D, so it can help constrain heading/yaw
- range: `+-8 G`
- resolution: up to `18-bit`
- nominal max ODR: `1000 Hz`
- interface: `I2C` or `SPI`
- on-chip temperature sensor and measurement-done flags exist

What it does not return:

- position
- velocity
- tilt angle by itself

Why it matters here:

- this is the sensor that can plausibly reduce yaw drift
- lower yaw drift should reduce lateral path distortion in the rep session

Simulation convention used in this repo:

- raw output is stored as `mx_raw`, `my_raw`, `mz_raw`
- the synthetic generator also stores assumptions in metadata:
  world magnetic field, hard-iron bias, soft noise and quantization
