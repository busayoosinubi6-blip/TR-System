require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Determine DB File path (/tmp/db.json in Vercel serverless environments)
const DB_FILE = process.env.VERCEL 
    ? path.join('/tmp', 'db.json')
    : path.join(__dirname, 'data', 'db.json');

const ORIGINAL_SEED_FILE = path.join(__dirname, 'data', 'db.json');

// Build PostgreSQL Pool configuration
let pool = null;
let isPostgresConnected = false;

try {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
        const isRemote = !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1');
        pool = new Pool({
            connectionString,
            ssl: isRemote ? { rejectUnauthorized: false } : false
        });
    } else {
        pool = new Pool({
            host: process.env.PGHOST || 'localhost',
            port: parseInt(process.env.PGPORT || '5432', 10),
            database: process.env.PGDATABASE || 'man_stadium_tms',
            user: process.env.PGUSER || 'postgres',
            password: process.env.PGPASSWORD || 'postgres'
        });
    }
} catch (err) {
    console.warn('⚠️ Could not create PostgreSQL pool instance:', err.message);
}

// Fallback JSON DB Helpers
function readJsonDb() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            let initial = {
                users: [],
                events: [],
                tickets: [],
                transactions: [],
                turnstileLogs: [],
                announcements: [],
                sessions: []
            };

            // Seed from bundled db.json if available
            if (fs.existsSync(ORIGINAL_SEED_FILE)) {
                try {
                    initial = JSON.parse(fs.readFileSync(ORIGINAL_SEED_FILE, 'utf8'));
                } catch (e) {}
            }

            try {
                fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
                fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
            } catch (e) {}
            return initial;
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(data);
        if (!parsed.users) parsed.users = [];
        if (!parsed.events) parsed.events = [];
        if (!parsed.tickets) parsed.tickets = [];
        if (!parsed.transactions) parsed.transactions = [];
        if (!parsed.turnstileLogs) parsed.turnstileLogs = [];
        if (!parsed.announcements) parsed.announcements = [];
        if (!parsed.sessions) parsed.sessions = [];
        return parsed;
    } catch (err) {
        console.error('Error reading JSON DB:', err);
        return { users: [], events: [], tickets: [], transactions: [], turnstileLogs: [], announcements: [], sessions: [] };
    }
}

function writeJsonDb(data) {
    try {
        fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('Error writing JSON DB:', err);
    }
}

// Initialize PostgreSQL Database Schema & Auto-seed
async function initPostgres() {
    if (!pool) return false;
    try {
        const client = await pool.connect();
        try {
            // 1. Create Tables
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id VARCHAR(64) PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    phone VARCHAR(64),
                    password_hash VARCHAR(255) NOT NULL,
                    role VARCHAR(32) DEFAULT 'member',
                    wallet_balance NUMERIC(12, 2) DEFAULT 0.00,
                    favorite_gate VARCHAR(128) DEFAULT 'Gate 2 (General Entrance)',
                    avatar TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS events (
                    id VARCHAR(64) PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    category VARCHAR(64) NOT NULL,
                    event_date VARCHAR(64) NOT NULL,
                    event_time VARCHAR(64) NOT NULL,
                    venue VARCHAR(255) NOT NULL,
                    gates VARCHAR(255) NOT NULL,
                    status VARCHAR(32) DEFAULT 'UPCOMING',
                    image TEXT,
                    price_regular NUMERIC(10, 2) NOT NULL DEFAULT 0,
                    price_covered NUMERIC(10, 2) NOT NULL DEFAULT 0,
                    price_vip NUMERIC(10, 2) NOT NULL DEFAULT 0,
                    capacity INTEGER NOT NULL DEFAULT 60491,
                    available_seats INTEGER NOT NULL DEFAULT 60491,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS tickets (
                    id VARCHAR(64) PRIMARY KEY,
                    user_id VARCHAR(64),
                    event_id VARCHAR(64),
                    event_title VARCHAR(255) NOT NULL,
                    event_date VARCHAR(64) NOT NULL,
                    event_time VARCHAR(64) NOT NULL,
                    category VARCHAR(64) NOT NULL,
                    gate VARCHAR(128) NOT NULL,
                    section VARCHAR(128) NOT NULL,
                    seat VARCHAR(64) NOT NULL,
                    price NUMERIC(10, 2) NOT NULL,
                    status VARCHAR(32) DEFAULT 'ACTIVE',
                    qr_data TEXT NOT NULL,
                    holder_name VARCHAR(255) NOT NULL,
                    transferred_from VARCHAR(255),
                    booked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS transactions (
                    id VARCHAR(64) PRIMARY KEY,
                    user_id VARCHAR(64),
                    amount NUMERIC(12, 2) NOT NULL,
                    type VARCHAR(32) NOT NULL,
                    description TEXT NOT NULL,
                    reference VARCHAR(128) NOT NULL,
                    transaction_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS turnstile_logs (
                    id VARCHAR(64) PRIMARY KEY,
                    ticket_id VARCHAR(64),
                    holder_name VARCHAR(255),
                    event_title VARCHAR(255),
                    gate VARCHAR(128) NOT NULL,
                    scan_result VARCHAR(32) NOT NULL,
                    reason TEXT,
                    scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS announcements (
                    id VARCHAR(64) PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    content TEXT NOT NULL,
                    priority VARCHAR(32) DEFAULT 'NORMAL',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token VARCHAR(128) PRIMARY KEY,
                    user_id VARCHAR(64) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
                );
            `);

            // 2. Check if tables need seeding from db.json
            const userCountRes = await client.query('SELECT COUNT(*) FROM users');
            const userCount = parseInt(userCountRes.rows[0].count, 10);

            if (userCount === 0) {
                console.log('📦 Seeding initial data from db.json into PostgreSQL...');
                const jsonData = readJsonDb();

                // Seed Users
                for (const u of jsonData.users || []) {
                    await client.query(`
                        INSERT INTO users (id, name, email, phone, password_hash, role, wallet_balance, favorite_gate, avatar, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        ON CONFLICT (id) DO NOTHING
                    `, [u.id, u.name, u.email, u.phone || null, u.passwordHash, u.role || 'member', u.walletBalance || 0, u.favoriteGate || 'Gate 2 (General Entrance)', u.avatar || null, u.createdAt || new Date()]);
                }

                // Seed Events
                for (const e of jsonData.events || []) {
                    const reg = e.prices ? e.prices.regular || 3000 : 3000;
                    const cov = e.prices ? e.prices.covered || 7500 : 7500;
                    const vip = e.prices ? e.prices.vip || 20000 : 20000;
                    await client.query(`
                        INSERT INTO events (id, title, category, event_date, event_time, venue, gates, status, image, price_regular, price_covered, price_vip, capacity, available_seats, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                        ON CONFLICT (id) DO NOTHING
                    `, [e.id, e.title, e.category, e.date, e.time, e.venue, e.gates, e.status || 'UPCOMING', e.image, reg, cov, vip, e.capacity || 60491, e.availableSeats || 60491, new Date()]);
                }

                // Seed Tickets
                for (const t of jsonData.tickets || []) {
                    await client.query(`
                        INSERT INTO tickets (id, user_id, event_id, event_title, event_date, event_time, category, gate, section, seat, price, status, qr_data, holder_name, transferred_from, booked_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                        ON CONFLICT (id) DO NOTHING
                    `, [t.id, t.userId, t.eventId, t.eventTitle, t.eventDate, t.eventTime, t.category, t.gate, t.section, t.seat, t.price, t.status || 'ACTIVE', t.qrData || t.id, t.holderName || '', t.transferredFrom || null, t.bookedAt || new Date()]);
                }

                // Seed Transactions
                for (const tx of jsonData.transactions || []) {
                    await client.query(`
                        INSERT INTO transactions (id, user_id, amount, type, description, reference, transaction_date)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (id) DO NOTHING
                    `, [tx.id, tx.userId, tx.amount, tx.type, tx.description, tx.reference || tx.id, tx.date || new Date()]);
                }

                // Seed Turnstile Logs
                for (const l of jsonData.turnstileLogs || []) {
                    await client.query(`
                        INSERT INTO turnstile_logs (id, ticket_id, holder_name, event_title, gate, scan_result, reason, scanned_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (id) DO NOTHING
                    `, [l.id || `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, l.ticketId, l.holderName, l.eventTitle || '', l.gate, l.scanResult, l.reason, l.timestamp || new Date()]);
                }

                // Seed Announcements
                for (const a of jsonData.announcements || []) {
                    await client.query(`
                        INSERT INTO announcements (id, title, content, priority, created_at)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (id) DO NOTHING
                    `, [a.id, a.title, a.content, a.priority || 'NORMAL', a.createdAt || new Date()]);
                }

                console.log('✅ PostgreSQL initial data seeded successfully!');
            }

            isPostgresConnected = true;
            console.log('🐘 PostgreSQL Database Connected & Initialized!');
            return true;
        } finally {
            client.release();
        }
    } catch (err) {
        console.warn('⚠️ PostgreSQL connection failed (' + err.message + '). Using local fallback JSON DB.');
        isPostgresConnected = false;
        return false;
    }
}

// Unified Database Access Layer (PostgreSQL with fallback synchronization)
async function getFullDb() {
    if (isPostgresConnected && pool) {
        try {
            const usersRes = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
            const eventsRes = await pool.query('SELECT * FROM events ORDER BY event_date ASC');
            const ticketsRes = await pool.query('SELECT * FROM tickets ORDER BY booked_at DESC');
            const txRes = await pool.query('SELECT * FROM transactions ORDER BY transaction_date DESC');
            const logsRes = await pool.query('SELECT * FROM turnstile_logs ORDER BY scanned_at DESC');
            const annRes = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
            const sessionsRes = await pool.query('SELECT * FROM sessions');

            const users = usersRes.rows.map(u => ({
                id: u.id,
                name: u.name,
                email: u.email,
                phone: u.phone,
                passwordHash: u.password_hash,
                role: u.role,
                walletBalance: parseFloat(u.wallet_balance || 0),
                favoriteGate: u.favorite_gate,
                avatar: u.avatar,
                createdAt: u.created_at
            }));

            const events = eventsRes.rows.map(e => ({
                id: e.id,
                title: e.title,
                category: e.category,
                date: e.event_date,
                time: e.event_time,
                venue: e.venue,
                gates: e.gates,
                status: e.status,
                image: e.image,
                prices: {
                    regular: parseFloat(e.price_regular || 0),
                    covered: parseFloat(e.price_covered || 0),
                    vip: parseFloat(e.price_vip || 0)
                },
                capacity: parseInt(e.capacity || 0, 10),
                availableSeats: parseInt(e.available_seats || 0, 10),
                createdAt: e.created_at
            }));

            const tickets = ticketsRes.rows.map(t => ({
                id: t.id,
                userId: t.user_id,
                eventId: t.event_id,
                eventTitle: t.event_title,
                eventDate: t.event_date,
                eventTime: t.event_time,
                category: t.category,
                gate: t.gate,
                section: t.section,
                seat: t.seat,
                price: parseFloat(t.price || 0),
                status: t.status,
                qrData: t.qr_data,
                holderName: t.holder_name,
                transferredFrom: t.transferred_from,
                bookedAt: t.booked_at
            }));

            const transactions = txRes.rows.map(tx => ({
                id: tx.id,
                userId: tx.user_id,
                amount: parseFloat(tx.amount || 0),
                type: tx.type,
                description: tx.description,
                reference: tx.reference,
                date: tx.transaction_date
            }));

            const turnstileLogs = logsRes.rows.map(l => ({
                id: l.id,
                ticketId: l.ticket_id,
                holderName: l.holder_name,
                eventTitle: l.event_title,
                gate: l.gate,
                scanResult: l.scan_result,
                reason: l.reason,
                timestamp: l.scanned_at
            }));

            const announcements = annRes.rows.map(a => ({
                id: a.id,
                title: a.title,
                content: a.content,
                priority: a.priority,
                createdAt: a.created_at
            }));

            const sessions = sessionsRes.rows.map(s => ({
                token: s.token,
                userId: s.user_id,
                createdAt: s.created_at,
                expiresAt: s.expires_at
            }));

            const full = { users, events, tickets, transactions, turnstileLogs, announcements, sessions };
            // Keep local JSON in sync as secondary cache
            writeJsonDb(full);
            return full;
        } catch (err) {
            console.error('PostgreSQL read error:', err.message);
        }
    }
    return readJsonDb();
}

async function saveFullDb(data) {
    writeJsonDb(data);
    if (!isPostgresConnected || !pool) return;

    try {
        // Asynchronously persist changes to PostgreSQL
        // Users
        for (const u of data.users || []) {
            await pool.query(`
                INSERT INTO users (id, name, email, phone, password_hash, role, wallet_balance, favorite_gate, avatar, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    phone = EXCLUDED.phone,
                    role = EXCLUDED.role,
                    wallet_balance = EXCLUDED.wallet_balance,
                    favorite_gate = EXCLUDED.favorite_gate,
                    avatar = EXCLUDED.avatar
            `, [u.id, u.name, u.email, u.phone || null, u.passwordHash, u.role || 'member', u.walletBalance || 0, u.favoriteGate || 'Gate 2 (General Entrance)', u.avatar || null, u.createdAt || new Date()]);
        }

        // Events
        for (const e of data.events || []) {
            const reg = e.prices ? e.prices.regular || 0 : 0;
            const cov = e.prices ? e.prices.covered || 0 : 0;
            const vip = e.prices ? e.prices.vip || 0 : 0;
            await pool.query(`
                INSERT INTO events (id, title, category, event_date, event_time, venue, gates, status, image, price_regular, price_covered, price_vip, capacity, available_seats, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    category = EXCLUDED.category,
                    event_date = EXCLUDED.event_date,
                    event_time = EXCLUDED.event_time,
                    venue = EXCLUDED.venue,
                    gates = EXCLUDED.gates,
                    status = EXCLUDED.status,
                    image = EXCLUDED.image,
                    price_regular = EXCLUDED.price_regular,
                    price_covered = EXCLUDED.price_covered,
                    price_vip = EXCLUDED.price_vip,
                    capacity = EXCLUDED.capacity,
                    available_seats = EXCLUDED.available_seats
            `, [e.id, e.title, e.category, e.date, e.time, e.venue, e.gates, e.status || 'UPCOMING', e.image, reg, cov, vip, e.capacity || 60491, e.availableSeats || 60491, e.createdAt || new Date()]);
        }

        // Tickets
        for (const t of data.tickets || []) {
            await pool.query(`
                INSERT INTO tickets (id, user_id, event_id, event_title, event_date, event_time, category, gate, section, seat, price, status, qr_data, holder_name, transferred_from, booked_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (id) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    status = EXCLUDED.status,
                    holder_name = EXCLUDED.holder_name,
                    transferred_from = EXCLUDED.transferred_from
            `, [t.id, t.userId, t.eventId, t.eventTitle, t.eventDate, t.eventTime, t.category, t.gate, t.section, t.seat, t.price, t.status || 'ACTIVE', t.qrData || t.id, t.holderName || '', t.transferredFrom || null, t.bookedAt || new Date()]);
        }

        // Transactions
        for (const tx of data.transactions || []) {
            await pool.query(`
                INSERT INTO transactions (id, user_id, amount, type, description, reference, transaction_date)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO NOTHING
            `, [tx.id, tx.userId, tx.amount, tx.type, tx.description, tx.reference || tx.id, tx.date || new Date()]);
        }

        // Turnstile Logs
        for (const l of data.turnstileLogs || []) {
            await pool.query(`
                INSERT INTO turnstile_logs (id, ticket_id, holder_name, event_title, gate, scan_result, reason, scanned_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO NOTHING
            `, [l.id || `log_${Date.now()}`, l.ticketId, l.holderName, l.eventTitle || '', l.gate, l.scanResult, l.reason, l.timestamp || new Date()]);
        }

        // Sessions
        for (const s of data.sessions || []) {
            await pool.query(`
                INSERT INTO sessions (token, user_id, created_at, expires_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (token) DO UPDATE SET
                    expires_at = EXCLUDED.expires_at
            `, [s.token, s.userId, s.createdAt || new Date(), s.expiresAt]);
        }
    } catch (err) {
        console.error('PostgreSQL save sync error:', err.message);
    }
}

module.exports = {
    pool,
    initPostgres,
    getFullDb,
    saveFullDb,
    readJsonDb,
    writeJsonDb,
    isPostgresConnected: () => isPostgresConnected
};
