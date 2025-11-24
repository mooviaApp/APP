# Prisma Schema & Data Architecture

## Models & Relationships

The database schema is designed to support the core domain entities of MOOVIA.

### User
- **Central entity**: Represents a registered user.
- **Relationships**:
    - `profile`: One-to-One with `AthleteProfile`.
    - `devices`: One-to-Many with `Device`.
    - `sessions`: One-to-Many with `WorkoutSession`.

### AthleteProfile
- **Purpose**: Stores physical attributes of the user (weight, height, etc.).
- **Relation**: Belongs to a single `User`.

### Device
- **Purpose**: Represents a physical MOOVIA sensor device.
- **Relation**: Belongs to a `User`.

### WorkoutSession
- **Purpose**: Represents a single workout session.
- **Relation**: Belongs to a `User`. Contains multiple `Set`s.

### Set
- **Purpose**: Represents a set of an exercise within a session.
- **Relation**: Belongs to a `WorkoutSession`.
- **Future Integration**: Will eventually link to raw BLE data (`SensorPacket`s), likely stored in a time-series database or as a JSON blob, but for now, we track the summary data (weight, reps).

## Data Flow

1.  **User Registration**: Creates a `User` record.
2.  **Profile Setup**: Creates an `AthleteProfile` linked to the `User`.
3.  **Device Pairing**: Creates a `Device` record linked to the `User`.
4.  **Workout**:
    - User starts a session -> Creates `WorkoutSession`.
    - User performs a set -> Creates `Set` linked to `WorkoutSession`.
    - Sensor data is processed to calculate metrics (velocity, ROM) and stored/associated with the `Set`.

## Future BLE Mapping

Raw sensor data (`SensorPacket`) is high-frequency and may not be suitable for a relational column per packet.
Strategies:
- **JSONB**: Store packets as a JSON array in the `Set` table (if size permits).
- **Time-Series DB**: Store packets in InfluxDB/TimescaleDB and link via `setId`.
- **Blob Storage**: Store binary/JSON files in S3 and reference the URL in `Set`.
