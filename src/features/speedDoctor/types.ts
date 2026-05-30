import {
  SPEED_DOCTOR_ACTION_IDS,
  type SpeedDoctorActionId,
  type TorrentSpeedDoctorReport
} from "../../../electron/torrentCore/contracts";

export { SPEED_DOCTOR_ACTION_IDS };
export type { SpeedDoctorActionId, TorrentSpeedDoctorReport };

export type SpeedDoctorStatus = "diagnostics_v1";

export interface SpeedDoctorBaseline {
  status: SpeedDoctorStatus;
  supportedActions: SpeedDoctorActionId[];
  requiresConfirmationForMutations: true;
}
