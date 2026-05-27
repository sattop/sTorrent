export const SPEED_DOCTOR_ACTION_IDS = [
  "remove_temporary_limit",
  "switch_download_profile",
  "toggle_dht_for_public_torrent",
  "check_port",
  "enable_upnp_nat_pmp",
  "choose_network_interface",
  "check_proxy",
  "move_up_queue",
  "raise_file_priority",
  "open_folder",
  "recheck_data",
  "show_trackers",
  "copy_report"
] as const;

export type SpeedDoctorActionId = (typeof SPEED_DOCTOR_ACTION_IDS)[number];
export type SpeedDoctorStatus = "ready_for_future_diagnostics";

export interface SpeedDoctorBaseline {
  status: SpeedDoctorStatus;
  supportedActions: SpeedDoctorActionId[];
  requiresConfirmationForMutations: true;
}
