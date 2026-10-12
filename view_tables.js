require('dotenv').config();
const { pool } = require('./db');

async function inspectDatabase() {
    console.log('=======================================================');
    console.log('🐘 PostgreSQL Database Table Inspector');
    console.log('=======================================================');

    if (!pool) {
        console.error('❌ No database pool configured in db.js.');
        process.exit(1);
    }

    try {
        const client = await pool.connect();
        console.log('✅ Connected successfully to PostgreSQL!\n');

        // Query all tables in public schema
        const tablesRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);

        if (tablesRes.rows.length === 0) {
            console.log('⚠️ No tables found in the public schema of this database.');
            console.log('💡 Run `node server.js` to automatically create and seed all tables from schema.sql.');
        } else {
            console.log(`📋 Found ${tablesRes.rows.length} Table(s):\n`);

            for (const row of tablesRes.rows) {
                const tableName = row.table_name;
                const countRes = await client.query(`SELECT COUNT(*) FROM "${tableName}"`);
                const count = countRes.rows[0].count;

                console.log(`  🔹 Table: \x1b[36m${tableName.padEnd(20)}\x1b[0m | Rows: \x1b[32m${count}\x1b[0m`);
            }

            console.log('\n-------------------------------------------------------');
            console.log('🔍 Quick Preview (Latest 3 Users & Events):');
            console.log('-------------------------------------------------------');

            try {
                const sampleUsers = await client.query('SELECT id, name, email, role, wallet_balance FROM users LIMIT 3');
                console.log('\n👥 Users:');
                console.table(sampleUsers.rows);
            } catch (e) {}

            try {
                const sampleEvents = await client.query('SELECT id, title, event_date, price_regular, available_seats FROM events LIMIT 3');
                console.log('\n🎟️ Events:');
                console.table(sampleEvents.rows);
            } catch (e) {}
        }

        client.release();
        await pool.end();
        console.log('\n=======================================================');
    } catch (err) {
        console.error('❌ Could not connect to PostgreSQL:', err.message);
        console.log('\n💡 Tip: Make sure your PostgreSQL server is running and check your credentials in .env:');
        console.log(`   Host: ${process.env.PGHOST || 'localhost'}`);
        console.log(`   Port: ${process.env.PGPORT || '5432'}`);
        console.log(`   Database: ${process.env.PGDATABASE || 'man_stadium_tms'}`);
        console.log(`   User: ${process.env.PGUSER || 'postgres'}`);
    }
}

inspectDatabase();
