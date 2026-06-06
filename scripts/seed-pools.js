
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

const INITIAL_POOLS = [
    {
        name: 'USDC_VAULT',
        token_address: '0xA715e84556b03aBdaC42aa421b5D6081A5434a2F',
        chain_id: 11155111, // Sepolia
        physical_balance: '0',
        lp_balance: '0',
        apr: 0.05
    },
    {
        name: 'USDT_VAULT',
        token_address: '0x87A0E38fF8e63AE90ea95bbd61Ce9c6EC75422d0',
        chain_id: 11155111, // Sepolia
        physical_balance: '0',
        lp_balance: '0',
        apr: 0.04
    }
];

async function seedPools() {
    console.log("Seeding pools table...");
    const { data, error } = await supabase.from('pools').upsert(INITIAL_POOLS, { onConflict: 'name' });
    if (error) console.error("Seed Error:", error);
    else console.log("Pools seeded successfully!");
}

seedPools();
