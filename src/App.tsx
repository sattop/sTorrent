import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type AIAdviceContext,
  type AIAdviceResult,
  type AIProviderConfig,
  type AIProviderId,
  type AIResult,
  type AISettings,
  type AISettingsState,
  type AIEvent,
  type ProviderTestResult,
  createDefaultAIProviderConfig,
  getAIProviderDefinition
} from "../electron/aiContracts";
import {
  clearStoredRemotePassword,
  createRemoteTorrentApi,
  getStoredRemotePassword,
  storeRemotePassword
} from "./app/remoteApi";
import {
  DOWNLOAD_PROFILE_IDS,
  type DownloadProfileId,
  type SmartAssistantRecommendation,
  type SmartAssistantSuggestion,
  createAssistantBaseline,
  createSmartAssistantRecommendation
} from "./features/assistant";
import { createSpeedDoctorBaseline } from "./features/speedDoctor";
import { SUPPORTED_LOCALES, type Locale, createTranslator } from "./i18n";
import type {
  AutomationSettings,
  AssistantScheduleSuggestion,
  AssistantState,
  AutomationSettingsState,
  BitTorrentEncryptionMode,
  FavoriteFolderSettings,
  NetworkDiagnosticsReport,
  NetworkProfileId,
  NetworkSettings,
  NetworkSettingsState,
  RemoteAccessHost,
  RemoteAccessSettings,
  RemoteAccessSettingsState,
  ProxyType,
  RssAutoLoadRuleSettings,
  SeedingRuleSettings,
  SpeedLimitScheduleSettings,
  SpeedDoctorActionId,
  SpeedDoctorScanMode,
  TorrentCoreEvent,
  TorrentCoreResult,
  TorrentCoreSnapshot,
  TorrentFilePriority,
  TorrentSpeedDoctorReport,
  TorrentSummary,
  WatchFolderSettings
} from "../electron/torrentCore/contracts";
import {
  BITTORRENT_ENCRYPTION_MODES,
  NETWORK_PROFILE_IDS,
  PROXY_TYPES,
  TORRENT_FILE_PRIORITIES
} from "../electron/torrentCore/contracts";
import type {
  AppUpdateState,
  AppUpdateStatus
} from "../electron/appUpdateContracts";

const localeNames: Record<Locale, string> = {
  ru: "Русский",
  en: "English",
  es: "Español",
  zh: "中文"
};

const navItems = [
  "downloads",
  "queue",
  "files",
  "trackers",
  "stats",
  "automation",
  "settings"
] as const;

type NavItem = (typeof navItems)[number];

const LAST_DOWNLOAD_PROFILE_KEY = "storent.downloadProfile.last";
const AUTO_SPEED_DOCTOR_ACTIVE_MS = 3 * 60 * 1000;
const AUTO_SPEED_DOCTOR_THROTTLE_MS = 30 * 60 * 1000;
const AUTO_SPEED_DOCTOR_LOW_SPEED_BYTES = 64 * 1024;
const ADD_ASSISTANT_ADVICE_KEY = "add";

export function App() {
  const [locale, setLocale] = useState<Locale>("ru");
  const [activeNav, setActiveNav] = useState<NavItem>("downloads");
  const [magnetUri, setMagnetUri] = useState("");
  const [selectedProfileId, setSelectedProfileId] =
    useState<DownloadProfileId>(() => readStoredDownloadProfile());
  const [categoryDraft, setCategoryDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [snapshot, setSnapshot] = useState<TorrentCoreSnapshot>({
    torrents: [],
    downloadSpeedBytes: 0,
    uploadSpeedBytes: 0
  });
  const [networkState, setNetworkState] = useState<NetworkSettingsState | null>(
    null
  );
  const [networkDraft, setNetworkDraft] = useState<NetworkSettings | null>(null);
  const [automationState, setAutomationState] =
    useState<AutomationSettingsState | null>(null);
  const [automationDraft, setAutomationDraft] =
    useState<AutomationSettings | null>(null);
  const [selectedFavoriteFolderId, setSelectedFavoriteFolderId] = useState("");
  const [diagnostics, setDiagnostics] =
    useState<NetworkDiagnosticsReport | null>(null);
  const [speedDoctorReports, setSpeedDoctorReports] = useState<
    Record<string, TorrentSpeedDoctorReport>
  >({});
  const [metadataAssistantTorrentId, setMetadataAssistantTorrentId] =
    useState<string | null>(null);
  const [assistantState, setAssistantState] = useState<AssistantState | null>(
    null
  );
  const [assistantScheduleSuggestions, setAssistantScheduleSuggestions] =
    useState<Record<string, AssistantScheduleSuggestion>>({});
  const [speedDoctorHint, setSpeedDoctorHint] = useState<{
    torrentId: string;
    generatedAt: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    torrentId: string;
    x: number;
    y: number;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const autoSpeedDoctorActiveSince = useRef<Map<string, number>>(new Map());
  const autoSpeedDoctorLastHintAt = useRef<Map<string, number>>(new Map());
  const autoSpeedDoctorRunning = useRef<Set<string>>(new Set());
  const isRemoteWeb = !window.storent?.torrent;
  const [remotePassword, setRemotePassword] = useState(() =>
    isRemoteWeb ? getStoredRemotePassword() : ""
  );
  const [remotePasswordDraft, setRemotePasswordDraft] = useState("");
  const [remoteLoginMessage, setRemoteLoginMessage] = useState<string | null>(
    null
  );
  const [remoteAccessState, setRemoteAccessState] =
    useState<RemoteAccessSettingsState | null>(null);
  const [remoteAccessDraft, setRemoteAccessDraft] =
    useState<RemoteAccessSettings | null>(null);
  const [remoteAccessPasswordDraft, setRemoteAccessPasswordDraft] =
    useState("");
  const [aiState, setAiState] = useState<AISettingsState | null>(null);
  const [aiDraft, setAiDraft] = useState<AISettings | null>(null);
  const [aiApiKeyDraft, setAiApiKeyDraft] = useState("");
  const [aiProviderTest, setAiProviderTest] =
    useState<ProviderTestResult | null>(null);
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [assistantAdvice, setAssistantAdvice] = useState<
    Record<string, AIAdviceResult>
  >({});
  const [assistantAdviceLoading, setAssistantAdviceLoading] = useState<
    Record<string, boolean>
  >({});
  const [speedDoctorAdvice, setSpeedDoctorAdvice] = useState<
    Record<string, AIAdviceResult>
  >({});
  const [speedDoctorAdviceLoading, setSpeedDoctorAdviceLoading] = useState<
    Record<string, boolean>
  >({});
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(
    null
  );
  const torrentApi = useMemo(
    () => window.storent?.torrent ?? createRemoteTorrentApi(() => remotePassword),
    [remotePassword]
  );
  const t = useMemo(() => createTranslator(locale), [locale]);
  const aiEnabled = Boolean(aiState?.settings.enabled && window.storent?.ai);
  const dismissedWarningKeys = useMemo(
    () =>
      new Set(
        (assistantState?.dismissedWarnings ?? []).map((warning) =>
          createWarningDismissKey(warning.warningId, warning.torrentId)
        )
      ),
    [assistantState]
  );
  const assistant = createAssistantBaseline();
  const speedDoctor = createSpeedDoctorBaseline();
  const totalDownloadSpeed = snapshot.torrents.reduce(
    (total, torrent) => total + torrent.downloadSpeedBytes,
    0
  );
  const totalUploadSpeed = snapshot.torrents.reduce(
    (total, torrent) => total + torrent.uploadSpeedBytes,
    0
  );
  const activeDownloadCount = snapshot.torrents.filter(
    (torrent) => torrent.status === "downloading"
  ).length;
  const existingFileNames = useMemo(
    () =>
      snapshot.torrents.flatMap((torrent) =>
        torrent.files.map((file) => file.path || file.name)
      ),
    [snapshot.torrents]
  );
  const metadataAssistantTorrent =
    snapshot.torrents.find((torrent) => torrent.id === metadataAssistantTorrentId) ??
    null;
  const topSpeedDoctorTorrent = findSpeedDoctorCandidate(snapshot.torrents);
  const favoriteFolderTemplates = automationDraft?.favoriteFolders ?? [];
  const assistantRecommendation = useMemo(
    () =>
      createSmartAssistantRecommendation({
        selectedProfileId:
          selectedProfileId === "manual" ? undefined : selectedProfileId,
        lastSelectedProfileId: selectedProfileId,
        category: categoryDraft,
        tags: parseTags(tagsDraft),
        favoriteFolderSelected: Boolean(selectedFavoriteFolderId),
        favoriteFolders: favoriteFolderTemplates,
        activeDownloadCount,
        networkProfileId:
          networkState?.activeSettings.profileId ?? networkDraft?.profileId,
        privateMode:
          networkState?.activeSettings.privateMode ?? networkDraft?.privateMode,
        activeSpeedSchedule: Boolean(automationState?.activeSpeedScheduleId),
        existingFileNames
      }),
    [
      activeDownloadCount,
      automationState?.activeSpeedScheduleId,
      categoryDraft,
      existingFileNames,
      favoriteFolderTemplates,
      networkDraft?.privateMode,
      networkDraft?.profileId,
      networkState?.activeSettings.privateMode,
      networkState?.activeSettings.profileId,
      selectedFavoriteFolderId,
      selectedProfileId,
      tagsDraft
    ]
  );
  const metadataAssistantRecommendation = useMemo(
    () =>
      metadataAssistantTorrent
        ? createSmartAssistantRecommendation(
            createTorrentAssistantInput({
              torrent: metadataAssistantTorrent,
              selectedProfileId:
                metadataAssistantTorrent.selectedProfileId === "manual"
                  ? undefined
                  : metadataAssistantTorrent.selectedProfileId,
              activeDownloadCount,
              favoriteFolders: favoriteFolderTemplates,
              existingFileNames,
              networkProfileId:
                networkState?.activeSettings.profileId ?? networkDraft?.profileId,
              privateMode:
                networkState?.activeSettings.privateMode ??
                networkDraft?.privateMode,
              activeSpeedSchedule: Boolean(automationState?.activeSpeedScheduleId),
              disk:
                speedDoctorReports[metadataAssistantTorrent.id]?.technicalDetails
                  .disk ?? null
            })
          )
        : null,
    [
      activeDownloadCount,
      automationState?.activeSpeedScheduleId,
      existingFileNames,
      favoriteFolderTemplates,
      metadataAssistantTorrent,
      networkDraft?.privateMode,
      networkDraft?.profileId,
      networkState?.activeSettings.privateMode,
      networkState?.activeSettings.profileId,
      speedDoctorReports
    ]
  );

  useEffect(() => {
    storeDownloadProfile(selectedProfileId);
  }, [selectedProfileId]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    const api = torrentApi;

    if (isRemoteWeb && !remotePassword) {
      return;
    }

    let mounted = true;
    let pollingTimer: number | undefined;

    const refreshSnapshot = () => api.getSnapshot().then((result) => {
      if (mounted) {
        applyResult(
          result,
          setSnapshot,
          () => handleResultError(result)
        );
      }
    });

    void refreshSnapshot();

    void api.getNetworkSettings().then((result) => {
      if (mounted) {
        applyResult(
          result,
          (state) => {
            setNetworkState(state);
            setNetworkDraft(state.settings);
          },
          () => handleResultError(result)
        );
      }
    });

    void api.getAutomationSettings().then((result) => {
      if (mounted) {
        applyResult(
          result,
          (state) => {
            setAutomationState(state);
            setAutomationDraft(state.settings);
          },
          () => handleResultError(result)
        );
      }
    });

    const unsubscribe = api.onEvent((event) => {
      setSnapshot((current) => applyCoreEvent(current, event));

      if (event.type === "torrent.error") {
        setStatusMessage(t("error.operationFailed"));
      }

      if (
        event.type === "torrent.metadata.received" &&
        event.payload.sourceType === "magnet"
      ) {
        setMetadataAssistantTorrentId(event.payload.id);
        setActiveNav("downloads");
        void runTorrentSpeedDoctor(event.payload.id, {
          silent: true,
          automatic: true,
          mode: "quick"
        });
      }

      if (event.type === "assistant.schedule.suggestion") {
        setAssistantScheduleSuggestions((current) => ({
          ...current,
          [event.payload.suggestion.torrentId]: event.payload.suggestion
        }));
      }

      if (event.type === "settings.changed") {
        setNetworkState(event.payload.network);
        setNetworkDraft(event.payload.network.settings);
      }

      if (event.type === "diagnostics.speed.checked") {
        setDiagnostics(event.payload.report);
      }

      if (event.type === "diagnostics.torrent_speed.checked") {
        setSpeedDoctorReports((current) => ({
          ...current,
          [event.payload.report.torrentId]: event.payload.report
        }));
      }

      if (event.type === "automation.settings.changed") {
        setAutomationState(event.payload.automation);
        setAutomationDraft(event.payload.automation.settings);
      }

      if (event.type === "automation.watch.added") {
        setStatusMessage(t("message.watchTorrentAdded"));
      }

      if (event.type === "automation.watch.scan.completed") {
        setStatusMessage(
          `${t("message.watchScanCompleted")} ${
            event.payload.result.addedTorrents
          }`
        );
      }
    });

    if (isRemoteWeb) {
      pollingTimer = window.setInterval(() => {
        void refreshSnapshot();
      }, 2_000);
    }

    return () => {
      mounted = false;
      if (pollingTimer !== undefined) {
        window.clearInterval(pollingTimer);
      }
      unsubscribe();
    };
  }, [isRemoteWeb, remotePassword, t, torrentApi]);

  useEffect(() => {
    const api = window.storent?.assistant;

    if (!api) {
      return;
    }

    let mounted = true;

    void api.getState().then((result) => {
      if (!mounted) {
        return;
      }

      applyResult(result, setAssistantState, () =>
        setStatusMessage(t("assistant.stateUnavailable"))
      );
    });

    return () => {
      mounted = false;
    };
  }, [t]);

  useEffect(() => {
    const now = Date.now();
    const activeIds = new Set(snapshot.torrents.map((torrent) => torrent.id));

    for (const id of autoSpeedDoctorActiveSince.current.keys()) {
      if (!activeIds.has(id)) {
        autoSpeedDoctorActiveSince.current.delete(id);
        autoSpeedDoctorLastHintAt.current.delete(id);
        autoSpeedDoctorRunning.current.delete(id);
      }
    }

    for (const torrent of snapshot.torrents) {
      if (torrent.status !== "downloading" || !torrent.metadataReady) {
        autoSpeedDoctorActiveSince.current.delete(torrent.id);
        continue;
      }

      const activeSince =
        autoSpeedDoctorActiveSince.current.get(torrent.id) ?? now;
      autoSpeedDoctorActiveSince.current.set(torrent.id, activeSince);

      const hasExplicitLimit =
        networkState?.activeSettings.speedLimits.downloadBytesPerSecond !== null;
      const lowSpeed =
        torrent.downloadSpeedBytes < AUTO_SPEED_DOCTOR_LOW_SPEED_BYTES ||
        torrent.peers === 0;
      const lastHintAt = autoSpeedDoctorLastHintAt.current.get(torrent.id) ?? 0;

      if (
        hasExplicitLimit ||
        !lowSpeed ||
        now - activeSince < AUTO_SPEED_DOCTOR_ACTIVE_MS ||
        now - lastHintAt < AUTO_SPEED_DOCTOR_THROTTLE_MS ||
        autoSpeedDoctorRunning.current.has(torrent.id)
      ) {
        continue;
      }

      autoSpeedDoctorLastHintAt.current.set(torrent.id, now);
      autoSpeedDoctorRunning.current.add(torrent.id);
      void runTorrentSpeedDoctor(torrent.id, { silent: true, automatic: true })
        .then((report) => {
          if (report && report.status !== "ok") {
            setSpeedDoctorHint({
              torrentId: report.torrentId,
              generatedAt: report.generatedAt
            });
          }
        })
        .finally(() => {
          autoSpeedDoctorRunning.current.delete(torrent.id);
        });
    }
  }, [networkState?.activeSettings.speedLimits.downloadBytesPerSecond, snapshot.torrents]);

  useEffect(() => {
    const api = window.storent?.remoteAccess;

    if (!api) {
      return;
    }

    let mounted = true;

    void api.getSettings().then((result) => {
      if (!mounted) {
        return;
      }

      applyResult(
        result,
        (state) => {
          setRemoteAccessState(state);
          setRemoteAccessDraft({
            enabled: state.settings.enabled,
            host: state.settings.host,
            port: state.settings.port,
            allowedIps: state.settings.allowedIps
          });
        },
        () => setStatusMessage(t("error.operationFailed"))
      );
    });

    return () => {
      mounted = false;
    };
  }, [t]);

  useEffect(() => {
    const api = window.storent?.updates;

    if (!api) {
      return;
    }

    let mounted = true;
    void api.getState().then((state) => {
      if (mounted) {
        setAppUpdateState(state);
      }
    });

    const unsubscribe = api.onEvent((event) => {
      setAppUpdateState(event.state);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const api = window.storent?.ai;

    if (!api) {
      return;
    }

    let mounted = true;

    void api.getSettings().then((result) => {
      if (!mounted) {
        return;
      }

      applyAIResult(
        result,
        (state) => {
          setAiState(state);
          setAiDraft(state.settings);
        },
        () => setStatusMessage(t("ai.error"))
      );
    });

    const unsubscribe = api.onEvent((event) => {
      if (event.type === "ai.settings.changed") {
        setAiState(event.payload.state);
        setAiDraft(event.payload.state.settings);
      }

      if (event.type === "ai.provider.tested") {
        setAiProviderTest(event.payload.result);
      }

      if (event.type === "ai.models.loaded") {
        setAiModels(event.payload.models);
      }

      if (event.type === "assistant.llm.response") {
        const key = event.payload.torrentId ?? ADD_ASSISTANT_ADVICE_KEY;
        setAssistantAdvice((current) => ({
          ...current,
          [key]: event.payload.advice
        }));
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [t]);

  function handleResultError<T>(result: TorrentCoreResult<T>) {
    if (result.ok) {
      return;
    }

    if (isRemoteUnauthorized(result, isRemoteWeb)) {
      clearStoredRemotePassword();
      setRemotePassword("");
      setRemoteLoginMessage(t("remote.loginExpired"));
      return;
    }

    setStatusMessage(getFriendlyError(result, t));
  }

  async function submitRemoteLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const password = remotePasswordDraft.trim();

    if (!password) {
      setRemoteLoginMessage(t("remote.passwordRequired"));
      return;
    }

    const candidateApi = createRemoteTorrentApi(() => password);
    const result = await candidateApi.getSnapshot();

    if (result.ok) {
      storeRemotePassword(password);
      setRemotePassword(password);
      setRemotePasswordDraft("");
      setRemoteLoginMessage(null);
      return;
    }

    setRemoteLoginMessage(getFriendlyError(result, t));
  }

  async function addTorrentFile() {
    const addOptions = getAddOptions(
      automationDraft,
      selectedFavoriteFolderId,
      categoryDraft,
      tagsDraft
    );
    const result = await torrentApi.addTorrentFile({
      profileId: selectedProfileId,
      ...addOptions
    });

    handleTorrentResult(result, t("message.torrentAdded"));
  }

  async function addMagnet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!magnetUri.trim()) {
      setStatusMessage(t("error.emptyMagnet"));
      return;
    }

    const result = await torrentApi.addMagnet({
      magnetUri: magnetUri.trim(),
      profileId: selectedProfileId,
      ...getAddOptions(
        automationDraft,
        selectedFavoriteFolderId,
        categoryDraft,
        tagsDraft
      )
    });

    handleTorrentResult(result, t("message.torrentAdded"));

    if (result?.ok) {
      setMagnetUri("");
    }
  }

  async function pauseTorrent(id: string) {
    handleTorrentResult(
      await torrentApi.pause(id),
      t("message.torrentPaused")
    );
  }

  async function resumeTorrent(id: string) {
    handleTorrentResult(
      await torrentApi.resume(id),
      t("message.torrentResumed")
    );
  }

  async function removeTorrent(id: string) {
    const result = await torrentApi.remove(id);

    if (!result) {
      setStatusMessage(t("core.unavailable"));
      return;
    }

    if (result.ok) {
      setSnapshot(result.value);
      setStatusMessage(t("message.torrentRemoved"));
      return;
    }

    handleResultError(result);
  }

  async function recheckTorrent(id: string) {
    handleTorrentResult(
      await torrentApi.recheck(id),
      t("message.recheckStarted")
    );
  }

  async function updateTorrentLabels(
    id: string,
    category: string,
    tags: string
  ) {
    handleTorrentResult(
      await torrentApi.updateLabels({
        id,
        category,
        tags: parseTags(tags)
      }),
      t("message.labelsUpdated")
    );
  }

  async function updateTorrentProfile(id: string, profileId: DownloadProfileId) {
    handleTorrentResult(
      await torrentApi.updateProfile({
        id,
        profileId
      }),
      t("message.torrentProfileUpdated")
    );
  }

  async function setTorrentFilePriority(
    id: string,
    fileIndex: number,
    priority: TorrentFilePriority
  ) {
    handleTorrentResult(
      await torrentApi.setFilePriority({
        id,
        fileIndex,
        priority
      }),
      t("message.filePriorityUpdated")
    );
  }

  async function saveNetworkSettings() {
    if (!networkDraft) {
      return;
    }

    const result = await torrentApi.updateNetworkSettings(
      networkDraft
    );

    if (!result) {
      setStatusMessage(t("core.unavailable"));
      return;
    }

    if (result.ok) {
      setNetworkState(result.value);
      setNetworkDraft(result.value.settings);
      setStatusMessage(t("message.networkSettingsSaved"));
      return;
    }

    handleResultError(result);
  }

  async function runNetworkDiagnostics() {
    const result = await torrentApi.runNetworkDiagnostics();

    if (!result) {
      setStatusMessage(t("core.unavailable"));
      return;
    }

    if (result.ok) {
      setDiagnostics(result.value);
      setStatusMessage(t("message.networkDiagnosticsDone"));
      return;
    }

    handleResultError(result);
  }

  async function runTorrentSpeedDoctor(
    id: string,
    options: {
      silent?: boolean;
      automatic?: boolean;
      mode?: SpeedDoctorScanMode;
    } = {}
  ) {
    const result = await torrentApi.runSpeedDoctor(id, {
      mode: options.mode ?? (options.automatic ? "quick" : "full")
    });

    if (!result) {
      if (!options.silent) {
        setStatusMessage(t("core.unavailable"));
      }
      return null;
    }

    if (result.ok) {
      setSpeedDoctorReports((current) => ({
        ...current,
        [result.value.torrentId]: result.value
      }));
      if (!options.silent) {
        setStatusMessage(t("message.speedDoctorDone"));
      }
      return result.value;
    }

    if (!options.silent) {
      handleResultError(result);
    }
    return null;
  }

  async function applyNetworkSettingsPatch(patch: Partial<NetworkSettings>) {
    const currentSettings = networkDraft ?? networkState?.settings;

    if (!currentSettings) {
      setStatusMessage(t("networkSettings.loading"));
      return;
    }

    const result = await torrentApi.updateNetworkSettings({
      ...currentSettings,
      ...patch
    });

    if (!result) {
      setStatusMessage(t("core.unavailable"));
      return;
    }

    if (result.ok) {
      setNetworkState(result.value);
      setNetworkDraft(result.value.settings);
      setStatusMessage(t("message.networkSettingsSaved"));
      return;
    }

    handleResultError(result);
  }

  async function copySpeedDoctorReport(report: TorrentSpeedDoctorReport) {
    if (!navigator.clipboard) {
      setStatusMessage(t("error.operationFailed"));
      return;
    }

    await navigator.clipboard.writeText(
      report.technicalDetails.exportText || formatSpeedDoctorTechnicalReport(report)
    );
    setStatusMessage(t("message.speedDoctorReportCopied"));
  }

  async function saveSpeedDoctorReport(report: TorrentSpeedDoctorReport) {
    const result = await torrentApi.exportSpeedDoctorReport(report.torrentId);

    if (!result) {
      setStatusMessage(t("core.unavailable"));
      return;
    }

    if (result.ok) {
      setSpeedDoctorReports((current) => ({
        ...current,
        [result.value.report.torrentId]: result.value.report
      }));
      setStatusMessage(
        `${t("message.speedDoctorReportSaved")} ${result.value.reportPath}`
      );
      return;
    }

    handleResultError(result);
  }

  async function handleSpeedDoctorAction(
    torrent: TorrentSummary,
    report: TorrentSpeedDoctorReport,
    actionId: SpeedDoctorActionId
  ) {
    if (actionId === "copy_report") {
      await copySpeedDoctorReport(report);
      return;
    }

    if (actionId === "save_report") {
      await saveSpeedDoctorReport(report);
      return;
    }

    if (actionId === "show_trackers") {
      setActiveNav("trackers");
      return;
    }

    if (actionId === "check_port") {
      await runNetworkDiagnostics();
      return;
    }

    if (actionId === "choose_network_interface" || actionId === "check_proxy") {
      setActiveNav("settings");
      return;
    }

    if (actionId === "open_folder") {
      setActiveNav("files");
      return;
    }

    if (actionId === "move_up_queue") {
      setActiveNav("queue");
      return;
    }

    if (actionId === "open_speed_schedule") {
      setActiveNav("automation");
      return;
    }

    const confirmed = window.confirm(t("speedDoctor.confirmMutation"));

    if (!confirmed) {
      return;
    }

    if (actionId === "resume_torrent") {
      await resumeTorrent(torrent.id);
      return;
    }

    if (actionId === "switch_download_profile") {
      const assistantApi = window.storent?.assistant;

      if (assistantApi) {
        const result = await assistantApi.applyProfile({
          torrentId: torrent.id,
          profileId: "max_speed",
          source: "speed_doctor"
        });

        if (result.ok) {
          setSnapshot((current) => ({
            ...current,
            torrents: replaceById(current.torrents, result.value.id, result.value)
          }));
          void assistantApi.getState().then((stateResult) => {
            if (stateResult.ok) {
              setAssistantState(stateResult.value);
            }
          });
        } else {
          handleResultError(result);
        }
      } else {
        await updateTorrentProfile(torrent.id, "max_speed");
      }
      setSelectedProfileId("max_speed");
      return;
    }

    if (actionId === "remove_temporary_limit") {
      const currentLimits =
        (networkDraft ?? networkState?.settings)?.speedLimits ?? null;

      if (!currentLimits) {
        setStatusMessage(t("networkSettings.loading"));
        return;
      }

      await applyNetworkSettingsPatch({
        speedLimits: {
          ...currentLimits,
          downloadBytesPerSecond: null
        }
      });
      return;
    }

    if (actionId === "enable_upnp_nat_pmp") {
      await applyNetworkSettingsPatch({
        upnp: true,
        natPmp: true
      });
      const result = await window.storent?.torrent?.mapIncomingPort();

      if (!result) {
        return;
      }

      if (result.ok) {
        setStatusMessage(
          result.value.upnpStatus === "enabled" ||
            result.value.natPmpStatus === "enabled"
            ? t("message.portMappingDone")
            : t("message.portMappingUnavailable")
        );
        return;
      }

      handleResultError(result);
      return;
    }

    if (actionId === "toggle_dht_for_public_torrent") {
      await applyNetworkSettingsPatch({
        dht: true
      });
      return;
    }

    if (actionId === "prefer_encryption") {
      await applyNetworkSettingsPatch({
        encryptionMode: "preferred" as BitTorrentEncryptionMode
      });
      return;
    }

    if (actionId === "recheck_data") {
      await recheckTorrent(torrent.id);
      return;
    }

    if (actionId === "raise_file_priority") {
      const skippedFile = torrent.files.find((file) => file.priority === "skip");

      if (skippedFile) {
        await setTorrentFilePriority(torrent.id, skippedFile.index, "high");
      }
    }
  }

  function applyAddAssistantSuggestion(suggestion: SmartAssistantSuggestion) {
    if (suggestion.type === "folder") {
      setSelectedFavoriteFolderId(suggestion.value);
      return;
    }

    if (suggestion.type === "category") {
      setCategoryDraft(suggestion.value);
      return;
    }

    if (suggestion.type === "tags") {
      setTagsDraft(
        mergeTags(parseTags(tagsDraft), suggestion.values ?? [suggestion.value]).join(
          ", "
        )
      );
      return;
    }

    if (suggestion.type === "profile_template") {
      setSelectedProfileId(suggestion.value as DownloadProfileId);
    }
  }

  async function dismissAssistantWarning(warningId: string, torrentId: string | null) {
    const result = await window.storent?.assistant?.dismissWarning({
      warningId,
      torrentId
    });

    if (!result) {
      return;
    }

    if (result.ok) {
      setAssistantState(result.value);
      return;
    }

    handleResultError(result);
  }

  async function requestAssistantScheduleSuggestion(torrentId: string) {
    const result = await window.storent?.assistant?.getScheduleSuggestion(torrentId);

    if (!result) {
      setActiveNav("automation");
      return;
    }

    if (result.ok) {
      const suggestion = result.value;

      if (suggestion) {
        setAssistantScheduleSuggestions((current) => ({
          ...current,
          [suggestion.torrentId]: suggestion
        }));
      }
      setActiveNav("automation");
      return;
    }

    handleResultError(result);
  }

  async function applyMetadataAssistantRecommendation(
    torrent: TorrentSummary,
    recommendation: SmartAssistantRecommendation
  ) {
    const confirmed = window.confirm(t("assistant.applyExistingConfirm"));

    if (!confirmed) {
      return;
    }

    const assistantApi = window.storent?.assistant;

    if (assistantApi) {
      const result = await assistantApi.applyProfile({
        torrentId: torrent.id,
        profileId: recommendation.profileId,
        source: "existing_torrent"
      });

      if (result?.ok) {
        setSnapshot((current) => ({
          ...current,
          torrents: replaceById(current.torrents, result.value.id, result.value)
        }));
        void assistantApi.getState().then((stateResult) => {
          if (stateResult.ok) {
            setAssistantState(stateResult.value);
          }
        });
      } else if (result) {
        handleResultError(result);
      }
    } else {
      await updateTorrentProfile(torrent.id, recommendation.profileId);
    }

    const categorySuggestion = recommendation.suggestions.find(
      (suggestion) => suggestion.type === "category"
    );
    const tagSuggestion = recommendation.suggestions.find(
      (suggestion) => suggestion.type === "tags"
    );

    if (categorySuggestion || tagSuggestion) {
      await updateTorrentLabels(
        torrent.id,
        torrent.category ?? categorySuggestion?.value ?? "",
        mergeTags(torrent.tags, tagSuggestion?.values ?? []).join(", ")
      );
    }

    const prioritySuggestions = recommendation.suggestions.filter(
      (suggestion) => suggestion.type === "file_priority" && suggestion.filePath
    );

    for (const prioritySuggestion of prioritySuggestions) {
      const file = torrent.files.find(
        (candidate) =>
          candidate.path === prioritySuggestion.filePath ||
          candidate.name === prioritySuggestion.filePath
      );
      const priority = TORRENT_FILE_PRIORITIES.includes(
        prioritySuggestion.value as TorrentFilePriority
      )
        ? (prioritySuggestion.value as TorrentFilePriority)
        : "high";

      if (file) {
        await setTorrentFilePriority(torrent.id, file.index, priority);
      }
    }

    setMetadataAssistantTorrentId(null);
  }

  async function saveRemoteAccessSettings() {
    if (!remoteAccessDraft) {
      return;
    }

    const api = window.storent?.remoteAccess;

    if (!api) {
      setStatusMessage(t("core.unavailable"));
      return;
    }

    const result = await api.updateSettings({
      ...remoteAccessDraft,
      password: remoteAccessPasswordDraft.trim() || undefined
    });

    if (result.ok) {
      setRemoteAccessState(result.value);
      setRemoteAccessDraft({
        enabled: result.value.settings.enabled,
        host: result.value.settings.host,
        port: result.value.settings.port,
        allowedIps: result.value.settings.allowedIps
      });
      setRemoteAccessPasswordDraft("");
      setStatusMessage(t("message.remoteAccessSettingsSaved"));
      return;
    }

    setStatusMessage(getFriendlyError(result, t));
  }

  async function checkAppUpdate() {
    const state = await window.storent?.updates?.checkForUpdates();

    if (!state) {
      setStatusMessage(t("updates.unavailable"));
      return;
    }

    setAppUpdateState(state);
  }

  async function downloadAppUpdate() {
    const state = await window.storent?.updates?.downloadUpdate();

    if (!state) {
      setStatusMessage(t("updates.unavailable"));
      return;
    }

    setAppUpdateState(state);
  }

  async function installAppUpdate() {
    const state = await window.storent?.updates?.installUpdate();

    if (!state) {
      setStatusMessage(t("updates.unavailable"));
      return;
    }

    setAppUpdateState(state);
  }

  async function saveAISettings() {
    if (!aiDraft) {
      return;
    }

    const api = window.storent?.ai;

    if (!api) {
      setStatusMessage(t("ai.unavailable"));
      return;
    }

    const activeProviderId = aiDraft.activeProviderId;
    const result = await api.updateSettings({
      ...aiDraft,
      providers: aiDraft.providers.map((provider) =>
        provider.providerId === activeProviderId
          ? {
              ...provider,
              apiKey: aiApiKeyDraft.trim() || undefined
            }
          : provider
      )
    });

    if (result.ok) {
      setAiState(result.value);
      setAiDraft(result.value.settings);
      setAiApiKeyDraft("");
      setStatusMessage(t("ai.settingsSaved"));
      return;
    }

    setStatusMessage(getFriendlyAIError(result, t));
  }

  async function testAIProvider() {
    const provider = getActiveAIProvider(aiDraft);
    const api = window.storent?.ai;

    if (!provider || !api) {
      setStatusMessage(t("ai.unavailable"));
      return;
    }

    const result = await api.testProvider({
      ...provider,
      apiKey: aiApiKeyDraft.trim() || undefined
    });

    if (result.ok) {
      setAiProviderTest(result.value);
      setStatusMessage(
        result.value.success ? t("ai.testSuccess") : t("ai.testFailed")
      );
      return;
    }

    setStatusMessage(getFriendlyAIError(result, t));
  }

  async function loadAIModels() {
    const provider = getActiveAIProvider(aiDraft);
    const api = window.storent?.ai;

    if (!provider || !api) {
      setStatusMessage(t("ai.unavailable"));
      return;
    }

    const result = await api.listModels({
      ...provider,
      apiKey: aiApiKeyDraft.trim() || undefined
    });

    if (result.ok) {
      setAiModels(result.value);
      setStatusMessage(t("ai.modelsLoaded"));
      return;
    }

    setStatusMessage(getFriendlyAIError(result, t));
  }

  async function requestAddAssistantAdvice() {
    await requestAssistantAdvice(
      ADD_ASSISTANT_ADVICE_KEY,
      null,
      createAddAssistantAIContext({
        recommendation: assistantRecommendation,
        activeDownloadCount,
        currentDownloadSpeedBytes: totalDownloadSpeed,
        category: categoryDraft,
        tags: parseTags(tagsDraft),
        networkState
      })
    );
  }

  async function requestMetadataAssistantAdvice(
    torrent: TorrentSummary,
    recommendation: SmartAssistantRecommendation
  ) {
    await requestAssistantAdvice(
      torrent.id,
      torrent.id,
      createTorrentAIAdviceContext({
        torrent,
        recommendation,
        report: speedDoctorReports[torrent.id]
      })
    );
  }

  async function requestAssistantAdvice(
    key: string,
    torrentId: string | null,
    context: AIAdviceContext
  ) {
    const api = window.storent?.ai;

    if (!api) {
      setStatusMessage(t("ai.unavailable"));
      return;
    }

    setAssistantAdviceLoading((current) => ({ ...current, [key]: true }));
    const result = await api.requestAdvice({
      contextType: "sda",
      context,
      torrentId
    });

    if (result.ok) {
      setAssistantAdvice((current) => ({ ...current, [key]: result.value }));
    } else {
      setStatusMessage(getFriendlyAIError(result, t));
    }

    setAssistantAdviceLoading((current) => ({ ...current, [key]: false }));
  }

  async function requestSpeedDoctorAIAdvice(report: TorrentSpeedDoctorReport) {
    const api = window.storent?.ai;

    if (!api) {
      setStatusMessage(t("ai.unavailable"));
      return;
    }

    setSpeedDoctorAdviceLoading((current) => ({
      ...current,
      [report.torrentId]: true
    }));
    const result = await api.requestAdvice({
      contextType: "speedDoctor",
      context: createSpeedDoctorAIContext(report)
    });

    if (result.ok) {
      setSpeedDoctorAdvice((current) => ({
        ...current,
        [report.torrentId]: result.value
      }));
    } else {
      setStatusMessage(getFriendlyAIError(result, t));
    }

    setSpeedDoctorAdviceLoading((current) => ({
      ...current,
      [report.torrentId]: false
    }));
  }

  async function saveAutomationSettings() {
    if (!automationDraft) {
      return;
    }

    const result = await torrentApi.updateAutomationSettings(
      automationDraft
    );

    if (!result) {
      setStatusMessage(t("core.unavailable"));
      return;
    }

    if (result.ok) {
      setAutomationState(result.value);
      setAutomationDraft(result.value.settings);
      setStatusMessage(t("message.automationSettingsSaved"));
      return;
    }

    handleResultError(result);
  }

  async function runWatchFolderScan() {
    const result = await torrentApi.runWatchFolderScan();

    if (!result) {
      setStatusMessage(t("core.unavailable"));
      return;
    }

    if (result.ok) {
      setStatusMessage(
        `${t("message.watchScanCompleted")} ${result.value.addedTorrents}`
      );
      return;
    }

    handleResultError(result);
  }

  function handleTorrentResult(
    result: TorrentCoreResult<TorrentSummary> | undefined,
    successMessage: string
  ) {
    if (!result) {
      setStatusMessage(t("core.unavailable"));
      return;
    }

    if (result.ok) {
      setSnapshot((current) => ({
        ...current,
        torrents: upsertTorrent(current.torrents, result.value)
      }));
      setStatusMessage(successMessage);
      return;
    }

    handleResultError(result);
  }

  if (isRemoteWeb && !remotePassword) {
    return (
      <main className="remote-login-shell">
        <form className="remote-login-panel" onSubmit={submitRemoteLogin}>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              s
            </span>
            <span>{t("app.name")}</span>
          </div>
          <div>
            <p className="eyebrow">{t("stage.label")}</p>
            <h1>{t("remote.loginTitle")}</h1>
            <p>{t("remote.loginDescription")}</p>
          </div>
          <label className="control-field">
            <span>{t("remote.password")}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={remotePasswordDraft}
              onChange={(event) => setRemotePasswordDraft(event.target.value)}
            />
          </label>
          <button type="submit">{t("remote.loginAction")}</button>
          {remoteLoginMessage ? (
            <p className="status-message">{remoteLoginMessage}</p>
          ) : null}
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label={t("app.sidebarLabel")}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            s
          </span>
          <span>{t("app.name")}</span>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              className={activeNav === item ? "nav-item active" : "nav-item"}
              type="button"
              aria-current={activeNav === item ? "page" : undefined}
              onClick={() => setActiveNav(item)}
              key={item}
            >
              <span className="nav-dot" aria-hidden="true" />
              {t(`nav.${item}`)}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t("stage.label")}</p>
            <h1>{getViewTitle(activeNav, t)}</h1>
          </div>

          <label className="language-picker">
            <span>{t("settings.interface.language")}</span>
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              {SUPPORTED_LOCALES.map((item) => (
                <option value={item} key={item}>
                  {localeNames[item]}
                </option>
              ))}
            </select>
          </label>
        </header>

        <section className="summary-grid" aria-label={t("home.summaryLabel")}>
          <article className="metric-card">
            <span>{t("metric.download")}</span>
            <strong>{formatSpeed(totalDownloadSpeed)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("metric.upload")}</span>
            <strong>{formatSpeed(totalUploadSpeed)}</strong>
          </article>
          <article className="metric-card">
            <span>{t("metric.network")}</span>
            <strong>
              {snapshot.torrents.some((torrent) => torrent.status === "downloading")
                ? t("network.active")
                : t("network.idle")}
            </strong>
          </article>
          <article className="metric-card diagnostic-metric">
            <span>{t("metric.speedDoctor")}</span>
            <button
              type="button"
              className="secondary small-button"
              disabled={!topSpeedDoctorTorrent}
              onClick={() =>
                topSpeedDoctorTorrent
                  ? runTorrentSpeedDoctor(topSpeedDoctorTorrent.id)
                  : undefined
              }
            >
              {t("action.whySlow")}
            </button>
          </article>
        </section>

        {speedDoctorHint ? (
          <AutoSpeedDoctorBanner
            hint={speedDoctorHint}
            torrent={snapshot.torrents.find(
              (torrent) => torrent.id === speedDoctorHint.torrentId
            )}
            report={speedDoctorReports[speedDoctorHint.torrentId]}
            t={t}
            onOpen={() => {
              setActiveNav("downloads");
              setMetadataAssistantTorrentId(speedDoctorHint.torrentId);
            }}
            onDismiss={() => setSpeedDoctorHint(null)}
          />
        ) : null}

        {statusMessage ? (
          <p className="status-message global-status" role="status">
            {statusMessage}
          </p>
        ) : null}

        <section className="content-layout">
          <section className="downloads-panel">
            {activeNav === "downloads" ? (
              <>
            <article className="add-panel">
              <div>
                <h2>{t("add.title")}</h2>
                <p>{t("add.description")}</p>
              </div>

              <label className="profile-picker">
                <span>{t("profile.selector")}</span>
                <select
                  value={selectedProfileId}
                  onChange={(event) =>
                    setSelectedProfileId(event.target.value as DownloadProfileId)
                  }
                >
                  {DOWNLOAD_PROFILE_IDS.map((profileId) => (
                    <option value={profileId} key={profileId}>
                      {t(`profile.${profileId}`)}
                    </option>
                  ))}
                </select>
              </label>

              {automationDraft && automationDraft.favoriteFolders.length > 0 ? (
                <label className="profile-picker">
                  <span>{t("automation.favorite.useForAdd")}</span>
                  <select
                    value={selectedFavoriteFolderId}
                    onChange={(event) =>
                      setSelectedFavoriteFolderId(event.target.value)
                    }
                  >
                    <option value="">{t("automation.favorite.none")}</option>
                    {automationDraft.favoriteFolders.map((folder) => (
                      <option value={folder.id} key={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <SmartAssistantCard
                recommendation={assistantRecommendation}
                selectedProfileId={selectedProfileId}
                t={t}
                aiEnabled={aiEnabled}
                aiAdvice={assistantAdvice[ADD_ASSISTANT_ADVICE_KEY]}
                aiLoading={Boolean(
                  assistantAdviceLoading[ADD_ASSISTANT_ADVICE_KEY]
                )}
                dismissedWarningKeys={dismissedWarningKeys}
                onAccept={() =>
                  setSelectedProfileId(assistantRecommendation.profileId)
                }
                onApplySuggestion={applyAddAssistantSuggestion}
                onDismissWarning={(warningId) =>
                  dismissAssistantWarning(warningId, null)
                }
                onAskAI={requestAddAssistantAdvice}
              />

              <div className="label-fields">
                <label>
                  <span>{t("add.categoryLabel")}</span>
                  <input
                    value={categoryDraft}
                    onChange={(event) => setCategoryDraft(event.target.value)}
                    placeholder={t("add.categoryPlaceholder")}
                  />
                </label>
                <label>
                  <span>{t("add.tagsLabel")}</span>
                  <input
                    value={tagsDraft}
                    onChange={(event) => setTagsDraft(event.target.value)}
                    placeholder={t("add.tagsPlaceholder")}
                  />
                </label>
              </div>

              <div className="actions">
                <button type="button" onClick={addTorrentFile} disabled={isRemoteWeb}>
                  {t("action.addTorrent")}
                </button>
              </div>

              <form className="magnet-form" onSubmit={addMagnet}>
                <label>
                  <span>{t("add.magnetLabel")}</span>
                  <input
                    value={magnetUri}
                    onChange={(event) => setMagnetUri(event.target.value)}
                    placeholder={t("add.magnetPlaceholder")}
                  />
                </label>
                <button type="submit" className="secondary">
                  {t("action.addMagnet")}
                </button>
              </form>

            </article>

            {metadataAssistantTorrent && metadataAssistantRecommendation ? (
              <MetadataAssistantReview
                torrent={metadataAssistantTorrent}
                recommendation={metadataAssistantRecommendation}
                t={t}
                aiEnabled={aiEnabled}
                aiAdvice={assistantAdvice[metadataAssistantTorrent.id]}
                aiLoading={Boolean(
                  assistantAdviceLoading[metadataAssistantTorrent.id]
                )}
                dismissedWarningKeys={dismissedWarningKeys}
                scheduleSuggestion={
                  assistantScheduleSuggestions[metadataAssistantTorrent.id]
                }
                onAskAI={() =>
                  requestMetadataAssistantAdvice(
                    metadataAssistantTorrent,
                    metadataAssistantRecommendation
                  )
                }
                onApply={() =>
                  applyMetadataAssistantRecommendation(
                    metadataAssistantTorrent,
                    metadataAssistantRecommendation
                  )
                }
                onDismissWarning={(warningId) =>
                  dismissAssistantWarning(warningId, metadataAssistantTorrent.id)
                }
                onRequestSchedule={() =>
                  requestAssistantScheduleSuggestion(metadataAssistantTorrent.id)
                }
                onDismiss={() => setMetadataAssistantTorrentId(null)}
              />
            ) : null}

            {snapshot.torrents.length === 0 ? (
              <article className="empty-state">
                <h2>{t("empty.title")}</h2>
                <p>{t("empty.description")}</p>
              </article>
            ) : (
              <div className="torrent-list" aria-label={t("downloads.listLabel")}>
                {snapshot.torrents.map((torrent) => (
                  <article
                    className="torrent-row"
                    key={torrent.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({
                        torrentId: torrent.id,
                        x: event.clientX,
                        y: event.clientY
                      });
                    }}
                  >
                    <div className="torrent-main">
                      <div>
                        <h2>{torrent.name}</h2>
                        <p>
                          {t(`torrent.status.${torrent.status}`)} ·{" "}
                          {formatBytes(torrent.downloadedBytes)} /{" "}
                          {formatBytes(torrent.sizeBytes)}
                        </p>
                        <TorrentHealthBadge
                          report={speedDoctorReports[torrent.id]}
                          t={t}
                        />
                      </div>
                      <strong>{formatPercent(torrent.progress, locale)}</strong>
                    </div>

                    <div className="progress-track" aria-hidden="true">
                      <span style={{ width: `${toRatio(torrent.progress) * 100}%` }} />
                    </div>

                    <dl className="torrent-stats">
                      <div>
                        <dt>{t("torrent.stat.down")}</dt>
                        <dd>{formatSpeed(torrent.downloadSpeedBytes)}</dd>
                      </div>
                      <div>
                        <dt>{t("torrent.stat.up")}</dt>
                        <dd>{formatSpeed(torrent.uploadSpeedBytes)}</dd>
                      </div>
                      <div>
                        <dt>{t("torrent.stat.peers")}</dt>
                        <dd>{torrent.peers}</dd>
                      </div>
                      <div>
                        <dt>{t("torrent.stat.eta")}</dt>
                        <dd>{formatEta(torrent.etaSeconds, t("torrent.etaUnknown"))}</dd>
                      </div>
                    </dl>

                    <TorrentLabelsEditor
                      torrent={torrent}
                      t={t}
                      onSave={updateTorrentLabels}
                    />

                    <TorrentFiles
                      torrent={torrent}
                      locale={locale}
                      t={t}
                      onPriorityChange={setTorrentFilePriority}
                    />

                    <div className="row-actions">
                      {torrent.status === "paused" ? (
                        <button type="button" onClick={() => resumeTorrent(torrent.id)}>
                          {t("action.resume")}
                        </button>
                      ) : (
                        <button type="button" onClick={() => pauseTorrent(torrent.id)}>
                          {t("action.pause")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => runTorrentSpeedDoctor(torrent.id)}
                      >
                        {t("action.whySlow")}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => recheckTorrent(torrent.id)}
                        disabled={!torrent.recheckAvailable}
                      >
                        {t("action.recheck")}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => removeTorrent(torrent.id)}
                      >
                        {t("action.removeFromList")}
                      </button>
                    </div>
                    {speedDoctorReports[torrent.id] ? (
                      <SpeedDoctorReportCard
                        report={speedDoctorReports[torrent.id]}
                        locale={locale}
                        t={t}
                        aiEnabled={aiEnabled}
                        aiAdvice={speedDoctorAdvice[torrent.id]}
                        aiLoading={Boolean(speedDoctorAdviceLoading[torrent.id])}
                        onAskAI={() =>
                          requestSpeedDoctorAIAdvice(speedDoctorReports[torrent.id])
                        }
                        onAction={(actionId) =>
                          handleSpeedDoctorAction(
                            torrent,
                            speedDoctorReports[torrent.id],
                            actionId
                          )
                        }
                      />
                    ) : null}
                  </article>
                ))}
              </div>
            )}
              </>
            ) : null}

            {activeNav === "queue" ? (
              <QueuePanel snapshot={snapshot} locale={locale} t={t} />
            ) : null}

            {activeNav === "files" ? (
              <FilesPanel
                snapshot={snapshot}
                locale={locale}
                t={t}
                onPriorityChange={setTorrentFilePriority}
              />
            ) : null}

            {activeNav === "trackers" ? (
              <TrackersPanel snapshot={snapshot} t={t} />
            ) : null}

            {activeNav === "stats" ? (
              <StatsPanel snapshot={snapshot} locale={locale} t={t} />
            ) : null}

            {activeNav === "automation" ? (
              <article className="add-panel">
                <AutomationPanel
                  locale={locale}
                  automationDraft={automationDraft}
                  automationState={automationState}
                  t={t}
                  onChange={setAutomationDraft}
                  onSave={saveAutomationSettings}
                  onScanWatchFolders={runWatchFolderScan}
                />
              </article>
            ) : null}

            {activeNav === "settings" ? (
              <article className="add-panel">
                {window.storent?.updates ? (
                  <AppUpdatesPanel
                    state={appUpdateState}
                    locale={locale}
                    t={t}
                    onCheck={checkAppUpdate}
                    onDownload={downloadAppUpdate}
                    onInstall={installAppUpdate}
                  />
                ) : null}
                {window.storent?.ai ? (
                  <AISettingsPanel
                    aiDraft={aiDraft}
                    aiState={aiState}
                    apiKeyDraft={aiApiKeyDraft}
                    providerTest={aiProviderTest}
                    models={aiModels}
                    t={t}
                    onChange={setAiDraft}
                    onApiKeyChange={setAiApiKeyDraft}
                    onSave={saveAISettings}
                    onTest={testAIProvider}
                    onLoadModels={loadAIModels}
                  />
                ) : null}
                <NetworkSettingsPanel
                  locale={locale}
                  networkDraft={networkDraft}
                  networkState={networkState}
                  diagnostics={diagnostics}
                  snapshot={snapshot}
                  speedDoctorReports={speedDoctorReports}
                  t={t}
                  aiEnabled={aiEnabled}
                  aiAdvice={speedDoctorAdvice}
                  aiLoading={speedDoctorAdviceLoading}
                  onChange={setNetworkDraft}
                  onSave={saveNetworkSettings}
                  onRunDiagnostics={runNetworkDiagnostics}
                  onRunSpeedDoctor={runTorrentSpeedDoctor}
                  onAskAI={requestSpeedDoctorAIAdvice}
                  onSpeedDoctorAction={handleSpeedDoctorAction}
                />
                {window.storent?.remoteAccess ? (
                  <RemoteAccessPanel
                    remoteAccessDraft={remoteAccessDraft}
                    remoteAccessState={remoteAccessState}
                    passwordDraft={remoteAccessPasswordDraft}
                    t={t}
                    onChange={setRemoteAccessDraft}
                    onPasswordChange={setRemoteAccessPasswordDraft}
                    onSave={saveRemoteAccessSettings}
                  />
                ) : null}
              </article>
            ) : null}
          </section>

          <aside className="assistant-panel">
            <div>
              <h2>{t("assistant.title")}</h2>
              <p>{t(`assistant.status.${assistant.status}`)}</p>
              <p>{t("assistant.manualProfilesOnly")}</p>
            </div>
            <div>
              <h2>{t("speedDoctor.title")}</h2>
              <p>{t(`speedDoctor.status.${speedDoctor.status}`)}</p>
            </div>
            <TorrentSpeedDiagnosticsPanel
              snapshot={snapshot}
              reports={speedDoctorReports}
              locale={locale}
              t={t}
              aiEnabled={aiEnabled}
              aiAdvice={speedDoctorAdvice}
              aiLoading={speedDoctorAdviceLoading}
              onRunSpeedDoctor={runTorrentSpeedDoctor}
              onAskAI={requestSpeedDoctorAIAdvice}
              onAction={handleSpeedDoctorAction}
            />
            {automationDraft ? (
              <div>
                <h2>{t("automation.title")}</h2>
                <p>
                  {t("automation.watch.title")}:{" "}
                  {automationDraft.watchFolders.filter((folder) => folder.enabled)
                    .length}
                </p>
                <p>
                  {t("automation.favorite.title")}:{" "}
                  {automationDraft.favoriteFolders.length}
                </p>
              </div>
            ) : null}
          </aside>
        </section>

        {contextMenu ? (
          <TorrentContextMenu
            contextMenu={contextMenu}
            torrent={snapshot.torrents.find(
              (torrent) => torrent.id === contextMenu.torrentId
            )}
            t={t}
            onClose={() => setContextMenu(null)}
            onRunSpeedDoctor={(torrent) => {
              void runTorrentSpeedDoctor(torrent.id);
            }}
            onPause={pauseTorrent}
            onResume={resumeTorrent}
            onRecheck={recheckTorrent}
            onRemove={removeTorrent}
          />
        ) : null}
      </section>
    </main>
  );
}

function QueuePanel({
  snapshot,
  locale,
  t
}: {
  snapshot: TorrentCoreSnapshot;
  locale: Locale;
  t: (key: string) => string;
}) {
  return (
    <article className="add-panel view-panel">
      <h2>{t("nav.queue")}</h2>
      {snapshot.torrents.length === 0 ? (
        <p>{t("empty.description")}</p>
      ) : (
        <div className="torrent-list" aria-label={t("nav.queue")}>
          {snapshot.torrents.map((torrent) => (
            <div className="queue-row" key={torrent.id}>
              <div>
                <strong>{torrent.name}</strong>
                <span>
                  {t(`torrent.status.${torrent.status}`)} ·{" "}
                  {formatPercent(torrent.progress, locale)}
                </span>
              </div>
              <span>{formatEta(torrent.etaSeconds, t("torrent.etaUnknown"))}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function FilesPanel({
  snapshot,
  locale,
  t,
  onPriorityChange
}: {
  snapshot: TorrentCoreSnapshot;
  locale: Locale;
  t: (key: string) => string;
  onPriorityChange: (
    id: string,
    fileIndex: number,
    priority: TorrentFilePriority
  ) => void;
}) {
  return (
    <article className="add-panel view-panel">
      <h2>{t("nav.files")}</h2>
      {snapshot.torrents.length === 0 ? (
        <p>{t("empty.description")}</p>
      ) : (
        snapshot.torrents.map((torrent) => (
          <section className="torrent-row embedded-row" key={torrent.id}>
            <div className="section-heading">
              <h3>{torrent.name}</h3>
              <span>{t(`torrent.status.${torrent.status}`)}</span>
            </div>
            <TorrentFiles
              torrent={torrent}
              locale={locale}
              t={t}
              onPriorityChange={onPriorityChange}
            />
          </section>
        ))
      )}
    </article>
  );
}

function TrackersPanel({
  snapshot,
  t
}: {
  snapshot: TorrentCoreSnapshot;
  t: (key: string) => string;
}) {
  return (
    <article className="add-panel view-panel">
      <h2>{t("nav.trackers")}</h2>
      {snapshot.torrents.length === 0 ? (
        <p>{t("empty.description")}</p>
      ) : (
        <div className="torrent-list" aria-label={t("nav.trackers")}>
          {snapshot.torrents.map((torrent) => (
            <div className="queue-row" key={torrent.id}>
              <div>
                <strong>{torrent.name}</strong>
                <span>
                  {t("trackers.source")} ·{" "}
                  {t(`trackers.source.${torrent.sourceType}`)}
                  {torrent.trackerHosts.length > 0
                    ? ` · ${torrent.trackerHosts.join(", ")}`
                    : ""}
                </span>
              </div>
              <span>
                {torrent.private ? t("trackers.private") : t("trackers.public")}
              </span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function StatsPanel({
  snapshot,
  locale,
  t
}: {
  snapshot: TorrentCoreSnapshot;
  locale: Locale;
  t: (key: string) => string;
}) {
  const completed = snapshot.torrents.filter(
    (torrent) => torrent.status === "completed" || torrent.status === "seeding"
  ).length;
  const active = snapshot.torrents.filter(
    (torrent) => torrent.status === "downloading"
  ).length;

  return (
    <article className="add-panel view-panel">
      <h2>{t("nav.stats")}</h2>
      <section className="summary-grid" aria-label={t("nav.stats")}>
        <article className="metric-card compact-card">
          <span>{t("stats.total")}</span>
          <strong>{new Intl.NumberFormat(locale).format(snapshot.torrents.length)}</strong>
        </article>
        <article className="metric-card compact-card">
          <span>{t("stats.active")}</span>
          <strong>{new Intl.NumberFormat(locale).format(active)}</strong>
        </article>
        <article className="metric-card compact-card">
          <span>{t("stats.completed")}</span>
          <strong>{new Intl.NumberFormat(locale).format(completed)}</strong>
        </article>
      </section>
      <dl className="torrent-stats">
        <div>
          <dt>{t("metric.download")}</dt>
          <dd>{formatSpeed(snapshot.downloadSpeedBytes)}</dd>
        </div>
        <div>
          <dt>{t("metric.upload")}</dt>
          <dd>{formatSpeed(snapshot.uploadSpeedBytes)}</dd>
        </div>
      </dl>
    </article>
  );
}

function SmartAssistantCard({
  recommendation,
  selectedProfileId,
  t,
  aiEnabled = false,
  aiAdvice,
  aiLoading = false,
  dismissedWarningKeys,
  torrentId = null,
  scheduleSuggestion,
  onAccept,
  onApplySuggestion,
  onDismissWarning,
  onRequestSchedule,
  onAskAI
}: {
  recommendation: SmartAssistantRecommendation;
  selectedProfileId: DownloadProfileId;
  t: (key: string) => string;
  aiEnabled?: boolean;
  aiAdvice?: AIAdviceResult;
  aiLoading?: boolean;
  dismissedWarningKeys: Set<string>;
  torrentId?: string | null;
  scheduleSuggestion?: AssistantScheduleSuggestion;
  onAccept: () => void;
  onApplySuggestion?: (suggestion: SmartAssistantSuggestion) => void;
  onDismissWarning?: (warningId: string) => void | Promise<void>;
  onRequestSchedule?: () => void | Promise<void>;
  onAskAI?: () => void | Promise<void>;
}) {
  const accepted = selectedProfileId === recommendation.profileId;
  const visibleSuggestions = recommendation.suggestions.slice(0, 5);
  const visibleWarnings = recommendation.warnings.filter(
    (warning) =>
      !dismissedWarningKeys.has(createWarningDismissKey(warning, torrentId))
  );

  return (
    <section className="smart-assistant-card">
      <div className="section-heading">
        <h3>{t("assistant.recommendation.title")}</h3>
        <span>
          {t(`assistant.health.${recommendation.healthStatus}`)}{" - "}
          {recommendation.healthScore}
        </span>
      </div>
      <div className="recommendation-main">
        <strong>{t(`profile.${recommendation.profileId}`)}</strong>
        <button
          type="button"
          className="secondary small-button"
          disabled={accepted}
          onClick={onAccept}
        >
          {accepted
            ? t("assistant.recommendation.applied")
            : t("assistant.recommendation.accept")}
        </button>
      </div>
      <p className={`health-summary ${recommendation.healthStatus}`}>
        {t(`assistant.healthMessage.${recommendation.healthStatus}`)}
      </p>
      <ul className="reason-list">
        {recommendation.reasons.slice(0, 4).map((reason) => (
          <li key={reason}>{t(`assistant.reason.${reason}`)}</li>
        ))}
      </ul>
      {visibleWarnings.length > 0 ? (
        <ul className="warning-list">
          {visibleWarnings.map((warning) => (
            <li key={warning}>
              <span>{t(`assistant.warning.${warning}`)}</span>
              {onDismissWarning ? (
                <button
                  type="button"
                  className="secondary small-button"
                  onClick={() => void onDismissWarning(warning)}
                >
                  {t("action.dismiss")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {scheduleSuggestion ? (
        <div className="assistant-schedule">
          <span>
            {t("assistant.schedule.suggestion")}{" "}
            {formatHours(scheduleSuggestion.bestHours)}
          </span>
          {onRequestSchedule ? (
            <button
              type="button"
              className="secondary small-button"
              onClick={() => void onRequestSchedule()}
            >
              {t("assistant.schedule.open")}
            </button>
          ) : null}
        </div>
      ) : onRequestSchedule ? (
        <button
          type="button"
          className="secondary small-button"
          onClick={() => void onRequestSchedule()}
        >
          {t("assistant.schedule.check")}
        </button>
      ) : null}
      {visibleSuggestions.length > 0 ? (
        <div className="assistant-suggestions">
          {visibleSuggestions.map((suggestion) => (
            onApplySuggestion ? (
              <button
                type="button"
                className="secondary small-button"
                key={`${suggestion.type}-${suggestion.value}-${suggestion.filePath ?? ""}`}
                onClick={() => onApplySuggestion(suggestion)}
              >
                {formatAssistantSuggestion(suggestion, t)}
              </button>
            ) : (
              <span
                className="assistant-suggestion-pill"
                key={`${suggestion.type}-${suggestion.value}-${suggestion.filePath ?? ""}`}
              >
                {formatAssistantSuggestion(suggestion, t)}
              </span>
            )
          ))}
        </div>
      ) : null}
      {aiEnabled && onAskAI ? (
        <AIAdviceBubble
          advice={aiAdvice}
          loading={aiLoading}
          t={t}
          onAsk={onAskAI}
        />
      ) : null}
    </section>
  );
}

function AIAdviceBubble({
  advice,
  loading,
  t,
  onAsk
}: {
  advice: AIAdviceResult | undefined;
  loading: boolean;
  t: (key: string) => string;
  onAsk: () => void | Promise<void>;
}) {
  return (
    <div className="ai-advice-bubble">
      <div>
        <strong>{t("ai.adviceTitle")}</strong>
        {advice ? (
          <p>
            {advice.text}
            {advice.fallback ? ` ${t("ai.adviceFallback")}` : ""}
          </p>
        ) : (
          <p>{t("ai.adviceEmpty")}</p>
        )}
      </div>
      <button
        type="button"
        className="secondary small-button"
        disabled={loading}
        onClick={() => void onAsk()}
      >
        {loading ? t("ai.asking") : t("ai.ask")}
      </button>
    </div>
  );
}

function MetadataAssistantReview({
  torrent,
  recommendation,
  t,
  aiEnabled = false,
  aiAdvice,
  aiLoading = false,
  dismissedWarningKeys,
  scheduleSuggestion,
  onAskAI,
  onApply,
  onDismissWarning,
  onRequestSchedule,
  onDismiss
}: {
  torrent: TorrentSummary;
  recommendation: SmartAssistantRecommendation;
  t: (key: string) => string;
  aiEnabled?: boolean;
  aiAdvice?: AIAdviceResult;
  aiLoading?: boolean;
  dismissedWarningKeys: Set<string>;
  scheduleSuggestion?: AssistantScheduleSuggestion;
  onAskAI?: () => void | Promise<void>;
  onApply: () => void | Promise<void>;
  onDismissWarning?: (warningId: string) => void | Promise<void>;
  onRequestSchedule?: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  return (
    <article className="metadata-assistant-panel">
      <div className="section-heading">
        <div>
          <h2>{t("assistant.metadata.title")}</h2>
          <p>{torrent.name}</p>
        </div>
        <button type="button" className="secondary small-button" onClick={onDismiss}>
          {t("action.dismiss")}
        </button>
      </div>
      <SmartAssistantCard
        recommendation={recommendation}
        selectedProfileId={torrent.selectedProfileId}
        t={t}
        aiEnabled={aiEnabled}
        aiAdvice={aiAdvice}
        aiLoading={aiLoading}
        dismissedWarningKeys={dismissedWarningKeys}
        torrentId={torrent.id}
        scheduleSuggestion={scheduleSuggestion}
        onAskAI={onAskAI}
        onAccept={() => void onApply()}
        onDismissWarning={onDismissWarning}
        onRequestSchedule={onRequestSchedule}
      />
      <div className="row-actions">
        <button type="button" onClick={() => void onApply()}>
          {t("assistant.applyExisting")}
        </button>
      </div>
    </article>
  );
}

function AutoSpeedDoctorBanner({
  hint,
  torrent,
  report,
  t,
  onOpen,
  onDismiss
}: {
  hint: { torrentId: string; generatedAt: string };
  torrent: TorrentSummary | undefined;
  report: TorrentSpeedDoctorReport | undefined;
  t: (key: string) => string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="speed-doctor-hint">
      <div>
        <strong>{t("speedDoctor.autoHint.title")}</strong>
        <p>
          {torrent?.name ?? hint.torrentId}
          {report?.primaryReason ? ` · ${t(`speedDoctor.reason.${report.primaryReason}`)}` : ""}
        </p>
      </div>
      <div className="row-actions">
        <button type="button" className="secondary small-button" onClick={onOpen}>
          {t("speedDoctor.autoHint.open")}
        </button>
        <button type="button" className="secondary small-button" onClick={onDismiss}>
          {t("action.dismiss")}
        </button>
      </div>
    </section>
  );
}

function TorrentHealthBadge({
  report,
  t
}: {
  report: TorrentSpeedDoctorReport | undefined;
  t: (key: string) => string;
}) {
  const status = report?.status ?? "not_checked";

  return (
    <span className={`health-badge ${status}`}>
      {t(`speedDoctor.reportStatus.${status}`)}
    </span>
  );
}

function SpeedDoctorReportCard({
  report,
  locale,
  t,
  aiEnabled = false,
  aiAdvice,
  aiLoading = false,
  onAskAI,
  onAction
}: {
  report: TorrentSpeedDoctorReport;
  locale: Locale;
  t: (key: string) => string;
  aiEnabled?: boolean;
  aiAdvice?: AIAdviceResult;
  aiLoading?: boolean;
  onAskAI?: () => void | Promise<void>;
  onAction: (actionId: SpeedDoctorActionId) => void | Promise<void>;
}) {
  const visibleReasons = report.reasons.slice(0, 4);
  const history = report.technicalDetails.speedHistory;
  const portCheck = report.technicalDetails.portCheck;
  const diagnoses = report.technicalDetails.diagnoses.slice(0, 3);
  const anomalies = report.technicalDetails.anomalies.slice(0, 4);

  return (
    <section className={`speed-doctor-card ${report.status}`}>
      <div className="section-heading">
        <h3>{t("speedDoctor.reportTitle")}</h3>
        <span>{t(`speedDoctor.reportStatus.${report.status}`)}</span>
      </div>
      <p>
        {report.primaryReason
          ? t(`speedDoctor.reason.${report.primaryReason}`)
          : t("speedDoctor.noProblems")}
      </p>
      {visibleReasons.length > 0 ? (
        <ol className="doctor-reasons">
          {visibleReasons.map((reason) => (
            <li key={reason.code}>
              <strong>{t(`speedDoctor.reason.${reason.code}`)}</strong>
              {reason.evidence === undefined ? null : (
                <span>
                  {formatSpeedDoctorEvidence(reason.evidence, reason.code, locale)}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="doctor-snapshot">
        <span>
          {t(`speedDoctor.scanMode.${report.scanMode}`)} В· {report.durationMs} ms
        </span>
        <span>
          {t("speedDoctor.port")}:{" "}
          {portCheck.port ?? t("diagnostics.value.auto")} ·{" "}
          {formatPortReachability(portCheck.externallyReachable, t)}
        </span>
        <span>
          {t("speedDoctor.historySamples")}:{" "}
          {new Intl.NumberFormat(locale).format(history.sampleCount)}
        </span>
        <span>
          {t("speedDoctor.peak24h")}: {formatKbSpeed(history.peakSpeedLast24hKb)}
        </span>
      </div>
      {history.points24h.some((point) => point.downloadKb > 0) ? (
        <SpeedHistoryChart
          points={history.points24h}
          locale={locale}
          t={t}
        />
      ) : null}
      {anomalies.length > 0 ? (
        <div className="doctor-anomalies">
          <strong>{t("speedDoctor.anomalies")}</strong>
          <ul>
            {anomalies.map((anomaly) => (
              <li key={`${anomaly.type}:${anomaly.detectedAt}`}>
                {t(`speedDoctor.anomaly.${anomaly.type}`)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {history.ispThrottling.suspected ? (
        <p className="doctor-warning">
          {t("speedDoctor.ispThrottling")}{" "}
          {Math.round(history.ispThrottling.confidence * 100)}%
        </p>
      ) : null}
      {diagnoses.length > 0 ? (
        <div className="doctor-diagnoses">
          <strong>{t("speedDoctor.diagnoses")}</strong>
          {diagnoses.map((diagnosis) => (
            <article key={diagnosis.id} className={diagnosis.severity}>
              <b>{diagnosis.title}</b>
              <span>{diagnosis.explanation}</span>
            </article>
          ))}
        </div>
      ) : null}
      <div className="doctor-actions">
        {report.actions.slice(0, 8).map((actionId) => (
          <button
            type="button"
            className="secondary small-button"
            key={actionId}
            onClick={() => void onAction(actionId)}
          >
            {t(`speedDoctor.action.${actionId}`)}
          </button>
        ))}
      </div>
      {aiEnabled && onAskAI ? (
        <AIAdviceBubble
          advice={aiAdvice}
          loading={aiLoading}
          t={t}
          onAsk={onAskAI}
        />
      ) : null}
      <details className="doctor-details">
        <summary>{t("speedDoctor.details")}</summary>
        <pre>{formatSpeedDoctorTechnicalReport(report)}</pre>
      </details>
    </section>
  );
}

function SpeedHistoryChart({
  points,
  locale,
  t
}: {
  points: TorrentSpeedDoctorReport["technicalDetails"]["speedHistory"]["points24h"];
  locale: Locale;
  t: (key: string) => string;
}) {
  const maxSpeed = Math.max(1, ...points.map((point) => point.downloadKb));
  const visiblePoints = points.slice(-24);

  return (
    <div className="speed-history-chart" aria-label={t("speedDoctor.historyChart")}>
      <div className="speed-history-bars">
        {visiblePoints.map((point) => {
          const height = Math.max(4, Math.round((point.downloadKb / maxSpeed) * 44));
          return (
            <span
              key={point.hour}
              style={{ height }}
              title={`${formatChartHour(point.hour, locale)} · ${formatKbSpeed(
                point.downloadKb
              )}`}
            />
          );
        })}
      </div>
      <div className="speed-history-meta">
        <span>{t("speedDoctor.history24h")}</span>
        <span>{formatKbSpeed(maxSpeed)}</span>
      </div>
    </div>
  );
}

function TorrentContextMenu({
  contextMenu,
  torrent,
  t,
  onClose,
  onRunSpeedDoctor,
  onPause,
  onResume,
  onRecheck,
  onRemove
}: {
  contextMenu: { torrentId: string; x: number; y: number };
  torrent: TorrentSummary | undefined;
  t: (key: string) => string;
  onClose: () => void;
  onRunSpeedDoctor: (torrent: TorrentSummary) => void | Promise<void>;
  onPause: (id: string) => void | Promise<void>;
  onResume: (id: string) => void | Promise<void>;
  onRecheck: (id: string) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
}) {
  if (!torrent) {
    return null;
  }

  const style = {
    left: Math.min(contextMenu.x, window.innerWidth - 230),
    top: Math.min(contextMenu.y, window.innerHeight - 230)
  };

  const run = (action: () => void | Promise<void>) => {
    onClose();
    void action();
  };

  return (
    <div className="torrent-context-menu" style={style} role="menu">
      <strong>{torrent.name}</strong>
      <button
        type="button"
        role="menuitem"
        onClick={() => run(() => onRunSpeedDoctor(torrent))}
      >
        {t("action.whySlow")}
      </button>
      {torrent.status === "paused" ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => run(() => onResume(torrent.id))}
        >
          {t("action.resume")}
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={() => run(() => onPause(torrent.id))}
        >
          {t("action.pause")}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        disabled={!torrent.recheckAvailable}
        onClick={() => run(() => onRecheck(torrent.id))}
      >
        {t("action.recheck")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="danger"
        onClick={() => run(() => onRemove(torrent.id))}
      >
        {t("action.removeFromList")}
      </button>
    </div>
  );
}

function AppUpdatesPanel({
  state,
  locale,
  t,
  onCheck,
  onDownload,
  onInstall
}: {
  state: AppUpdateState | null;
  locale: Locale;
  t: (key: string) => string;
  onCheck: () => Promise<void>;
  onDownload: () => Promise<void>;
  onInstall: () => Promise<void>;
}) {
  const status: AppUpdateStatus = state?.status ?? "idle";
  const canCheck =
    Boolean(state?.canCheckForUpdates) &&
    status !== "checking" &&
    status !== "downloading";
  const canDownload = status === "available";
  const canInstall = status === "downloaded";

  return (
    <section className="app-update-settings" aria-label={t("updates.title")}>
      <div className="section-heading">
        <h2>{t("updates.title")}</h2>
        <span className={`restart-badge update-badge update-badge-${status}`}>
          {t(`updates.status.${status}`)}
        </span>
      </div>

      <p className="remote-origin">
        {t("updates.currentVersion")}{" "}
        <code>{state?.currentVersion ? `v${state.currentVersion}` : "-"}</code>
        {state?.checkedAt ? (
          <>
            {" · "}
            {t("updates.checkedAt")}{" "}
            <code>{formatDateTime(state.checkedAt, locale)}</code>
          </>
        ) : null}
      </p>

      {state?.update ? (
        <div className="update-release">
          <strong>
            {t("updates.latestVersion")} v{state.update.version}
          </strong>
          {state.update.releaseName ? <span>{state.update.releaseName}</span> : null}
          {state.update.releaseDate ? (
            <span>{formatDateTime(state.update.releaseDate, locale)}</span>
          ) : null}
        </div>
      ) : null}

      {state?.progress ? (
        <div className="update-progress">
          <progress value={state.progress.percent} max={100} />
          <span>
            {formatPercent(state.progress.percent / 100, locale)} ·{" "}
            {formatBytes(state.progress.transferredBytes)} /{" "}
            {formatBytes(state.progress.totalBytes)} ·{" "}
            {formatSpeed(state.progress.bytesPerSecond)}
          </span>
        </div>
      ) : null}

      {state?.update?.releaseNotes ? (
        <details className="update-notes">
          <summary>{t("updates.releaseNotes")}</summary>
          <pre>{state.update.releaseNotes}</pre>
        </details>
      ) : null}

      {state?.errorMessage ? (
        <p className="status-message">{state.errorMessage}</p>
      ) : null}

      <div className="row-actions">
        <button type="button" onClick={() => void onCheck()} disabled={!canCheck}>
          {t("updates.check")}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void onDownload()}
          disabled={!canDownload}
        >
          {t("updates.download")}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void onInstall()}
          disabled={!canInstall}
        >
          {t("updates.install")}
        </button>
      </div>
    </section>
  );
}

function AISettingsPanel({
  aiDraft,
  aiState,
  apiKeyDraft,
  providerTest,
  models,
  t,
  onChange,
  onApiKeyChange,
  onSave,
  onTest,
  onLoadModels
}: {
  aiDraft: AISettings | null;
  aiState: AISettingsState | null;
  apiKeyDraft: string;
  providerTest: ProviderTestResult | null;
  models: string[];
  t: (key: string) => string;
  onChange: (settings: AISettings) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onTest: () => void | Promise<void>;
  onLoadModels: () => void | Promise<void>;
}) {
  if (!aiDraft) {
    return (
      <section className="ai-settings">
        <h2>{t("ai.settingsTitle")}</h2>
        <p>{t("ai.loading")}</p>
      </section>
    );
  }

  const definitions = aiState?.providerDefinitions ?? [];
  const activeProvider = getActiveAIProvider(aiDraft);
  const activeDefinition = getAIProviderDefinition(aiDraft.activeProviderId);
  const requiresApiKey =
    activeDefinition.requiresApiKey || activeDefinition.id === "custom";
  const updateActiveProvider = (patch: Partial<AIProviderConfig>) => {
    onChange({
      ...aiDraft,
      providers: aiDraft.providers.map((provider) =>
        provider.providerId === aiDraft.activeProviderId
          ? { ...provider, ...patch }
          : provider
      )
    });
  };
  const selectProvider = (providerId: AIProviderId) => {
    const provider =
      aiDraft.providers.find((item) => item.providerId === providerId) ??
      createDefaultAIProviderConfig(providerId);

    onApiKeyChange("");
    onChange({
      ...aiDraft,
      activeProviderId: providerId,
      providers: upsertAIProvider(aiDraft.providers, provider)
    });
  };

  return (
    <form
      className="ai-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave();
      }}
    >
      <div className="section-heading">
        <h2>{t("ai.settingsTitle")}</h2>
        {aiDraft.enabled ? (
          <span className="restart-badge ok-badge">{t("ai.enabled")}</span>
        ) : null}
      </div>

      <label className="toggle-line">
        <input
          type="checkbox"
          checked={aiDraft.enabled}
          onChange={(event) =>
            onChange({ ...aiDraft, enabled: event.target.checked })
          }
        />
        <span>{t("ai.enableAdvisor")}</span>
      </label>

      <label className="control-field">
        <span>{t("ai.provider")}</span>
        <select
          value={aiDraft.activeProviderId}
          onChange={(event) =>
            selectProvider(event.target.value as AIProviderId)
          }
        >
          {definitions.map((definition) => (
            <option value={definition.id} key={definition.id}>
              {definition.name}
            </option>
          ))}
        </select>
      </label>

      <label className="control-field">
        <span>{t("ai.baseUrl")}</span>
        <input
          value={activeProvider?.baseUrl ?? ""}
          onChange={(event) => updateActiveProvider({ baseUrl: event.target.value })}
          placeholder={activeDefinition.defaultBaseUrl || "http://localhost:1234/v1"}
        />
      </label>

      {requiresApiKey ? (
        <label className="control-field">
          <span>{t("ai.apiKey")}</span>
          <input
            value={apiKeyDraft}
            type="password"
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={
              activeProvider?.apiKeyConfigured
                ? t("ai.apiKeyConfigured")
                : t("ai.apiKeyPlaceholder")
            }
          />
        </label>
      ) : (
        <p className="safety-note">{t("ai.apiKeyNotRequired")}</p>
      )}

      <div className="limit-grid">
        <label className="control-field">
          <span>{t("ai.model")}</span>
          <input
            list="ai-models"
            value={activeProvider?.model ?? ""}
            onChange={(event) => updateActiveProvider({ model: event.target.value })}
            placeholder={activeDefinition.recommendedModel}
          />
          <datalist id="ai-models">
            {models.map((model) => (
              <option value={model} key={model} />
            ))}
          </datalist>
        </label>
        <label className="control-field">
          <span>{t("ai.timeout")}</span>
          <input
            type="number"
            min={3000}
            max={120000}
            step={1000}
            value={activeProvider?.timeoutMs ?? 15000}
            onChange={(event) =>
              updateActiveProvider({ timeoutMs: Number(event.target.value) })
            }
          />
        </label>
      </div>

      {providerTest ? (
        <p
          className={`ai-test-result ${
            providerTest.success ? "ok-badge" : "restart-badge"
          }`}
        >
          {providerTest.success ? t("ai.testSuccess") : t("ai.testFailed")} -{" "}
          {providerTest.latencyMs} ms
          {providerTest.modelsList
            ? ` - ${providerTest.modelsList.length} ${t("ai.models")}`
            : ""}
          {providerTest.error ? ` - ${providerTest.error}` : ""}
        </p>
      ) : null}

      <div className="row-actions">
        <button type="submit">{t("ai.save")}</button>
        <button type="button" className="secondary" onClick={() => void onTest()}>
          {t("ai.test")}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void onLoadModels()}
        >
          {t("ai.loadModels")}
        </button>
      </div>
    </form>
  );
}

function NetworkSettingsPanel({
  locale,
  networkDraft,
  networkState,
  diagnostics,
  snapshot,
  speedDoctorReports,
  t,
  aiEnabled,
  aiAdvice,
  aiLoading,
  onChange,
  onSave,
  onRunDiagnostics,
  onRunSpeedDoctor,
  onAskAI,
  onSpeedDoctorAction
}: {
  locale: Locale;
  networkDraft: NetworkSettings | null;
  networkState: NetworkSettingsState | null;
  diagnostics: NetworkDiagnosticsReport | null;
  snapshot: TorrentCoreSnapshot;
  speedDoctorReports: Record<string, TorrentSpeedDoctorReport>;
  t: (key: string) => string;
  aiEnabled: boolean;
  aiAdvice: Record<string, AIAdviceResult>;
  aiLoading: Record<string, boolean>;
  onChange: (settings: NetworkSettings) => void;
  onSave: () => void;
  onRunDiagnostics: () => void;
  onRunSpeedDoctor: (
    id: string,
    options?: { silent?: boolean; automatic?: boolean }
  ) => Promise<TorrentSpeedDoctorReport | null>;
  onAskAI: (report: TorrentSpeedDoctorReport) => void | Promise<void>;
  onSpeedDoctorAction: (
    torrent: TorrentSummary,
    report: TorrentSpeedDoctorReport,
    actionId: SpeedDoctorActionId
  ) => void | Promise<void>;
}) {
  if (!networkDraft) {
    return (
      <div>
        <h2>{t("networkSettings.title")}</h2>
        <p>{t("networkSettings.loading")}</p>
      </div>
    );
  }

  const update = (patch: Partial<NetworkSettings>) => {
    onChange({ ...networkDraft, ...patch });
  };
  const updateLimits = (limits: Partial<NetworkSettings["speedLimits"]>) => {
    update({
      speedLimits: {
        ...networkDraft.speedLimits,
        ...limits
      }
    });
  };
  const updateInterface = (
    networkInterface: Partial<NetworkSettings["networkInterface"]>
  ) => {
    update({
      networkInterface: {
        ...networkDraft.networkInterface,
        ...networkInterface
      }
    });
  };
  const updateProxy = (proxy: Partial<NetworkSettings["proxy"]>) => {
    update({
      proxy: {
        ...networkDraft.proxy,
        ...proxy
      }
    });
  };
  const interfaces = getUniqueNetworkInterfaces(networkState);

  return (
    <form
      className="network-settings"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="section-heading">
        <h2>{t("networkSettings.title")}</h2>
        {networkState?.restartRequired ? (
          <span className="restart-badge">{t("networkSettings.restartRequired")}</span>
        ) : null}
      </div>

      <label className="control-field">
        <span>{t("networkSettings.profile")}</span>
        <select
          value={networkDraft.profileId}
          onChange={(event) =>
            onChange(
              applyNetworkProfileToDraft(
                networkDraft,
                event.target.value as NetworkProfileId
              )
            )
          }
        >
          {NETWORK_PROFILE_IDS.map((profileId) => (
            <option value={profileId} key={profileId}>
              {t(`networkProfile.${profileId}`)}
            </option>
          ))}
        </select>
      </label>

      <div className="toggle-grid" aria-label={t("networkSettings.discovery")}>
        <label>
          <input
            type="checkbox"
            checked={networkDraft.dht}
            onChange={(event) => update({ dht: event.target.checked })}
          />
          <span>DHT</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={networkDraft.pex}
            onChange={(event) => update({ pex: event.target.checked })}
          />
          <span>PEX</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={networkDraft.lsd}
            onChange={(event) => update({ lsd: event.target.checked })}
          />
          <span>LSD</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={networkDraft.privateMode}
            onChange={(event) => update({ privateMode: event.target.checked })}
          />
          <span>{t("networkSettings.privateMode")}</span>
        </label>
      </div>

      <div className="limit-grid">
        <label className="control-field">
          <span>{t("networkSettings.downloadLimit")}</span>
          <input
            inputMode="numeric"
            min={0}
            type="number"
            value={formatKilobyteLimit(
              networkDraft.speedLimits.downloadBytesPerSecond
            )}
            onChange={(event) =>
              updateLimits({
                downloadBytesPerSecond: parseKilobyteLimit(event.target.value)
              })
            }
          />
        </label>
        <label className="control-field">
          <span>{t("networkSettings.uploadLimit")}</span>
          <input
            inputMode="numeric"
            min={0}
            type="number"
            value={formatKilobyteLimit(
              networkDraft.speedLimits.uploadBytesPerSecond
            )}
            onChange={(event) =>
              updateLimits({
                uploadBytesPerSecond: parseKilobyteLimit(event.target.value)
              })
            }
          />
        </label>
      </div>

      <div className="limit-grid">
        <label className="control-field">
          <span>{t("networkSettings.incomingPort")}</span>
          <input
            inputMode="numeric"
            min={1}
            max={65535}
            type="number"
            value={networkDraft.incomingPort ?? ""}
            onChange={(event) =>
              update({ incomingPort: parsePort(event.target.value) })
            }
          />
        </label>
        <label className="control-field">
          <span>{t("networkSettings.encryption")}</span>
          <select
            value={networkDraft.encryptionMode}
            onChange={(event) =>
              update({
                encryptionMode: event.target.value as BitTorrentEncryptionMode
              })
            }
          >
            {BITTORRENT_ENCRYPTION_MODES.map((mode) => (
              <option value={mode} key={mode}>
                {t(`encryption.${mode}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toggle-grid two-columns">
        <label>
          <input
            type="checkbox"
            checked={networkDraft.upnp}
            onChange={(event) => update({ upnp: event.target.checked })}
          />
          <span>UPnP</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={networkDraft.natPmp}
            onChange={(event) => update({ natPmp: event.target.checked })}
          />
          <span>NAT-PMP</span>
        </label>
      </div>

      <label className="control-field">
        <span>{t("networkSettings.interface")}</span>
        <select
          value={networkDraft.networkInterface.name ?? ""}
          onChange={(event) =>
            updateInterface({ name: event.target.value || null })
          }
        >
          <option value="">{t("networkSettings.interfaceAny")}</option>
          {interfaces.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <div className="toggle-grid two-columns">
        <label>
          <input
            type="checkbox"
            checked={networkDraft.networkInterface.bindOnly}
            onChange={(event) =>
              updateInterface({ bindOnly: event.target.checked })
            }
          />
          <span>{t("networkSettings.bindOnly")}</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={networkDraft.networkInterface.killSwitch}
            onChange={(event) =>
              updateInterface({ killSwitch: event.target.checked })
            }
          />
          <span>{t("networkSettings.killSwitch")}</span>
        </label>
      </div>

      <div className="limit-grid">
        <label className="control-field">
          <span>{t("networkSettings.proxyType")}</span>
          <select
            value={networkDraft.proxy.type}
            onChange={(event) =>
              updateProxy({ type: event.target.value as ProxyType })
            }
          >
            {PROXY_TYPES.map((type) => (
              <option value={type} key={type}>
                {t(`proxy.${type}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="control-field">
          <span>{t("networkSettings.proxyHost")}</span>
          <input
            value={networkDraft.proxy.host}
            disabled={networkDraft.proxy.type === "none"}
            onChange={(event) => updateProxy({ host: event.target.value })}
          />
        </label>
      </div>

      <div className="row-actions">
        <button type="submit">{t("action.saveNetworkSettings")}</button>
        <button type="button" className="secondary" onClick={onRunDiagnostics}>
          {t("action.runDiagnostics")}
        </button>
      </div>

      {diagnostics ? (
        <NetworkDiagnosticsList
          diagnostics={diagnostics}
          locale={locale}
          t={t}
        />
      ) : null}

      <TorrentSpeedDiagnosticsPanel
        snapshot={snapshot}
        reports={speedDoctorReports}
        locale={locale}
        t={t}
        aiEnabled={aiEnabled}
        aiAdvice={aiAdvice}
        aiLoading={aiLoading}
        onRunSpeedDoctor={onRunSpeedDoctor}
        onAskAI={onAskAI}
        onAction={onSpeedDoctorAction}
      />
    </form>
  );
}

function RemoteAccessPanel({
  remoteAccessDraft,
  remoteAccessState,
  passwordDraft,
  t,
  onChange,
  onPasswordChange,
  onSave
}: {
  remoteAccessDraft: RemoteAccessSettings | null;
  remoteAccessState: RemoteAccessSettingsState | null;
  passwordDraft: string;
  t: (key: string) => string;
  onChange: (settings: RemoteAccessSettings) => void;
  onPasswordChange: (password: string) => void;
  onSave: () => void;
}) {
  if (!remoteAccessDraft) {
    return (
      <div>
        <h2>{t("remote.settingsTitle")}</h2>
        <p>{t("remote.loading")}</p>
      </div>
    );
  }

  const update = (patch: Partial<RemoteAccessSettings>) => {
    onChange({ ...remoteAccessDraft, ...patch });
  };
  const runtime = remoteAccessState?.runtime;

  return (
    <form
      className="remote-access-settings"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="section-heading">
        <h2>{t("remote.settingsTitle")}</h2>
        {runtime?.running ? (
          <span className="restart-badge ok-badge">{t("remote.running")}</span>
        ) : null}
      </div>

      <label className="toggle-line">
        <input
          type="checkbox"
          checked={remoteAccessDraft.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        <span>{t("remote.enabled")}</span>
      </label>

      <div className="limit-grid">
        <label className="control-field">
          <span>{t("remote.host")}</span>
          <select
            value={remoteAccessDraft.host}
            onChange={(event) =>
              update({ host: event.target.value as RemoteAccessHost })
            }
          >
            <option value="127.0.0.1">{t("remote.host.local")}</option>
            <option value="0.0.0.0">{t("remote.host.lan")}</option>
          </select>
        </label>
        <label className="control-field">
          <span>{t("remote.port")}</span>
          <input
            type="number"
            min={1024}
            max={65535}
            value={remoteAccessDraft.port}
            onChange={(event) =>
              update({ port: parseRemoteAccessPort(event.target.value) })
            }
          />
        </label>
      </div>

      <label className="control-field">
        <span>{t("remote.allowedIps")}</span>
        <textarea
          value={remoteAccessDraft.allowedIps.join("\n")}
          onChange={(event) =>
            update({ allowedIps: parseRemoteAccessAllowedIps(event.target.value) })
          }
          rows={4}
          spellCheck={false}
        />
      </label>

      <label className="control-field">
        <span>{t("remote.password")}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={passwordDraft}
          placeholder={
            remoteAccessState?.settings.passwordConfigured
              ? t("remote.passwordKeep")
              : t("remote.passwordNew")
          }
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </label>

      {runtime?.origin ? (
        <p className="remote-origin">
          {t("remote.webUiUrl")} <code>{runtime.origin}</code>
          {" · "}
          {t("remote.apiDocs")} <code>{`${runtime.origin}/api/docs`}</code>
        </p>
      ) : null}

      {runtime?.lastError ? (
        <p className="status-message">{runtime.lastError}</p>
      ) : null}

      <div className="row-actions">
        <button type="submit">{t("action.saveRemoteAccessSettings")}</button>
      </div>
    </form>
  );
}

function AutomationPanel({
  automationDraft,
  automationState,
  t,
  onChange,
  onSave,
  onScanWatchFolders
}: {
  locale: Locale;
  automationDraft: AutomationSettings | null;
  automationState: AutomationSettingsState | null;
  t: (key: string) => string;
  onChange: (settings: AutomationSettings) => void;
  onSave: () => void;
  onScanWatchFolders: () => void;
}) {
  if (!automationDraft) {
    return (
      <div>
        <h2>{t("automation.title")}</h2>
        <p>{t("automation.loading")}</p>
      </div>
    );
  }

  const update = (patch: Partial<AutomationSettings>) => {
    onChange({ ...automationDraft, ...patch });
  };
  const updateWatchFolder = (
    id: string,
    patch: Partial<WatchFolderSettings>
  ) => {
    update({
      watchFolders: replaceById(automationDraft.watchFolders, id, patch)
    });
  };
  const updateFavoriteFolder = (
    id: string,
    patch: Partial<FavoriteFolderSettings>
  ) => {
    update({
      favoriteFolders: replaceById(automationDraft.favoriteFolders, id, patch)
    });
  };
  const updateSeedingRule = (
    id: string,
    patch: Partial<SeedingRuleSettings>
  ) => {
    update({
      seedingRules: replaceById(automationDraft.seedingRules, id, patch)
    });
  };
  const updateRssRule = (
    id: string,
    patch: Partial<RssAutoLoadRuleSettings>
  ) => {
    update({
      rssRules: replaceById(automationDraft.rssRules, id, patch)
    });
  };
  const updateSpeedSchedule = (
    id: string,
    patch: Partial<SpeedLimitScheduleSettings>
  ) => {
    update({
      speedSchedules: replaceById(automationDraft.speedSchedules, id, patch)
    });
  };

  return (
    <form
      className="automation-settings"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="section-heading">
        <h2>{t("automation.title")}</h2>
        {automationState?.activeSpeedScheduleId ? (
          <span>{t("automation.schedule.active")}</span>
        ) : null}
      </div>

      <section className="automation-section" aria-label={t("automation.watch.title")}>
        <div className="section-heading">
          <h3>{t("automation.watch.title")}</h3>
          <button
            type="button"
            className="secondary small-button"
            onClick={() =>
              update({
                watchFolders: [
                  ...automationDraft.watchFolders,
                  createWatchFolderDraft()
                ]
              })
            }
          >
            {t("action.addRule")}
          </button>
        </div>

        {automationDraft.watchFolders.map((folder) => (
          <div className="automation-item" key={folder.id}>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={folder.enabled}
                onChange={(event) =>
                  updateWatchFolder(folder.id, { enabled: event.target.checked })
                }
              />
              <span>{t("automation.enabled")}</span>
            </label>
            <label className="control-field">
              <span>{t("automation.path")}</span>
              <input
                value={folder.path}
                onChange={(event) =>
                  updateWatchFolder(folder.id, { path: event.target.value })
                }
                placeholder={t("automation.pathPlaceholder")}
              />
            </label>
            <div className="limit-grid">
              <label className="control-field">
                <span>{t("profile.selector")}</span>
                <select
                  value={folder.profileId}
                  onChange={(event) =>
                    updateWatchFolder(folder.id, {
                      profileId: event.target.value as DownloadProfileId
                    })
                  }
                >
                  {DOWNLOAD_PROFILE_IDS.map((profileId) => (
                    <option value={profileId} key={profileId}>
                      {t(`profile.${profileId}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={folder.startPaused}
                  onChange={(event) =>
                    updateWatchFolder(folder.id, {
                      startPaused: event.target.checked
                    })
                  }
                />
                <span>{t("automation.startPaused")}</span>
              </label>
            </div>
            <div className="label-fields">
              <label>
                <span>{t("labels.category")}</span>
                <input
                  value={folder.category ?? ""}
                  onChange={(event) =>
                    updateWatchFolder(folder.id, { category: event.target.value })
                  }
                />
              </label>
              <label>
                <span>{t("labels.tags")}</span>
                <input
                  value={folder.tags.join(", ")}
                  onChange={(event) =>
                    updateWatchFolder(folder.id, {
                      tags: parseTags(event.target.value)
                    })
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="danger secondary"
              onClick={() =>
                update({
                  watchFolders: removeById(automationDraft.watchFolders, folder.id)
                })
              }
            >
              {t("action.removeRule")}
            </button>
          </div>
        ))}
      </section>

      <section
        className="automation-section"
        aria-label={t("automation.favorite.title")}
      >
        <div className="section-heading">
          <h3>{t("automation.favorite.title")}</h3>
          <button
            type="button"
            className="secondary small-button"
            onClick={() =>
              update({
                favoriteFolders: [
                  ...automationDraft.favoriteFolders,
                  createFavoriteFolderDraft()
                ]
              })
            }
          >
            {t("action.addRule")}
          </button>
        </div>

        {automationDraft.favoriteFolders.map((folder) => (
          <div className="automation-item" key={folder.id}>
            <div className="limit-grid">
              <label className="control-field">
                <span>{t("automation.name")}</span>
                <input
                  value={folder.name}
                  onChange={(event) =>
                    updateFavoriteFolder(folder.id, { name: event.target.value })
                  }
                />
              </label>
              <label className="control-field">
                <span>{t("automation.path")}</span>
                <input
                  value={folder.path}
                  onChange={(event) =>
                    updateFavoriteFolder(folder.id, { path: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="label-fields">
              <label>
                <span>{t("labels.category")}</span>
                <input
                  value={folder.category ?? ""}
                  onChange={(event) =>
                    updateFavoriteFolder(folder.id, {
                      category: event.target.value
                    })
                  }
                />
              </label>
              <label>
                <span>{t("labels.tags")}</span>
                <input
                  value={folder.tags.join(", ")}
                  onChange={(event) =>
                    updateFavoriteFolder(folder.id, {
                      tags: parseTags(event.target.value)
                    })
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="danger secondary"
              onClick={() =>
                update({
                  favoriteFolders: removeById(
                    automationDraft.favoriteFolders,
                    folder.id
                  )
                })
              }
            >
              {t("action.removeRule")}
            </button>
          </div>
        ))}
      </section>

      <section className="automation-section" aria-label={t("automation.seed.title")}>
        <div className="section-heading">
          <h3>{t("automation.seed.title")}</h3>
          <button
            type="button"
            className="secondary small-button"
            onClick={() =>
              update({
                seedingRules: [
                  ...automationDraft.seedingRules,
                  createSeedingRuleDraft()
                ]
              })
            }
          >
            {t("action.addRule")}
          </button>
        </div>

        {automationDraft.seedingRules.map((rule) => (
          <div className="automation-item" key={rule.id}>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) =>
                  updateSeedingRule(rule.id, { enabled: event.target.checked })
                }
              />
              <span>{t("automation.enabled")}</span>
            </label>
            <label className="control-field">
              <span>{t("automation.name")}</span>
              <input
                value={rule.name}
                onChange={(event) =>
                  updateSeedingRule(rule.id, { name: event.target.value })
                }
              />
            </label>
            <div className="limit-grid">
              <label className="control-field">
                <span>{t("automation.seed.ratio")}</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={rule.ratioLimit ?? ""}
                  onChange={(event) =>
                    updateSeedingRule(rule.id, {
                      ratioLimit: parseOptionalNumber(event.target.value)
                    })
                  }
                />
              </label>
              <label className="control-field">
                <span>{t("automation.seed.minutes")}</span>
                <input
                  type="number"
                  min={0}
                  value={rule.minutesAfterComplete ?? ""}
                  onChange={(event) =>
                    updateSeedingRule(rule.id, {
                      minutesAfterComplete: parseOptionalInteger(
                        event.target.value
                      )
                    })
                  }
                />
              </label>
            </div>
            <p className="safety-note">{t("automation.seed.safeAction")}</p>
            <button
              type="button"
              className="danger secondary"
              onClick={() =>
                update({
                  seedingRules: removeById(automationDraft.seedingRules, rule.id)
                })
              }
            >
              {t("action.removeRule")}
            </button>
          </div>
        ))}
      </section>

      <section className="automation-section" aria-label={t("automation.rss.title")}>
        <div className="section-heading">
          <h3>{t("automation.rss.title")}</h3>
          <button
            type="button"
            className="secondary small-button"
            onClick={() =>
              update({
                rssRules: [...automationDraft.rssRules, createRssRuleDraft()]
              })
            }
          >
            {t("action.addRule")}
          </button>
        </div>

        {automationDraft.rssRules.map((rule) => (
          <div className="automation-item" key={rule.id}>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) =>
                  updateRssRule(rule.id, { enabled: event.target.checked })
                }
              />
              <span>{t("automation.enabled")}</span>
            </label>
            <div className="limit-grid">
              <label className="control-field">
                <span>{t("automation.name")}</span>
                <input
                  value={rule.name}
                  onChange={(event) =>
                    updateRssRule(rule.id, { name: event.target.value })
                  }
                />
              </label>
              <label className="control-field">
                <span>{t("automation.rss.feed")}</span>
                <input
                  value={rule.feedUrl}
                  onChange={(event) =>
                    updateRssRule(rule.id, { feedUrl: event.target.value })
                  }
                  placeholder="https://example.com/feed.xml"
                />
              </label>
            </div>
            <div className="limit-grid">
              <label className="control-field">
                <span>{t("automation.rss.match")}</span>
                <input
                  value={rule.match}
                  onChange={(event) =>
                    updateRssRule(rule.id, { match: event.target.value })
                  }
                />
              </label>
              <label className="control-field">
                <span>{t("automation.rss.exclude")}</span>
                <input
                  value={rule.exclude}
                  onChange={(event) =>
                    updateRssRule(rule.id, { exclude: event.target.value })
                  }
                />
              </label>
            </div>
            <p className="safety-note">
              {t("automation.rss.seen")} {rule.seenItemIds.length}
            </p>
            <button
              type="button"
              className="danger secondary"
              onClick={() =>
                update({
                  rssRules: removeById(automationDraft.rssRules, rule.id)
                })
              }
            >
              {t("action.removeRule")}
            </button>
          </div>
        ))}
      </section>

      <section
        className="automation-section"
        aria-label={t("automation.schedule.title")}
      >
        <div className="section-heading">
          <h3>{t("automation.schedule.title")}</h3>
          <button
            type="button"
            className="secondary small-button"
            onClick={() =>
              update({
                speedSchedules: [
                  ...automationDraft.speedSchedules,
                  createSpeedScheduleDraft()
                ]
              })
            }
          >
            {t("action.addRule")}
          </button>
        </div>

        {automationDraft.speedSchedules.map((schedule) => (
          <div className="automation-item" key={schedule.id}>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={schedule.enabled}
                onChange={(event) =>
                  updateSpeedSchedule(schedule.id, {
                    enabled: event.target.checked
                  })
                }
              />
              <span>{t("automation.enabled")}</span>
            </label>
            <label className="control-field">
              <span>{t("automation.name")}</span>
              <input
                value={schedule.name}
                onChange={(event) =>
                  updateSpeedSchedule(schedule.id, { name: event.target.value })
                }
              />
            </label>
            <div className="limit-grid">
              <label className="control-field">
                <span>{t("automation.schedule.days")}</span>
                <input
                  value={schedule.daysOfWeek.join(",")}
                  onChange={(event) =>
                    updateSpeedSchedule(schedule.id, {
                      daysOfWeek: parseDaysOfWeek(event.target.value)
                    })
                  }
                />
              </label>
              <label className="control-field">
                <span>{t("automation.schedule.time")}</span>
                <input
                  value={`${formatMinuteOfDay(
                    schedule.startMinuteOfDay
                  )}-${formatMinuteOfDay(schedule.endMinuteOfDay)}`}
                  onChange={(event) => {
                    const range = parseTimeRange(event.target.value);
                    updateSpeedSchedule(schedule.id, range);
                  }}
                />
              </label>
            </div>
            <div className="limit-grid">
              <label className="control-field">
                <span>{t("networkSettings.downloadLimit")}</span>
                <input
                  type="number"
                  min={0}
                  value={formatKilobyteLimit(schedule.downloadBytesPerSecond)}
                  onChange={(event) =>
                    updateSpeedSchedule(schedule.id, {
                      downloadBytesPerSecond: parseKilobyteLimit(
                        event.target.value
                      )
                    })
                  }
                />
              </label>
              <label className="control-field">
                <span>{t("networkSettings.uploadLimit")}</span>
                <input
                  type="number"
                  min={0}
                  value={formatKilobyteLimit(schedule.uploadBytesPerSecond)}
                  onChange={(event) =>
                    updateSpeedSchedule(schedule.id, {
                      uploadBytesPerSecond: parseKilobyteLimit(event.target.value)
                    })
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="danger secondary"
              onClick={() =>
                update({
                  speedSchedules: removeById(
                    automationDraft.speedSchedules,
                    schedule.id
                  )
                })
              }
            >
              {t("action.removeRule")}
            </button>
          </div>
        ))}
      </section>

      <div className="row-actions">
        <button type="submit">{t("action.saveAutomationSettings")}</button>
        <button type="button" className="secondary" onClick={onScanWatchFolders}>
          {t("action.scanWatchFolders")}
        </button>
      </div>
    </form>
  );
}

function NetworkDiagnosticsList({
  diagnostics,
  locale,
  t
}: {
  diagnostics: NetworkDiagnosticsReport;
  locale: Locale;
  t: (key: string) => string;
}) {
  return (
    <section className="diagnostics-list" aria-label={t("diagnostics.title")}>
      <div className="section-heading">
        <h3>{t("diagnostics.title")}</h3>
        <span>{t(`diagnostics.status.${diagnostics.summary}`)}</span>
      </div>
      {diagnostics.checks.map((check) => (
        <div className={`diagnostic-item ${check.status}`} key={check.code}>
          <strong>{t(`diagnostics.check.${check.code}`)}</strong>
          <span>
            {t(`diagnostics.status.${check.status}`)}
            {check.value === undefined
              ? ""
              : ` · ${formatDiagnosticValue(check.value, check.code, locale, t)}`}
          </span>
        </div>
      ))}
    </section>
  );
}

function TorrentSpeedDiagnosticsPanel({
  snapshot,
  reports,
  locale,
  t,
  aiEnabled = false,
  aiAdvice = {},
  aiLoading = {},
  onRunSpeedDoctor,
  onAskAI,
  onAction
}: {
  snapshot: TorrentCoreSnapshot;
  reports: Record<string, TorrentSpeedDoctorReport>;
  locale: Locale;
  t: (key: string) => string;
  aiEnabled?: boolean;
  aiAdvice?: Record<string, AIAdviceResult>;
  aiLoading?: Record<string, boolean>;
  onRunSpeedDoctor: (
    id: string,
    options?: { silent?: boolean; automatic?: boolean }
  ) => Promise<TorrentSpeedDoctorReport | null>;
  onAskAI?: (report: TorrentSpeedDoctorReport) => void | Promise<void>;
  onAction: (
    torrent: TorrentSummary,
    report: TorrentSpeedDoctorReport,
    actionId: SpeedDoctorActionId
  ) => void | Promise<void>;
}) {
  const torrents = snapshot.torrents.filter(
    (torrent) => torrent.status === "downloading" || torrent.status === "queued"
  );

  return (
    <section className="diagnostics-list" aria-label={t("speedDoctor.networkTitle")}>
      <div className="section-heading">
        <h3>{t("speedDoctor.networkTitle")}</h3>
        <span>{t("speedDoctor.networkSubtitle")}</span>
      </div>
      {torrents.length === 0 ? (
        <p className="file-pending">{t("speedDoctor.noActiveTorrents")}</p>
      ) : (
        torrents.map((torrent) => (
          <div className="torrent-diagnostic-item" key={torrent.id}>
            <div className="section-heading">
              <strong>{torrent.name}</strong>
              <button
                type="button"
                className="secondary small-button"
                onClick={() => void onRunSpeedDoctor(torrent.id)}
              >
                {t("action.whySlow")}
              </button>
            </div>
            {reports[torrent.id] ? (
              <SpeedDoctorReportCard
                report={reports[torrent.id]}
                locale={locale}
                t={t}
                aiEnabled={aiEnabled}
                aiAdvice={aiAdvice[torrent.id]}
                aiLoading={Boolean(aiLoading[torrent.id])}
                onAskAI={
                  onAskAI ? () => onAskAI(reports[torrent.id]) : undefined
                }
                onAction={(actionId) =>
                  onAction(torrent, reports[torrent.id], actionId)
                }
              />
            ) : (
              <TorrentHealthBadge report={undefined} t={t} />
            )}
          </div>
        ))
      )}
    </section>
  );
}

function TorrentLabelsEditor({
  torrent,
  t,
  onSave
}: {
  torrent: TorrentSummary;
  t: (key: string) => string;
  onSave: (id: string, category: string, tags: string) => void;
}) {
  const savedCategory = torrent.category ?? "";
  const savedTags = torrent.tags.join(", ");
  const [category, setCategory] = useState(savedCategory);
  const [tags, setTags] = useState(savedTags);

  useEffect(() => {
    setCategory(savedCategory);
    setTags(savedTags);
  }, [torrent.id, savedCategory, savedTags]);

  const hasChanges = category !== savedCategory || tags !== savedTags;

  return (
    <section className="labels-editor" aria-label={t("labels.title")}>
      <label>
        <span>{t("labels.category")}</span>
        <input
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder={t("labels.noCategory")}
        />
      </label>
      <label>
        <span>{t("labels.tags")}</span>
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder={t("labels.noTags")}
        />
      </label>
      <button
        type="button"
        className="secondary"
        disabled={!hasChanges}
        onClick={() => onSave(torrent.id, category, tags)}
      >
        {t("action.saveLabels")}
      </button>
    </section>
  );
}

function TorrentFiles({
  torrent,
  locale,
  t,
  onPriorityChange
}: {
  torrent: TorrentSummary;
  locale: Locale;
  t: (key: string) => string;
  onPriorityChange: (
    id: string,
    fileIndex: number,
    priority: TorrentFilePriority
  ) => void;
}) {
  const priorities: TorrentFilePriority[] = ["skip", "normal", "high"];

  return (
    <section className="torrent-files" aria-label={t("files.title")}>
      <div className="section-heading">
        <h3>{t("files.title")}</h3>
        <span>{torrent.files.length}</span>
      </div>

      {torrent.files.length === 0 ? (
        <p className="file-pending">{t("files.pending")}</p>
      ) : (
        <div className="file-list">
          {torrent.files.map((file) => (
            <div className="file-row" key={`${torrent.id}-${file.index}`}>
              <div className="file-main">
                <strong>{file.path || file.name}</strong>
                <span>
                  {formatBytes(file.downloadedBytes)} /{" "}
                  {formatBytes(file.lengthBytes)} ·{" "}
                  {formatPercent(file.progress, locale)}
                </span>
              </div>
              <select
                value={file.priority}
                aria-label={`${t("files.priority")} ${file.name}`}
                onChange={(event) =>
                  onPriorityChange(
                    torrent.id,
                    file.index,
                    event.target.value as TorrentFilePriority
                  )
                }
              >
                {priorities.map((priority) => (
                  <option value={priority} key={priority}>
                    {t(`files.priority.${priority}`)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function applyCoreEvent(
  snapshot: TorrentCoreSnapshot,
  event: TorrentCoreEvent
): TorrentCoreSnapshot {
  if (event.type === "torrent.status.changed") {
    return {
      ...snapshot,
      torrents: upsertTorrent(snapshot.torrents, event.payload.torrent)
    };
  }

  if (
    event.type === "torrent.added" ||
    event.type === "torrent.metadata.received" ||
    event.type === "torrent.progress.updated" ||
    event.type === "torrent.completed" ||
    event.type === "torrent.labels.updated" ||
    event.type === "torrent.files.updated"
  ) {
    return {
      ...snapshot,
      torrents: upsertTorrent(snapshot.torrents, event.payload)
    };
  }

  return snapshot;
}

function upsertTorrent(torrents: TorrentSummary[], torrent: TorrentSummary) {
  const index = torrents.findIndex((item) => item.id === torrent.id);

  if (index === -1) {
    return [...torrents, torrent];
  }

  return torrents.map((item, itemIndex) =>
    itemIndex === index ? torrent : item
  );
}

function applyResult<T>(
  result: TorrentCoreResult<T>,
  onSuccess: (value: T) => void,
  onError: () => void
) {
  if (result.ok) {
    onSuccess(result.value);
    return;
  }

  onError();
}

function applyAIResult<T>(
  result: AIResult<T>,
  onSuccess: (value: T) => void,
  onError: () => void
) {
  if (result.ok) {
    onSuccess(result.value);
    return;
  }

  onError();
}

function getFriendlyError<T>(
  result: Extract<TorrentCoreResult<T>, { ok: false }>,
  t: (key: string) => string
) {
  if (result.error.code === "cancelled") {
    return t("message.cancelled");
  }

  if (result.error.code === "unauthorized") {
    return t("remote.unauthorized");
  }

  if (result.error.code === "remote_password_required") {
    return t("remote.passwordRequired");
  }

  if (result.error.code === "remote_password_too_short") {
    return t("remote.passwordTooShort");
  }

  if (result.error.code.startsWith("unsupported_remote")) {
    return t("remote.unsupportedAction");
  }

  return t("error.operationFailed");
}

function getFriendlyAIError<T>(
  result: Extract<AIResult<T>, { ok: false }>,
  t: (key: string) => string
) {
  if (result.error.code === "ai_error") {
    return result.error.message || t("ai.error");
  }

  return t("ai.error");
}

function isRemoteUnauthorized<T>(
  result: TorrentCoreResult<T>,
  isRemoteWeb: boolean
) {
  return !result.ok && isRemoteWeb && result.error.code === "unauthorized";
}

function getViewTitle(nav: NavItem, t: (key: string) => string) {
  return nav === "downloads" ? t("home.title") : t(`nav.${nav}`);
}

function getActiveAIProvider(settings: AISettings | null) {
  if (!settings) {
    return null;
  }

  return (
    settings.providers.find(
      (provider) => provider.providerId === settings.activeProviderId
    ) ?? createDefaultAIProviderConfig(settings.activeProviderId)
  );
}

function upsertAIProvider(
  providers: AIProviderConfig[],
  provider: AIProviderConfig
) {
  if (providers.some((item) => item.providerId === provider.providerId)) {
    return providers.map((item) =>
      item.providerId === provider.providerId ? provider : item
    );
  }

  return [...providers, provider];
}

function createAddAssistantAIContext({
  recommendation,
  activeDownloadCount,
  currentDownloadSpeedBytes,
  category,
  tags,
  networkState
}: {
  recommendation: SmartAssistantRecommendation;
  activeDownloadCount: number;
  currentDownloadSpeedBytes: number;
  category: string;
  tags: string[];
  networkState: NetworkSettingsState | null;
}): AIAdviceContext {
  const anomalies = [
    ...recommendation.warnings,
    networkState?.activeSettings.speedLimits.downloadBytesPerSecond !== null
      ? "global_download_limit"
      : null,
    activeDownloadCount >= 3 ? "many_active_downloads" : null
  ].filter((item): item is string => Boolean(item));

  return {
    healthScore: recommendation.healthScore,
    seeders: 0,
    leechers: activeDownloadCount,
    totalSizeGb: 0,
    fileCategory: inferTextCategory(category, tags),
    freeDiskGb: null,
    currentSpeedKb: currentDownloadSpeedBytes / 1024,
    avgSpeedKb: currentDownloadSpeedBytes / 1024,
    hourOfDay: new Date().getHours(),
    anomalies,
    suggestedProfile: recommendation.profileId,
    reportStatus: recommendation.healthStatus,
    primaryReason: recommendation.reasons[0] ?? null,
    activePeers: activeDownloadCount,
    privateTorrent: recommendation.profileId === "private_tracker",
    metadataReady: false
  };
}

function createTorrentAIAdviceContext({
  torrent,
  recommendation,
  report
}: {
  torrent: TorrentSummary;
  recommendation: SmartAssistantRecommendation;
  report?: TorrentSpeedDoctorReport;
}): AIAdviceContext {
  return {
    healthScore: recommendation.healthScore,
    seeders: torrent.seeds,
    leechers: torrent.peers,
    totalSizeGb: torrent.sizeBytes / 1024 ** 3,
    fileCategory: inferTorrentFileCategory(torrent),
    freeDiskGb:
      report?.technicalDetails.disk?.availableBytes === undefined
        ? null
        : report.technicalDetails.disk.availableBytes / 1024 ** 3,
    currentSpeedKb: torrent.downloadSpeedBytes / 1024,
    avgSpeedKb: torrent.downloadSpeedBytes / 1024,
    hourOfDay: new Date().getHours(),
    anomalies: [
      ...recommendation.warnings,
      ...(report?.reasons.map((reason) => reason.code) ?? [])
    ],
    suggestedProfile: recommendation.profileId,
    reportStatus: report?.status ?? recommendation.healthStatus,
    primaryReason: report?.primaryReason ?? recommendation.reasons[0] ?? null,
    activePeers: torrent.peers,
    privateTorrent: torrent.private,
    metadataReady: torrent.metadataReady
  };
}

function createSpeedDoctorAIContext(
  report: TorrentSpeedDoctorReport
): AIAdviceContext {
  const torrent = report.technicalDetails.torrent;
  const disk = report.technicalDetails.disk;
  const speedKb = torrent.downloadSpeedBytes / 1024;

  return {
    healthScore: report.status === "ok" ? 80 : report.status === "warning" ? 55 : 25,
    seeders: torrent.seeds,
    leechers: torrent.peers,
    totalSizeGb: 0,
    fileCategory: "unknown",
    freeDiskGb: disk ? disk.availableBytes / 1024 ** 3 : null,
    currentSpeedKb: speedKb,
    avgSpeedKb: speedKb,
    hourOfDay: new Date(report.generatedAt).getHours(),
    anomalies: report.reasons.map((reason) => reason.code),
    suggestedProfile: torrent.selectedProfileId,
    reportStatus: report.status,
    primaryReason: report.primaryReason,
    activePeers: torrent.peers,
    privateTorrent: torrent.private,
    metadataReady: torrent.metadataReady
  };
}

function inferTextCategory(category: string, tags: string[]) {
  const text = [category, ...tags].join(" ").toLowerCase();

  if (/(movie|film|video|music|audio|series|tv)/.test(text)) {
    return "media";
  }

  if (/(iso|app|software|setup|installer)/.test(text)) {
    return "software";
  }

  if (/(book|pdf|document|doc|epub)/.test(text)) {
    return "document";
  }

  return category.trim() || "unknown";
}

function inferTorrentFileCategory(torrent: TorrentSummary) {
  const paths = torrent.files.map((file) => `${file.name} ${file.path}`.toLowerCase());

  if (paths.some((value) => /\.(mkv|mp4|avi|mov|webm|mp3|flac|wav)\b/.test(value))) {
    return "media";
  }

  if (paths.some((value) => /\.(zip|rar|7z|tar|gz|iso)\b/.test(value))) {
    return "archive";
  }

  if (paths.some((value) => /\.(pdf|epub|djvu|doc|docx)\b/.test(value))) {
    return "document";
  }

  return "unknown";
}

function getAddOptions(
  settings: AutomationSettings | null,
  favoriteFolderId: string,
  categoryDraft: string,
  tagsDraft: string
) {
  const favoriteFolder = settings?.favoriteFolders.find(
    (folder) => folder.id === favoriteFolderId
  );
  const category = categoryDraft.trim() || favoriteFolder?.category || null;
  const tags = mergeTags(favoriteFolder?.tags ?? [], parseTags(tagsDraft));

  return {
    downloadPath: favoriteFolder?.path,
    category,
    tags
  };
}

function readStoredDownloadProfile(): DownloadProfileId {
  try {
    const value = window.localStorage.getItem(LAST_DOWNLOAD_PROFILE_KEY);
    return DOWNLOAD_PROFILE_IDS.includes(value as DownloadProfileId)
      ? (value as DownloadProfileId)
      : "manual";
  } catch {
    return "manual";
  }
}

function storeDownloadProfile(profileId: DownloadProfileId) {
  try {
    window.localStorage.setItem(LAST_DOWNLOAD_PROFILE_KEY, profileId);
  } catch {
    // Local storage can be unavailable in restricted WebUI contexts.
  }
}

function createTorrentAssistantInput({
  torrent,
  selectedProfileId,
  activeDownloadCount,
  favoriteFolders,
  existingFileNames,
  networkProfileId,
  privateMode,
  activeSpeedSchedule,
  disk
}: {
  torrent: TorrentSummary;
  selectedProfileId?: DownloadProfileId;
  activeDownloadCount: number;
  favoriteFolders: FavoriteFolderSettings[];
  existingFileNames: string[];
  networkProfileId?: string | null;
  privateMode?: boolean;
  activeSpeedSchedule: boolean;
  disk?: { availableBytes: number; totalBytes?: number } | null;
}) {
  return {
    selectedProfileId,
    category: torrent.category,
    tags: torrent.tags,
    favoriteFolders,
    activeDownloadCount,
    networkProfileId,
    privateMode,
    activeSpeedSchedule,
    sizeBytes: torrent.sizeBytes,
    files: torrent.files.map((file) => ({
      name: file.name,
      path: file.path,
      lengthBytes: file.lengthBytes,
      selected: file.selected
    })),
    savePath: torrent.savePath,
    disk,
    existingFileNames: existingFileNames.filter(
      (name) => !torrent.files.some((file) => file.path === name || file.name === name)
    ),
    metadataReady: torrent.metadataReady,
    privateTorrent: torrent.private,
    seeds: torrent.seeds,
    peers: torrent.peers,
    trackerCount: torrent.trackerHosts.length,
    hasWebSeeds: false,
    sourceType: torrent.sourceType
  };
}

function findSpeedDoctorCandidate(torrents: TorrentSummary[]) {
  return (
    torrents.find(
      (torrent) =>
        torrent.status === "downloading" &&
        (torrent.downloadSpeedBytes < AUTO_SPEED_DOCTOR_LOW_SPEED_BYTES ||
          torrent.peers === 0)
    ) ??
    torrents.find((torrent) => torrent.status === "downloading") ??
    torrents.find((torrent) => torrent.status === "queued") ??
    null
  );
}

function formatAssistantSuggestion(
  suggestion: SmartAssistantSuggestion,
  t: (key: string) => string
) {
  if (suggestion.type === "folder") {
    return `${t("assistant.suggestion.folder")}: ${
      suggestion.label ?? suggestion.value
    }`;
  }

  if (suggestion.type === "category") {
    return `${t("assistant.suggestion.category")}: ${suggestion.value}`;
  }

  if (suggestion.type === "tags") {
    return `${t("assistant.suggestion.tags")}: ${suggestion.value}`;
  }

  if (suggestion.type === "file_priority") {
    return `${t("assistant.suggestion.filePriority")}: ${
      suggestion.label ?? suggestion.filePath ?? suggestion.value
    } (${suggestion.value})`;
  }

  if (suggestion.type === "start_paused") {
    return t("assistant.suggestion.startPaused");
  }

  if (suggestion.type === "recheck_after_complete") {
    return t("assistant.suggestion.recheck");
  }

  return `${t("assistant.suggestion.profileTemplate")}: ${t(
    `profile.${suggestion.value}`
  )}`;
}

function replaceById<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<T>
) {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id);
}

function createWatchFolderDraft(): WatchFolderSettings {
  return {
    id: createClientId("watch"),
    path: "",
    enabled: true,
    profileId: "manual",
    startPaused: false,
    category: null,
    tags: []
  };
}

function createFavoriteFolderDraft(): FavoriteFolderSettings {
  return {
    id: createClientId("favorite"),
    name: "",
    path: "",
    category: null,
    tags: []
  };
}

function createSeedingRuleDraft(): SeedingRuleSettings {
  return {
    id: createClientId("seed"),
    name: "",
    enabled: true,
    ratioLimit: 2,
    minutesAfterComplete: null,
    action: "pause",
    requireConfirmationBeforeDataRemoval: true
  };
}

function createRssRuleDraft(): RssAutoLoadRuleSettings {
  return {
    id: createClientId("rss"),
    name: "",
    enabled: true,
    feedUrl: "",
    match: "",
    exclude: "",
    profileId: "manual",
    category: null,
    tags: [],
    seenItemIds: []
  };
}

function createSpeedScheduleDraft(): SpeedLimitScheduleSettings {
  return {
    id: createClientId("speed"),
    name: "",
    enabled: true,
    daysOfWeek: [1, 2, 3, 4, 5],
    startMinuteOfDay: 0,
    endMinuteOfDay: 420,
    downloadBytesPerSecond: 512 * 1024,
    uploadBytesPerSecond: 128 * 1024
  };
}

function createClientId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function parseTags(value: string) {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeTags(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right].filter(Boolean)));
}

function createWarningDismissKey(warningId: string, torrentId: string | null) {
  return `${torrentId ?? "global"}:${warningId}`;
}

function formatHours(hours: number[]) {
  return hours.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ");
}

function applyNetworkProfileToDraft(
  settings: NetworkSettings,
  profileId: NetworkProfileId
): NetworkSettings {
  const base = { ...settings, profileId };

  if (profileId === "standard") {
    return {
      ...base,
      dht: true,
      pex: true,
      lsd: true,
      privateMode: false,
      encryptionMode: "allowed",
      speedLimits: {
        downloadBytesPerSecond: null,
        uploadBytesPerSecond: null
      },
      proxy: {
        ...base.proxy,
        type: "none",
        host: "",
        port: null,
        username: "",
        passwordConfigured: false
      }
    };
  }

  if (profileId === "private_tracker") {
    return {
      ...base,
      dht: false,
      pex: false,
      lsd: false,
      privateMode: true
    };
  }

  if (profileId === "encryption") {
    return {
      ...base,
      encryptionMode: "preferred"
    };
  }

  if (profileId === "proxy") {
    return {
      ...base,
      proxy: {
        ...base.proxy,
        type: base.proxy.type === "none" ? "socks5" : base.proxy.type
      }
    };
  }

  if (profileId === "vpn_interface") {
    return {
      ...base,
      networkInterface: {
        ...base.networkInterface,
        bindOnly: true,
        killSwitch: true
      }
    };
  }

  if (profileId === "traffic_saver") {
    return {
      ...base,
      speedLimits: {
        downloadBytesPerSecond: 512 * 1024,
        uploadBytesPerSecond: 128 * 1024
      }
    };
  }

  return base;
}

function getUniqueNetworkInterfaces(state: NetworkSettingsState | null) {
  return Array.from(
    new Set(
      state?.availableInterfaces
        .filter((item) => !item.internal)
        .map((item) => item.name) ?? []
    )
  );
}

function parseKilobyteLimit(value: string) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.round(numeric * 1024);
}

function formatKilobyteLimit(value: number | null) {
  return value === null ? "" : String(Math.round(value / 1024));
}

function parseOptionalNumber(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function parseOptionalInteger(value: string) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function parseDaysOfWeek(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
    )
  ).sort((left, right) => left - right);
}

function parseTimeRange(value: string): Partial<SpeedLimitScheduleSettings> {
  const [start, end] = value.split("-");
  const startMinute = parseMinuteOfDay(start);
  const endMinute = parseMinuteOfDay(end);

  if (startMinute === null || endMinute === null) {
    return {};
  }

  return {
    startMinuteOfDay: startMinute,
    endMinuteOfDay: endMinute
  };
}

function parseMinuteOfDay(value: string | undefined) {
  if (!value) {
    return null;
  }

  const [hoursValue, minutesValue = "0"] = value.trim().split(":");
  const hours = Number(hoursValue);
  const minutes = Number(minutesValue);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatMinuteOfDay(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parsePort(value: string) {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    return null;
  }

  return numeric;
}

function parseRemoteAccessPort(value: string) {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric < 1024 || numeric > 65535) {
    return 43171;
  }

  return numeric;
}

function parseRemoteAccessAllowedIps(value: string) {
  return value
    .split(/[\n,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatBytes(bytes: number | null | undefined) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = toNonNegativeNumber(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${
    units[unitIndex]
  }`;
}

function formatSpeed(bytesPerSecond: number | null | undefined) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatKbSpeed(kbPerSecond: number | null | undefined) {
  return formatSpeed(toNonNegativeNumber(kbPerSecond) * 1024);
}

function formatPortReachability(
  value: boolean | null,
  t: (key: string) => string
) {
  if (value === null) {
    return t("speedDoctor.portUnknown");
  }

  return value ? t("speedDoctor.portOpen") : t("speedDoctor.portClosed");
}

function formatChartHour(value: string, locale: Locale) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatPercent(value: number | null | undefined, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0
  }).format(toRatio(value));
}

function formatDateTime(value: string, locale: Locale) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatEta(seconds: number | null, fallback: string) {
  if (seconds === null) {
    return fallback;
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatSpeedDoctorEvidence(
  value: string | number | boolean | null,
  code: string,
  locale: Locale
) {
  if (value === null) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (code === "global_download_limit") {
      return formatSpeed(value);
    }

    if (code === "disk_space_low") {
      return formatBytes(value);
    }

    if (
      code === "speed_below_baseline" ||
      code === "speed_drop_sudden"
    ) {
      return formatKbSpeed(value);
    }

    if (code === "isp_throttling_suspect") {
      return `${new Intl.NumberFormat(locale).format(value)}%`;
    }

    return new Intl.NumberFormat(locale).format(value);
  }

  return value;
}

function formatSpeedDoctorTechnicalReport(report: TorrentSpeedDoctorReport) {
  return JSON.stringify(
    {
      generatedAt: report.generatedAt,
      torrentId: report.torrentId,
      status: report.status,
      primaryReason: report.primaryReason,
      reasons: report.reasons,
      actions: report.actions,
      technicalDetails: {
        ...report.technicalDetails,
        exportText: "[see copied/saved text report]"
      },
      redacted: report.redacted
    },
    null,
    2
  );
}

function toNonNegativeNumber(value: number | null | undefined) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  return numeric;
}

function toRatio(value: number | null | undefined) {
  return Math.min(1, toNonNegativeNumber(value));
}

function formatDiagnosticValue(
  value: string | number | boolean | null,
  code: string,
  locale: Locale,
  t: (key: string) => string
) {
  if (value === null) {
    return t("diagnostics.value.auto");
  }

  if (typeof value === "boolean") {
    return value ? t("diagnostics.value.enabled") : t("diagnostics.value.disabled");
  }

  if (
    typeof value === "number" &&
    (code === "global_download_limit" || code === "global_upload_limit")
  ) {
    return formatSpeed(value);
  }

  if (typeof value === "number") {
    return new Intl.NumberFormat(locale).format(value);
  }

  return value;
}
