export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  error?: string;
}
