
export interface TranscriptionEntry {
  id: string;
  type: 'user' | 'model';
  text: string;
  timestamp: number;
}

export enum SessionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}
