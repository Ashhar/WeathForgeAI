-- AI Features: chat history, cached insights, digest
-- Depends on: 0001_init.sql (auth.users, RLS patterns)

-- Chat message history
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_user_time ON chat_messages(user_id, created_at DESC);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own chats" ON chat_messages FOR ALL USING (user_id = auth.uid());

-- Cached AI-generated insights
CREATE TABLE IF NOT EXISTS cached_insights (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  insights JSONB NOT NULL DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT now(),
  portfolio_hash TEXT
);

ALTER TABLE cached_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own insights" ON cached_insights FOR ALL USING (user_id = auth.uid());

-- Monthly digests
CREATE TABLE IF NOT EXISTS monthly_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  period TEXT NOT NULL, -- 'YYYY-MM' format
  content JSONB NOT NULL DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, period)
);

CREATE INDEX IF NOT EXISTS idx_digest_user_period ON monthly_digests(user_id, period DESC);
ALTER TABLE monthly_digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own digests" ON monthly_digests FOR ALL USING (user_id = auth.uid());

-- User tax profile (income bracket, regime choice)
CREATE TABLE IF NOT EXISTS user_tax_profile (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  income_bracket TEXT DEFAULT '0-5L',
  tax_regime TEXT DEFAULT 'new' CHECK (tax_regime IN ('old', 'new')),
  additional_80c NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_tax_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own tax profile" ON user_tax_profile FOR ALL USING (user_id = auth.uid());
