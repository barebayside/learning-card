-- Initial schema for AI Learn Tutor (Postgres / Supabase)
-- Converted from SQLite schema

CREATE TABLE IF NOT EXISTS content_sources (
    id              BIGSERIAL PRIMARY KEY,
    filename        TEXT NOT NULL,
    file_type       TEXT NOT NULL CHECK(file_type IN ('json','docx','pdf','txt')),
    file_hash       TEXT NOT NULL UNIQUE,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    raw_text        TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','processing','imported','processed','error')),
    error_message   TEXT,
    import_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS topics (
    id              BIGSERIAL PRIMARY KEY,
    source_id       BIGINT NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    topic_path      TEXT NOT NULL DEFAULT '',
    content_text    TEXT NOT NULL,
    sequence_order  INTEGER NOT NULL DEFAULT 0,
    word_count      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_topics_source ON topics(source_id);

CREATE TABLE IF NOT EXISTS cards (
    id              BIGSERIAL PRIMARY KEY,
    topic_id        BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    question_type   TEXT NOT NULL
                    CHECK(question_type IN ('recall','conceptual','application','mcq','open_ended')),
    difficulty_tier TEXT NOT NULL DEFAULT 'foundational'
                    CHECK(difficulty_tier IN ('foundational','intermediate','advanced')),
    question_text   TEXT NOT NULL,
    answer_text     TEXT NOT NULL,
    options_json    TEXT,
    explanation     TEXT,
    tags            TEXT,
    card_state      TEXT NOT NULL DEFAULT 'new'
                    CHECK(card_state IN ('new','learning','review','relearning')),
    ease_factor     DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    interval_days   DOUBLE PRECISION NOT NULL DEFAULT 0,
    step_index      INTEGER NOT NULL DEFAULT 0,
    due_date        TIMESTAMPTZ,
    review_count    INTEGER NOT NULL DEFAULT 0,
    lapse_count     INTEGER NOT NULL DEFAULT 0,
    is_suspended    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cards_topic ON cards(topic_id);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due_date, card_state);
CREATE INDEX IF NOT EXISTS idx_cards_state ON cards(card_state);

CREATE TABLE IF NOT EXISTS review_history (
    id              BIGSERIAL PRIMARY KEY,
    card_id         BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    session_id      BIGINT,
    grade           INTEGER NOT NULL CHECK(grade BETWEEN 0 AND 3),
    previous_interval DOUBLE PRECISION,
    new_interval    DOUBLE PRECISION,
    previous_ease   DOUBLE PRECISION,
    new_ease        DOUBLE PRECISION,
    time_taken_ms   INTEGER,
    reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_card ON review_history(card_id);
CREATE INDEX IF NOT EXISTS idx_review_date ON review_history(reviewed_at);

CREATE TABLE IF NOT EXISTS study_sessions (
    id              BIGSERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','completed','abandoned')),
    cards_studied   INTEGER NOT NULL DEFAULT 0,
    cards_correct   INTEGER NOT NULL DEFAULT 0,
    total_time_ms   INTEGER NOT NULL DEFAULT 0,
    topic_filter    TEXT,
    settings_json   TEXT
);

CREATE TABLE IF NOT EXISTS tutor_conversations (
    id              BIGSERIAL PRIMARY KEY,
    card_id         BIGINT REFERENCES cards(id),
    topic_id        BIGINT REFERENCES topics(id),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    summary         TEXT
);

CREATE TABLE IF NOT EXISTS tutor_messages (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES tutor_conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content         TEXT NOT NULL,
    tokens_used     INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tutor_msg_conv ON tutor_messages(conversation_id);

CREATE TABLE IF NOT EXISTS user_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS Policies (allow all, single user, no auth) ──

ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on content_sources" ON content_sources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on topics" ON topics FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on cards" ON cards FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on review_history" ON review_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on study_sessions" ON study_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on tutor_conversations" ON tutor_conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on tutor_messages" ON tutor_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on user_settings" ON user_settings FOR ALL USING (true) WITH CHECK (true);

-- ── Helper Functions ──

-- Increment review count
CREATE OR REPLACE FUNCTION increment_card_review(p_card_id BIGINT)
RETURNS void AS $$
BEGIN
  UPDATE cards SET review_count = review_count + 1 WHERE id = p_card_id;
END;
$$ LANGUAGE plpgsql;

-- Increment lapse count
CREATE OR REPLACE FUNCTION increment_card_lapse(p_card_id BIGINT)
RETURNS void AS $$
BEGIN
  UPDATE cards SET lapse_count = lapse_count + 1 WHERE id = p_card_id;
END;
$$ LANGUAGE plpgsql;

-- ── Aggregate RPC Functions ──

-- get_card_stats: Dashboard stats
CREATE OR REPLACE FUNCTION get_card_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM cards WHERE NOT is_suspended),
    'new_count', (SELECT COUNT(*) FROM cards WHERE card_state = 'new' AND NOT is_suspended),
    'learning_count', (SELECT COUNT(*) FROM cards WHERE card_state = 'learning' AND NOT is_suspended),
    'review_count', (SELECT COUNT(*) FROM cards WHERE card_state = 'review' AND NOT is_suspended),
    'relearning_count', (SELECT COUNT(*) FROM cards WHERE card_state = 'relearning' AND NOT is_suspended),
    'suspended_count', (SELECT COUNT(*) FROM cards WHERE is_suspended),
    'due_count', (SELECT COUNT(*) FROM cards WHERE card_state IN ('review','relearning') AND NOT is_suspended AND due_date <= NOW()),
    'reviews_today', (SELECT COUNT(*) FROM review_history WHERE reviewed_at::date = CURRENT_DATE),
    'correct_today', (SELECT COUNT(*) FROM review_history WHERE reviewed_at::date = CURRENT_DATE AND grade >= 2)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- get_sources_summary: Sources with card counts
CREATE OR REPLACE FUNCTION get_sources_summary()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(row_data) INTO result FROM (
    SELECT
      cs.id AS source_id,
      cs.filename,
      COALESCE(card_counts.card_count, 0) AS card_count,
      COALESCE(card_counts.due_count, 0) AS due_count,
      COALESCE(card_counts.new_count, 0) AS new_count,
      COALESCE(card_counts.learning_count, 0) AS learning_count
    FROM content_sources cs
    LEFT JOIN (
      SELECT
        t.source_id,
        COUNT(c.id) AS card_count,
        COUNT(c.id) FILTER (WHERE c.card_state IN ('review','relearning') AND NOT c.is_suspended AND c.due_date <= NOW()) AS due_count,
        COUNT(c.id) FILTER (WHERE c.card_state = 'new' AND NOT c.is_suspended) AS new_count,
        COUNT(c.id) FILTER (WHERE c.card_state IN ('learning','relearning') AND NOT c.is_suspended) AS learning_count
      FROM topics t
      JOIN cards c ON c.topic_id = t.id
      GROUP BY t.source_id
    ) card_counts ON card_counts.source_id = cs.id
    ORDER BY cs.import_date DESC
  ) row_data;
  RETURN COALESCE(result, '[]'::json);
END;
$$ LANGUAGE plpgsql;

-- get_topic_stats: Card counts per topic for a source
CREATE OR REPLACE FUNCTION get_topic_stats(p_source_id BIGINT)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(row_data) INTO result FROM (
    SELECT
      t.id AS topic_id,
      t.title AS topic_title,
      COUNT(c.id) AS card_count,
      COUNT(c.id) FILTER (WHERE c.card_state IN ('review','relearning') AND NOT c.is_suspended AND c.due_date <= NOW()) AS due_count,
      COUNT(c.id) FILTER (WHERE c.card_state = 'new' AND NOT c.is_suspended) AS new_count,
      COUNT(c.id) FILTER (WHERE c.card_state IN ('learning','relearning') AND NOT c.is_suspended) AS learning_count
    FROM topics t
    LEFT JOIN cards c ON c.topic_id = t.id
    WHERE t.source_id = p_source_id
    GROUP BY t.id, t.title
    ORDER BY t.sequence_order
  ) row_data;
  RETURN COALESCE(result, '[]'::json);
END;
$$ LANGUAGE plpgsql;

-- get_reports: Full reports data
CREATE OR REPLACE FUNCTION get_reports()
RETURNS JSON AS $$
DECLARE
  result JSON;
  topic_stats_json JSON;
  daily_stats_json JSON;
  schedule_json JSON;
BEGIN
  -- Topic performance
  SELECT json_agg(row_data) INTO topic_stats_json FROM (
    SELECT
      t.id AS topic_id,
      t.title AS topic_title,
      cs.filename AS source_filename,
      COUNT(rh.id) AS total_reviews,
      COUNT(rh.id) FILTER (WHERE rh.grade >= 2) AS correct_count,
      CASE WHEN COUNT(rh.id) > 0
        THEN ROUND((COUNT(rh.id) FILTER (WHERE rh.grade >= 2) * 100.0 / COUNT(rh.id))::numeric)
        ELSE 0
      END AS accuracy_pct,
      CASE WHEN COUNT(rh.id) > 0
        THEN ROUND((AVG(rh.time_taken_ms) FILTER (WHERE rh.time_taken_ms IS NOT NULL) / 1000.0)::numeric, 1)
        ELSE 0
      END AS avg_time_sec
    FROM topics t
    JOIN content_sources cs ON cs.id = t.source_id
    LEFT JOIN cards c ON c.topic_id = t.id
    LEFT JOIN review_history rh ON rh.card_id = c.id
    GROUP BY t.id, t.title, cs.filename
    ORDER BY cs.filename, t.title
  ) row_data;

  -- Daily stats (last 30 days)
  SELECT json_agg(row_data) INTO daily_stats_json FROM (
    SELECT
      reviewed_at::date AS review_date,
      COUNT(*) AS review_count,
      COUNT(*) FILTER (WHERE grade >= 2) AS correct_count
    FROM review_history
    WHERE reviewed_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY reviewed_at::date
    ORDER BY reviewed_at::date
  ) row_data;

  -- Schedule overview
  SELECT json_build_object(
    'due_today', (SELECT COUNT(*) FROM cards WHERE NOT is_suspended AND card_state IN ('review','relearning') AND due_date::date <= CURRENT_DATE),
    'due_this_week', (SELECT COUNT(*) FROM cards WHERE NOT is_suspended AND card_state IN ('review','relearning') AND due_date::date <= CURRENT_DATE + INTERVAL '7 days'),
    'due_this_month', (SELECT COUNT(*) FROM cards WHERE NOT is_suspended AND card_state IN ('review','relearning') AND due_date::date <= CURRENT_DATE + INTERVAL '30 days'),
    'due_later', (SELECT COUNT(*) FROM cards WHERE NOT is_suspended AND card_state IN ('review','relearning') AND due_date::date > CURRENT_DATE + INTERVAL '30 days'),
    'new_cards', (SELECT COUNT(*) FROM cards WHERE NOT is_suspended AND card_state = 'new')
  ) INTO schedule_json;

  SELECT json_build_object(
    'topic_stats', COALESCE(topic_stats_json, '[]'::json),
    'daily_stats', COALESCE(daily_stats_json, '[]'::json),
    'schedule_overview', schedule_json
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;
