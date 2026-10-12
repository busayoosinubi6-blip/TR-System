-- ====================================================================
-- MOSHOOD ABIOLA NATIONAL STADIUM TICKETING & ACCESS MANAGEMENT SYSTEM
-- PostgreSQL Database Schema
-- ====================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(64),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) DEFAULT 'member' CHECK (role IN ('member', 'steward', 'admin')),
    wallet_balance NUMERIC(12, 2) DEFAULT 0.00 CHECK (wallet_balance >= 0),
    favorite_gate VARCHAR(128) DEFAULT 'Gate 2 (General Entrance)',
    avatar TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. EVENTS TABLE
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

-- 3. TICKETS TABLE
CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    event_id VARCHAR(64) REFERENCES events(id) ON DELETE CASCADE,
    event_title VARCHAR(255) NOT NULL,
    event_date VARCHAR(64) NOT NULL,
    event_time VARCHAR(64) NOT NULL,
    category VARCHAR(64) NOT NULL,
    gate VARCHAR(128) NOT NULL,
    section VARCHAR(128) NOT NULL,
    seat VARCHAR(64) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    status VARCHAR(32) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'USED', 'CANCELLED', 'TRANSFERRED')),
    qr_data TEXT NOT NULL,
    holder_name VARCHAR(255) NOT NULL,
    transferred_from VARCHAR(255),
    booked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    type VARCHAR(32) NOT NULL CHECK (type IN ('TOPUP', 'BOOKING', 'REFUND', 'TRANSFER')),
    description TEXT NOT NULL,
    reference VARCHAR(128) NOT NULL,
    transaction_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. TURNSTILE ENTRY LOGS TABLE
CREATE TABLE IF NOT EXISTS turnstile_logs (
    id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(64),
    holder_name VARCHAR(255),
    event_title VARCHAR(255),
    gate VARCHAR(128) NOT NULL,
    scan_result VARCHAR(32) NOT NULL CHECK (scan_result IN ('GRANTED', 'DENIED', 'ALREADY_USED', 'INVALID_GATE')),
    reason TEXT,
    scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. ANNOUNCEMENTS TABLE
CREATE TABLE IF NOT EXISTS announcements (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority VARCHAR(32) DEFAULT 'NORMAL',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. SESSIONS TABLE
CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- ====================================================================
-- INDEXES FOR FAST PERFORMANCE
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_turnstile_logs_timestamp ON turnstile_logs(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
