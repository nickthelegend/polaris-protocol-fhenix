-- Create table to track cross-chain liquidity bridging
CREATE TABLE IF NOT EXISTS bridge_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    amount TEXT NOT NULL,
    source_chain_id BIGINT NOT NULL,
    source_tx_hash TEXT UNIQUE NOT NULL,
    usc_query_id TEXT,
    status TEXT DEFAULT 'DETECTED', -- DETECTED, SUBMITTED, VERIFIED, COMPLETED, FAILED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Realtime for this table
-- Use this if your version of Supabase / PG doesn't have the publication yet
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE bridge_transactions;
