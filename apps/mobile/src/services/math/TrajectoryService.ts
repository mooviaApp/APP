/**
 * Trajectory Service Wrapper
 * 
 * Re-exports the singleton instance from @moovia/sensor-core
 * to maintain compatibility with existing mobile code.
 */

export { trajectoryService, TrajectoryService } from '@moovia/sensor-core';
export type { TrajectoryPoint } from '@moovia/sensor-core';