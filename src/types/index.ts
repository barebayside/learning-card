export interface Card {
  id: number;
  topic_id: number;
  question_type: 'recall' | 'conceptual' | 'application' | 'mcq' | 'open_ended';
  difficulty_tier: 'foundational' | 'intermediate' | 'advanced';
  question_text: string;
  answer_text: string;
  options_json: string | null;
  options?: string[];
  explanation: string | null;
  tags: string | null;
  card_state: 'new' | 'learning' | 'review' | 'relearning';
  ease_factor: number;
  interval_days: number;
  step_index: number;
  due_date: string | null;
  review_count: number;
  lapse_count: number;
  is_suspended: boolean;
  created_at: string;
  updated_at: string;
  topic_title?: string;
  topic_path?: string;
  source_id?: number;
  source_filename?: string;
}

export interface ContentSource {
  id: number;
  filename: string;
  file_type: string;
  status: 'pending' | 'processing' | 'imported' | 'processed' | 'error';
  error_message: string | null;
  import_date: string;
}

export interface Topic {
  id: number;
  source_id: number;
  title: string;
  topic_path: string;
  content_text: string;
  sequence_order: number;
  word_count: number;
}

export interface CardStats {
  total: number;
  new_count: number;
  learning_count: number;
  review_count: number;
  relearning_count: number;
  suspended_count: number;
  due_count: number;
  reviews_today: number;
  correct_today: number;
}

export interface GradeResult {
  card_id: number;
  new_state: string;
  new_interval: number;
  new_ease: number;
  due_date: string;
}

export interface StudySession {
  session_id: number;
  cards: Card[];
  total_available: number;
}

export interface TutorMessage {
  role: 'user' | 'assistant';
  content: string;
}
