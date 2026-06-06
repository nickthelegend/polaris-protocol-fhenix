
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Path to .env.local
const envPath = path.join(__dirname, '../../PayEase/.env.local');
console.log("Loading env from:", envPath);

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    // Try current dir if script is run differently
    dotenv.config();
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase env vars. URL:", !!supabaseUrl, "Key:", !!supabaseKey);
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log("Checking 'pools' table...");
    const { data: pool, error: poolErr } = await supabase.from('pools').select('*').limit(1);
    if (poolErr) console.error("Pool Error:", poolErr);
    else console.log("Pool Sample:", JSON.stringify(pool, null, 2));

    console.log("\nChecking 'deposits' table...");
    const { data: deposit, error: depErr } = await supabase.from('deposits').select('*').limit(1);
    if (depErr) console.error("Deposit Error:", depErr);
    else console.log("Deposit Sample:", JSON.stringify(deposit, null, 2));
}

checkSchema();
