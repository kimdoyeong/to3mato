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
  version: 1;
  settings: Settings;
  projects: Project[];
  tasks: Task[];
  records: FocusRecord[];
  tickets: Ticket[];
  templates: Template[];
  timer: Timer | null;
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
      onError(callback: (message: string) => void): () => void;
      exportData(): Promise<boolean>;
      exportVideo(bytes: ArrayBuffer, filename: string): Promise<boolean>;
      importData(): Promise<AppState | null>;
      pickProjectImage(): Promise<string | null>;
      readProjectImage(file: string): Promise<string>;
    };
  }
}
