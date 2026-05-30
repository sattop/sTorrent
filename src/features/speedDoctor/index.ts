import {
  SPEED_DOCTOR_ACTION_IDS,
  type SpeedDoctorBaseline
} from "./types";

export function createSpeedDoctorBaseline(): SpeedDoctorBaseline {
  return {
    status: "diagnostics_v1",
    supportedActions: [...SPEED_DOCTOR_ACTION_IDS],
    requiresConfirmationForMutations: true
  };
}

export { SPEED_DOCTOR_ACTION_IDS };
export type { SpeedDoctorActionId, SpeedDoctorBaseline } from "./types";
