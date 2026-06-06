
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '../../PayEase/.env.local');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPools() {
    console.log("Checking 'pools' table...");
    const { data: pools, error: poolErr } = await supabase.from('pools').select('*');
    if (poolErr) console.error("Pool Error:", poolErr);
    else {
        console.log("Pools Count:", pools.length);
        console.log("Pools Data:", JSON.stringify(pools, null, 2));
    }
}

checkPools();
