require('dotenv').config();
const { Pool } = require('pg');

async function testNeon() {
    const connStr = process.argv[2] || process.env.DATABASE_URL;

    console.log('=======================================================');
    console.log('⚡ Neon PostgreSQL Connection & Migration Test');
    console.log('=======================================================');

    if (!connStr || connStr.includes('localhost')) {
        console.log('ℹ️ Usage: node test_neon.js "postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require"');
        console.log('   or set DATABASE_URL in your .env file.');
        if (!connStr) {
            process.exit(1);
        }
    }

    console.log('🔌 Connecting to:', connStr.replace(/:[^:@]+@/, ':****@'));

    const pool = new Pool({
        connectionString: connStr,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000
    });

    try {
        const client = await pool.connect();
        console.log('✅ Connection established successfully to Neon!');

        // Query version
        const vRes = await client.query('SELECT version()');
        console.log('🐘 PostgreSQL Version:', vRes.rows[0].version.split(',')[0]);

        // Run schema initialization
        const { initPostgres, getFullDb } = require('./db');
        process.env.DATABASE_URL = connStr;
        console.log('📦 Initializing schema and tables in Neon...');
        const ok = await initPostgres();
        if (ok) {
            console.log('✅ Schema & tables verified in Neon!');
            const dbData = await getFullDb();
            console.log(`👥 Total users in Neon: ${dbData.users.length}`);
            console.log(`🎟️ Total events in Neon: ${dbData.events.length}`);
            console.log(`🎫 Total tickets in Neon: ${dbData.tickets.length}`);
        } else {
            console.log('⚠️ initPostgres returned false.');
        }

        client.release();
        await pool.end();
        console.log('\n🎉 Neon database is ready to be used with Vercel!');
        console.log('=======================================================');
    } catch (err) {
        console.error('❌ Connection failed:', err.message);
        console.log('\n💡 Check that:');
        console.log('  1. The Neon connection string includes "?sslmode=require"');
        console.log('  2. Your Neon database is not suspended (Neon auto-resumes in ~2 seconds)');
        console.log('  3. The username and password in the connection string are correct.');
        process.exit(1);
    }
}

testNeon();
