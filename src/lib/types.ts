export type Task = {
  id: string;
  title: string;
  estimate: number;
  project: string;
  date: string;
  done: boolean;
};
export type Project = { id: string; name: string; icon: string; color: string };
export type FocusRecord = {
  id: string;
  taskId: string;
  seconds: number;
  pomodoros: number;
  duration: number;
  at: number;
};
export type Timer = {
  taskId: string | null;
  duration: number;
  elapsed: number;
  startedAt: number;
  running: boolean;
  phase: 'focus' | 'rest';
};
export type AppState = {
  version: 1;
  settings: {
    focus: number;
    rest: number;
    trayDisplay: 'clock' | 'bar' | 'ring' | 'hourglass';
  };
  projects: Project[];
  tasks: Task[];
  records: FocusRecord[];
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
    };
  }
}
