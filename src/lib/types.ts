export type Task = {
  id: string;
  title: string;
  estimate: number;
  remaining: number;
  followUpOf: string;
  project: string;
  date: string;
  done: boolean;
};
export type Project = {
  id: string;
  name: string;
  icon: string;
  color: string;
  outcome: string;
  image: string;
};
export type FocusRecord = {
  id: string;
  taskId: string;
  seconds: number;
  pomodoros: number;
  duration: number;
  at: number;
};
export type TicketSticker = '' | 'star' | 'heart' | 'leaf';
export type Ticket = {
  id: string;
  taskId: string;
  title: string;
  projectId: string;
  completedAt: number;
  estimate: number;
  used: number;
  clipId: string;
  note: string;
  highlight: boolean;
  sticker: TicketSticker;
  voided: boolean;
};
export type TemplateStep = { title: string; estimate: number };
export type Template = { id: string; name: string; steps: TemplateStep[] };
export type TimerPhase = 'focus' | 'checkin' | 'rest';
export type Timer = {
  taskId: string | null;
  duration: number;
  elapsed: number;
  startedAt: number;
  running: boolean;
  phase: TimerPhase;
};
export type Settings = {
  focus: number;
  rest: number;
  trayDisplay: 'clock' | 'bar' | 'ring' | 'hourglass';
  dailyCapacity: number;
  planAt: string;
  reviewAt: string;
  remindDays: number[];
};
export type AppState = {
  syncContext?: SyncContext;
  version: 1;
  settings: Settings;
  projects: Project[];
  tasks: Task[];
  records: FocusRecord[];
  tickets: Ticket[];
  templates: Template[];
  timer: Timer | null;
};
export type SyncContext = {
  owner: string;
  deviceId: string;
  controller: string | null;
  sessionId: string | null;
  source: string;
  offset: number;
  timeZone: string;
  extras: Record<string, Array<Record<string, any>>>;
};
export type AccountStatus = {
  mediaPending?: number;
  mediaError?: string;
  adoptLocalMedia?: boolean;
  configured: boolean;
  user: { id: string; email?: string } | null;
  scope: string;
  enabled: boolean;
  connection: string;
  pending: number;
  error: string;
  conflicts: Array<{
    id: string;
    reason: string;
    at: number;
    archived?: boolean;
    document?: unknown;
  }>;
};
export type Command = { type: string; payload?: Record<string, unknown> };
export type UpdateStatus =
  | { status: 'idle' | 'checking' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };
declare global {
  interface Window {
    to3mato?: {
      account: {
        status(): Promise<AccountStatus>;
        requestCode(email: string): Promise<void>;
        verify(email: string, code: string): Promise<AccountStatus>;
        enable(): Promise<AccountStatus>;
        disable(): Promise<AccountStatus>;
        mediaAdopted(): Promise<void>;
        logout(): Promise<AccountStatus>;
        remove(): Promise<AccountStatus>;
        syncNow(): Promise<AccountStatus>;
        resolve(
          id: string,
          action: 'keep' | 'discard' | 'timer',
        ): Promise<void>;
        subscribe(callback: (status: AccountStatus) => void): () => void;
      };
      sync: {
        extra(
          entity: string,
          id: string,
          fields: Record<string, unknown>,
          deleted?: boolean,
          owner?: string,
        ): Promise<void>;
        putAsset(
          id: string,
          mime: string,
          bytes: ArrayBuffer,
          owner?: string,
        ): Promise<string>;
        readAsset(
          id: string,
          owner?: string,
        ): Promise<{ bytes: Uint8Array; mime: string } | null>;
        projectImages(): Promise<void>;
      };
      version(): Promise<string>;
      update: {
        check(): Promise<UpdateStatus>;
        install(): Promise<boolean>;
        subscribe(callback: (status: UpdateStatus) => void): () => void;
      };
      subscribeVisibility(callback: (visible: boolean) => void): () => void;
      showMain(): Promise<void>;
      load(): Promise<AppState>;
      dispatch(command: Command): Promise<AppState>;
      subscribe(callback: (state: AppState) => void): () => void;
      onRitual(callback: (kind: 'plan' | 'review') => void): () => void;
      ritualDates(): Promise<{ plannedDate: string; reviewedDate: string }>;
      finishRitual(kind: 'plan' | 'review', date: string): Promise<boolean>;
      onError(callback: (message: string) => void): () => void;
      exportData(): Promise<boolean>;
      exportVideo(bytes: ArrayBuffer, filename: string): Promise<boolean>;
      importData(): Promise<AppState | null>;
      pickProjectImage(): Promise<string | null>;
      readProjectImage(file: string): Promise<string>;
    };
  }
}
