const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('man_stadium_secure_secret_key_2026'));

const { initPostgres, getFullDb, saveFullDb, readJsonDb, writeJsonDb, isPostgresConnected } = require('./db');

// Helper for database with PostgreSQL synchronization
function readDb() {
    return readJsonDb();
}

function writeDb(data) {
    return saveFullDb(data);
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Session Management with Persistence
function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const db = readDb();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days
    
    // Purge expired sessions
    db.sessions = db.sessions.filter(s => new Date(s.expiresAt) > new Date());
    db.sessions.push({ token, userId, createdAt: new Date().toISOString(), expiresAt });
    writeDb(db);
    return token;
}

function invalidateSession(token) {
    const db = readDb();
    db.sessions = db.sessions.filter(s => s.token !== token);
    writeDb(db);
}

function getUserByToken(token) {
    if (!token) return null;
    const db = readDb();
    const session = db.sessions.find(s => s.token === token && new Date(s.expiresAt) > new Date());
    if (!session) return null;
    return db.users.find(u => u.id === session.userId) || null;
}

// Authentication Middleware
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.man_token) {
        token = req.cookies.man_token;
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'Authentication required. Please sign in.' });
    }

    const user = getUserByToken(token);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Session expired or invalid. Please sign in again.' });
    }

    req.user = user;
    req.token = token;
    next();
}

// Admin Role Middleware
function adminMiddleware(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied. Administrator privileges required.' });
    }
    next();
}

// Steward or Admin Access Middleware
function stewardMiddleware(req, res, next) {
    if (!req.user || (req.user.role !== 'steward' && req.user.role !== 'admin')) {
        return res.status(403).json({ success: false, message: 'Access denied. Turnstile Steward or Admin credentials required.' });
    }
    next();
}

// ==========================================
// 1. AUTHENTICATION & PROFILE ROUTES
// ==========================================

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Please provide full name, email, and password.' });
        }

        const cleanEmail = email.toLowerCase().trim();
        const db = readDb();

        const existing = db.users.find(u => u.email.toLowerCase() === cleanEmail);
        if (existing) {
            return res.status(400).json({ success: false, message: 'An account with this email already exists. Please sign in.' });
        }

        const initialBalance = 15000;
        const newUserId = 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

        const newUser = {
            id: newUserId,
            name: name.trim(),
            email: cleanEmail,
            phone: phone ? phone.trim() : '+234 800 000 0000',
            passwordHash: hashPassword(password),
            role: 'member',
            walletBalance: initialBalance,
            favoriteGate: 'Gate 2 (General Entrance)',
            avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
            createdAt: new Date().toISOString()
        };

        // Welcome bonus transaction
        const welcomeTxn = {
            id: 'TXN-TOP-' + Math.floor(100000 + Math.random() * 900000),
            userId: newUserId,
            type: 'TOPUP',
            amount: initialBalance,
            description: 'New Stadium Member Welcome Credit Bonus',
            reference: 'WELCOME-BONUS-2026',
            date: new Date().toISOString(),
            status: 'SUCCESS'
        };

        db.users.push(newUser);
        db.transactions.unshift(welcomeTxn);
        const token = createSession(newUser.id);
        await writeDb(db);

        res.cookie('man_token', token, { httpOnly: false, maxAge: 14 * 24 * 60 * 60 * 1000 });

        const { passwordHash, ...safeUser } = newUser;
        return res.status(201).json({
            success: true,
            message: 'Registration successful! Welcome to MAN Stadium Ticketing.',
            token,
            user: safeUser
        });
    } catch (err) {
        console.error('Registration error:', err);
        return res.status(500).json({ success: false, message: 'Server error during registration.' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Please enter both email/phone and password.' });
        }

        const cleanEmail = email.toLowerCase().trim();
        const hash = hashPassword(password);
        const db = readDb();

        const user = db.users.find(u => 
            (u.email.toLowerCase() === cleanEmail || (u.phone && u.phone.trim() === cleanEmail)) && 
            u.passwordHash === hash
        );

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials. Please verify your email and password.' });
        }

        const token = createSession(user.id);
        await writeDb(db);
        res.cookie('man_token', token, { httpOnly: false, maxAge: 14 * 24 * 60 * 60 * 1000 });

        const { passwordHash, ...safeUser } = user;
        return res.json({
            success: true,
            message: `Welcome back, ${user.name}!`,
            token,
            user: safeUser
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.man_token) {
        token = req.cookies.man_token;
    }

    if (token) {
        invalidateSession(token);
    }
    res.clearCookie('man_token');
    return res.json({ success: true, message: 'Signed out successfully.' });
});

// Current user profile + stats
app.get('/api/auth/me', authMiddleware, (req, res) => {
    const db = readDb();
    const userTickets = db.tickets.filter(t => t.userId === req.user.id);
    const activePasses = userTickets.filter(t => t.status === 'ACTIVE');
    const userTransactions = db.transactions.filter(t => t.userId === req.user.id);

    const { passwordHash, ...safeUser } = req.user;
    return res.json({
        success: true,
        user: safeUser,
        stats: {
            totalTickets: userTickets.length,
            activePassesCount: activePasses.length,
            usedPassesCount: userTickets.filter(t => t.status === 'USED').length,
            walletBalance: req.user.walletBalance || 0,
            totalTransactions: userTransactions.length
        }
    });
});

// Update Profile
app.patch('/api/auth/profile', authMiddleware, async (req, res) => {
    try {
        const { name, phone, favoriteGate } = req.body;
        const db = readDb();
        const userIndex = db.users.findIndex(u => u.id === req.user.id);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        if (name && name.trim()) db.users[userIndex].name = name.trim();
        if (phone && phone.trim()) db.users[userIndex].phone = phone.trim();
        if (favoriteGate && favoriteGate.trim()) db.users[userIndex].favoriteGate = favoriteGate.trim();

        await writeDb(db);

        const { passwordHash, ...safeUser } = db.users[userIndex];
        return res.json({
            success: true,
            message: 'Profile updated successfully!',
            user: safeUser
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Could not update profile.' });
    }
});

// Change Password
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Both current and new password are required.' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
        }

        const db = readDb();
        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        if (userIndex === -1) return res.status(404).json({ success: false, message: 'User not found.' });

        if (db.users[userIndex].passwordHash !== hashPassword(currentPassword)) {
            return res.status(400).json({ success: false, message: 'Current password does not match.' });
        }

        db.users[userIndex].passwordHash = hashPassword(newPassword);
        await writeDb(db);

        return res.json({ success: true, message: 'Password updated successfully!' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Error updating password.' });
    }
});

// ==========================================
// 2. WALLET & FINANCIAL TRANSACTIONS
// ==========================================

// Top-up wallet
app.post('/api/user/topup', authMiddleware, async (req, res) => {
    const amount = parseInt(req.body.amount, 10);
    if (!amount || amount < 500) {
        return res.status(400).json({ success: false, message: 'Minimum top up amount is ₦500.' });
    }

    const db = readDb();
    const userIndex = db.users.findIndex(u => u.id === req.user.id);
    if (userIndex === -1) return res.status(404).json({ success: false, message: 'User not found.' });

    db.users[userIndex].walletBalance = (db.users[userIndex].walletBalance || 0) + amount;

    const txnRef = 'REF-TOP-' + Math.floor(1000000 + Math.random() * 9000000);
    const newTxn = {
        id: 'TXN-TOP-' + Math.floor(100000 + Math.random() * 900000),
        userId: req.user.id,
        type: 'TOPUP',
        amount: amount,
        description: `Wallet Top-up via Quick Pay`,
        reference: txnRef,
        date: new Date().toISOString(),
        status: 'SUCCESS'
    };

    db.transactions.unshift(newTxn);
    await writeDb(db);

    return res.json({
        success: true,
        message: `Successfully added ₦${amount.toLocaleString()} to your MAN Stadium Wallet!`,
        newBalance: db.users[userIndex].walletBalance,
        transaction: newTxn
    });
});

// Get user transaction history
app.get('/api/user/transactions', authMiddleware, (req, res) => {
    const db = readDb();
    const userTxns = db.transactions.filter(t => t.userId === req.user.id);
    userTxns.sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.json({ success: true, transactions: userTxns });
});

// ==========================================
// 3. EVENTS & SEATING MATRIX
// ==========================================

// Get all events
app.get('/api/events', (req, res) => {
    const db = readDb();
    return res.json({ success: true, events: db.events || [] });
});

// Get single event
app.get('/api/events/:id', (req, res) => {
    const db = readDb();
    const event = db.events.find(e => e.id === req.params.id);
    if (!event) {
        return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    return res.json({ success: true, event });
});

// Get event seating breakdown & layout
app.get('/api/events/:id/seats', (req, res) => {
    const db = readDb();
    const event = db.events.find(e => e.id === req.params.id);
    if (!event) {
        return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const eventTickets = db.tickets.filter(t => t.eventId === event.id && t.status !== 'CANCELLED');
    const bookedCount = eventTickets.length;

    const seatingTiers = [
        {
            tier: 'vip',
            name: 'VIP Executive Suite & State Box',
            gate: 'Gate 4 (Presidential Lounge)',
            price: event.prices.vip,
            capacity: Math.floor(event.capacity * 0.05),
            booked: eventTickets.filter(t => t.category.includes('VIP')).length,
            perks: ['Complimentary hospitality lounge', 'Priority VIP Gate 4 Fast Track', 'Padded stadium seating', 'Match Programme']
        },
        {
            tier: 'covered',
            name: 'Covered Grandstand (West/East)',
            gate: 'Gate 3 (West Tribune Wing)',
            price: event.prices.covered,
            capacity: Math.floor(event.capacity * 0.25),
            booked: eventTickets.filter(t => t.category.includes('Covered')).length,
            perks: ['Sheltered from sun/rain', 'Direct pitch centerline view', 'Dedicated restrooms', 'Express turnstiles']
        },
        {
            tier: 'regular',
            name: 'Popular Open Terraces',
            gate: 'Gate 1 & Gate 2 (General Entrance)',
            price: event.prices.regular,
            capacity: Math.floor(event.capacity * 0.70),
            booked: eventTickets.filter(t => !t.category.includes('VIP') && !t.category.includes('Covered')).length,
            perks: ['Vibrant fan chants atmosphere', 'Direct concourse access', 'Multiple food kiosks']
        }
    ];

    return res.json({
        success: true,
        eventId: event.id,
        eventTitle: event.title,
        totalCapacity: event.capacity,
        availableSeats: event.availableSeats,
        bookedSeatsCount: bookedCount,
        seatingTiers
    });
});

// ==========================================
// 4. TICKETS / MATCH DAY PASSES
// ==========================================

// Get user's booked tickets
app.get('/api/tickets/my-tickets', authMiddleware, (req, res) => {
    const db = readDb();
    const userTickets = db.tickets.filter(t => t.userId === req.user.id);
    userTickets.sort((a, b) => new Date(b.bookedAt) - new Date(a.bookedAt));
    return res.json({ success: true, tickets: userTickets });
});

// Get single ticket details
app.get('/api/tickets/:id', authMiddleware, (req, res) => {
    const db = readDb();
    const ticket = db.tickets.find(t => t.id === req.params.id);
    if (!ticket) {
        return res.status(404).json({ success: false, message: 'Ticket pass not found.' });
    }
    // Allow owner, admin, or steward to view ticket
    if (ticket.userId !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'steward') {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    return res.json({ success: true, ticket });
});

// Book match day tickets
app.post('/api/tickets/book', authMiddleware, async (req, res) => {
    try {
        const { eventId, category = 'regular', quantity = 1 } = req.body;
        const db = readDb();

        const event = db.events.find(e => e.id === eventId);
        if (!event) {
            return res.status(404).json({ success: false, message: 'Selected event could not be found.' });
        }

        const tier = category.toLowerCase();
        const unitPrice = event.prices[tier] || event.prices.regular || 3000;
        const qty = Math.max(1, Math.min(10, parseInt(quantity, 10) || 1));
        const totalPrice = unitPrice * qty;

        const userIndex = db.users.findIndex(u => u.id === req.user.id);
        const user = db.users[userIndex];

        // Check wallet balance
        if ((user.walletBalance || 0) < totalPrice) {
            return res.status(400).json({
                success: false,
                message: `Insufficient wallet balance (₦${(user.walletBalance || 0).toLocaleString()}). Required: ₦${totalPrice.toLocaleString()}. Please top up your wallet.`
            });
        }

        if (event.availableSeats < qty) {
            return res.status(400).json({
                success: false,
                message: `Sorry, only ${event.availableSeats} seats are currently available for this event.`
            });
        }

        // Deduct from wallet
        db.users[userIndex].walletBalance -= totalPrice;

        // Gate & Section mapping
        let gate = 'Gate 1 (Popular Entrance)';
        let section = 'Block D - East Terrace';
        let categoryName = 'Popular Terrace';

        if (tier === 'vip') {
            gate = 'Gate 4 (VIP Presidential Lounge)';
            section = 'Executive Box 3, Suite A';
            categoryName = 'VIP Executive Suite';
        } else if (tier === 'covered') {
            gate = 'Gate 3 (State Box Wing)';
            section = 'Block C - Covered Grandstand';
            categoryName = 'Covered Grandstand';
        }

        const createdTickets = [];
        for (let i = 0; i < qty; i++) {
            const randomSerial = Math.floor(10000 + Math.random() * 90000);
            const randomRow = Math.floor(1 + Math.random() * 25);
            const randomSeat = Math.floor(1 + Math.random() * 80);
            const ticketId = `TKT-MAN-${randomSerial}`;

            const newTicket = {
                id: ticketId,
                userId: user.id,
                eventId: event.id,
                eventTitle: event.title,
                eventDate: event.date,
                eventTime: event.time,
                category: categoryName,
                gate: gate,
                section: section,
                seat: `Row ${randomRow}, Seat ${randomSeat}`,
                price: unitPrice,
                barcode: '983' + Math.floor(1000000000 + Math.random() * 9000000000),
                qrCodeData: `MAN-STADIUM-PASS:${ticketId}:${user.id}:${event.id}:ROW${randomRow}-SEAT${randomSeat}`,
                status: 'ACTIVE',
                bookedAt: new Date().toISOString(),
                holderName: user.name
            };

            db.tickets.unshift(newTicket);
            createdTickets.push(newTicket);
        }

        // Update event available seats
        const eventIndex = db.events.findIndex(e => e.id === event.id);
        if (eventIndex !== -1) {
            db.events[eventIndex].availableSeats -= qty;
        }

        // Add transaction ledger entry
        const txnId = 'TXN-BKG-' + Math.floor(100000 + Math.random() * 900000);
        db.transactions.unshift({
            id: txnId,
            userId: user.id,
            type: 'BOOKING',
            amount: -totalPrice,
            description: `Match Pass (${qty}) - ${event.title} [${categoryName}]`,
            reference: createdTickets.map(t => t.id).join(', '),
            date: new Date().toISOString(),
            status: 'SUCCESS'
        });

        await writeDb(db);

        return res.status(201).json({
            success: true,
            message: `Booking confirmed! ${qty} Match Day Pass${qty > 1 ? 'es' : ''} issued.`,
            tickets: createdTickets,
            newBalance: db.users[userIndex].walletBalance
        });
    } catch (err) {
        console.error('Booking error:', err);
        return res.status(500).json({ success: false, message: 'Server error processing booking.' });
    }
});

// Cancel a ticket reservation (with refund)
app.post('/api/tickets/:id/cancel', authMiddleware, async (req, res) => {
    try {
        const ticketId = req.params.id;
        const db = readDb();

        const ticketIndex = db.tickets.findIndex(t => t.id === ticketId && (t.userId === req.user.id || req.user.role === 'admin'));
        if (ticketIndex === -1) {
            return res.status(404).json({ success: false, message: 'Ticket not found or does not belong to you.' });
        }

        const ticket = db.tickets[ticketIndex];
        if (ticket.status !== 'ACTIVE') {
            return res.status(400).json({ success: false, message: `Ticket is already marked as ${ticket.status}. Cannot cancel.` });
        }

        ticket.status = 'CANCELLED';
        ticket.cancelledAt = new Date().toISOString();

        // Refund ticket owner's wallet
        const targetUserId = ticket.userId;
        const userIndex = db.users.findIndex(u => u.id === targetUserId);
        if (userIndex !== -1) {
            db.users[userIndex].walletBalance = (db.users[userIndex].walletBalance || 0) + ticket.price;
        }

        // Replenish event seat capacity
        const eventIndex = db.events.findIndex(e => e.id === ticket.eventId);
        if (eventIndex !== -1) {
            db.events[eventIndex].availableSeats += 1;
        }

        // Record refund transaction
        db.transactions.unshift({
            id: 'TXN-REF-' + Math.floor(100000 + Math.random() * 900000),
            userId: targetUserId,
            type: 'REFUND',
            amount: ticket.price,
            description: `Refund for Cancelled Pass (${ticket.id}) - ${ticket.eventTitle}`,
            reference: ticket.id,
            date: new Date().toISOString(),
            status: 'SUCCESS'
        });

        await writeDb(db);

        const currentActiveBalance = userIndex !== -1 ? db.users[userIndex].walletBalance : req.user.walletBalance;

        return res.json({
            success: true,
            message: `Ticket ${ticket.id} cancelled. ₦${ticket.price.toLocaleString()} refunded to your wallet balance.`,
            newBalance: currentActiveBalance
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Could not cancel ticket.' });
    }
});

// Transfer Ticket to another Fan
app.post('/api/tickets/:id/transfer', authMiddleware, async (req, res) => {
    try {
        const ticketId = req.params.id;
        const { recipientEmailOrPhone } = req.body;

        if (!recipientEmailOrPhone) {
            return res.status(400).json({ success: false, message: 'Please provide recipient email or phone number.' });
        }

        const target = recipientEmailOrPhone.toLowerCase().trim();
        const db = readDb();

        const ticketIndex = db.tickets.findIndex(t => t.id === ticketId && t.userId === req.user.id);
        if (ticketIndex === -1) {
            return res.status(404).json({ success: false, message: 'Ticket not found or does not belong to you.' });
        }

        const ticket = db.tickets[ticketIndex];
        if (ticket.status !== 'ACTIVE') {
            return res.status(400).json({ success: false, message: `Ticket is currently ${ticket.status} and cannot be transferred.` });
        }

        // Find recipient user
        const recipient = db.users.find(u => 
            u.email.toLowerCase() === target || 
            (u.phone && u.phone.trim() === target)
        );

        if (!recipient) {
            return res.status(404).json({ success: false, message: 'Recipient is not registered on MAN Stadium TMS. They must create an account first.' });
        }

        if (recipient.id === req.user.id) {
            return res.status(400).json({ success: false, message: 'You cannot transfer a ticket to yourself.' });
        }

        const previousHolder = ticket.holderName || req.user.name;

        // Transfer ownership
        ticket.userId = recipient.id;
        ticket.holderName = recipient.name;
        ticket.transferredFrom = previousHolder;
        ticket.transferredAt = new Date().toISOString();
        ticket.qrCodeData = `MAN-STADIUM-PASS:${ticket.id}:${recipient.id}:${ticket.eventId}:${ticket.seat.replace(/\s+/g, '')}`;

        await writeDb(db);

        return res.json({
            success: true,
            message: `Match pass ${ticket.id} transferred successfully to ${recipient.name} (${recipient.email})!`,
            ticket
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Could not process ticket transfer.' });
    }
});

// ==========================================
// 5. TURNSTILE & GATE ACCESS CONTROL
// ==========================================

// Verify Pass at Turnstile Gate (For Stewards & Automated Scanners)
app.post('/api/turnstile/verify', (req, res) => {
    try {
        const { passCode, gate = 'Gate 3 (West Tribune)', turnstileId = 'TURNSTILE-01' } = req.body;

        if (!passCode) {
            return res.status(400).json({
                success: false,
                status: 'INVALID_CODE',
                message: 'No barcode or QR code data supplied.'
            });
        }

        const db = readDb();
        const code = passCode.trim();

        // Support full QR string, raw ticket ID, or barcode
        let ticket = db.tickets.find(t => 
            t.id.toUpperCase() === code.toUpperCase() ||
            t.qrCodeData === code ||
            (code.startsWith('MAN-STADIUM-PASS:') && code.includes(t.id)) ||
            t.barcode === code
        );

        const logId = 'LOG-TURN-' + Math.floor(1000 + Math.random() * 9000);
        const timestamp = new Date().toISOString();

        if (!ticket) {
            const deniedLog = {
                id: logId,
                ticketId: code.slice(0, 20),
                eventId: 'UNKNOWN',
                eventTitle: 'Unknown Event',
                gate: gate,
                turnstileId: turnstileId,
                holderName: 'Unknown Visitor',
                scanResult: 'DENIED',
                timestamp: timestamp,
                reason: 'Ticket not found in stadium database'
            };
            db.turnstileLogs.unshift(deniedLog);
            writeDb(db);

            return res.status(404).json({
                success: false,
                status: 'NOT_FOUND',
                accessGranted: false,
                message: '❌ ACCESS DENIED: Invalid or counterfeit pass code.'
            });
        }

        // Check if cancelled
        if (ticket.status === 'CANCELLED') {
            const cancelledLog = {
                id: logId,
                ticketId: ticket.id,
                eventId: ticket.eventId,
                eventTitle: ticket.eventTitle,
                gate: gate,
                turnstileId: turnstileId,
                holderName: ticket.holderName,
                scanResult: 'DENIED',
                timestamp: timestamp,
                reason: 'Pass has been cancelled and refunded'
            };
            db.turnstileLogs.unshift(cancelledLog);
            writeDb(db);

            return res.status(403).json({
                success: false,
                status: 'CANCELLED',
                accessGranted: false,
                message: `❌ ACCESS DENIED: Ticket ${ticket.id} was CANCELLED by user.`
            });
        }

        // Check if already used
        if (ticket.status === 'USED') {
            const usedLog = {
                id: logId,
                ticketId: ticket.id,
                eventId: ticket.eventId,
                eventTitle: ticket.eventTitle,
                gate: gate,
                turnstileId: turnstileId,
                holderName: ticket.holderName,
                scanResult: 'ALREADY_USED',
                timestamp: timestamp,
                reason: `Already scanned at ${ticket.scannedGate || 'Gate'} on ${new Date(ticket.scannedAt).toLocaleTimeString()}`
            };
            db.turnstileLogs.unshift(usedLog);
            writeDb(db);

            return res.status(409).json({
                success: false,
                status: 'ALREADY_USED',
                accessGranted: false,
                message: `⚠️ ACCESS DENIED: Pass ${ticket.id} ALREADY USED at ${ticket.scannedGate || 'turnstile'} (${new Date(ticket.scannedAt).toLocaleTimeString()}). Duplicate entry prohibited.`,
                scannedAt: ticket.scannedAt
            });
        }

        // Gate Matching verification
        const gateMatch = ticket.gate.toLowerCase().includes(gate.toLowerCase().split(' ')[0]) || gate.includes('All');
        let gateWarning = null;
        if (!gateMatch) {
            gateWarning = `Note: Pass designated for ${ticket.gate}, scanned at ${gate}. Steward authorization granted.`;
        }

        // Mark ticket as USED
        ticket.status = 'USED';
        ticket.scannedAt = timestamp;
        ticket.scannedGate = gate;
        ticket.turnstileId = turnstileId;

        const grantedLog = {
            id: logId,
            ticketId: ticket.id,
            eventId: ticket.eventId,
            eventTitle: ticket.eventTitle,
            gate: gate,
            turnstileId: turnstileId,
            holderName: ticket.holderName,
            scanResult: 'GRANTED',
            timestamp: timestamp,
            reason: gateWarning || 'Valid ticket verified - Turnstile barrier unlocked'
        };
        db.turnstileLogs.unshift(grantedLog);
        writeDb(db);

        return res.json({
            success: true,
            status: 'GRANTED',
            accessGranted: true,
            message: `🟢 ACCESS GRANTED! Welcome to Moshood Abiola Stadium.`,
            gateWarning,
            ticket: {
                id: ticket.id,
                holderName: ticket.holderName,
                eventTitle: ticket.eventTitle,
                category: ticket.category,
                gate: ticket.gate,
                section: ticket.section,
                seat: ticket.seat
            },
            turnstile: {
                id: turnstileId,
                gate: gate,
                timestamp: timestamp,
                unlockDurationSeconds: 10
            }
        });
    } catch (err) {
        console.error('Turnstile verification error:', err);
        return res.status(500).json({ success: false, message: 'Turnstile controller communication error.' });
    }
});

// Get Turnstile scan logs
app.get('/api/turnstile/logs', (req, res) => {
    const db = readDb();
    const logs = db.turnstileLogs || [];
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return res.json({ 
        success: true, 
        logs: logs.slice(0, 50),
        stats: {
            totalScans: logs.length,
            grantedCount: logs.filter(l => l.scanResult === 'GRANTED').length,
            deniedCount: logs.filter(l => l.scanResult === 'DENIED').length,
            duplicateAttempts: logs.filter(l => l.scanResult === 'ALREADY_USED').length
        }
    });
});

// Stadium Gates list and throughput
app.get('/api/turnstile/gates', (req, res) => {
    const db = readDb();
    const logs = db.turnstileLogs || [];

    const gatesList = [
        { id: 'gate_1', name: 'Gate 1 (Popular Entrance)', type: 'Regular', turnstiles: 8, status: 'OPEN' },
        { id: 'gate_2', name: 'Gate 2 (General North Wing)', type: 'Regular', turnstiles: 8, status: 'OPEN' },
        { id: 'gate_3', name: 'Gate 3 (West Tribune & State Box)', type: 'Covered', turnstiles: 6, status: 'OPEN' },
        { id: 'gate_4', name: 'Gate 4 (VIP Presidential Lounge)', type: 'VIP', turnstiles: 4, status: 'OPEN' },
        { id: 'gate_5', name: 'Gate 5 (South Terrace)', type: 'Regular', turnstiles: 6, status: 'OPEN' },
        { id: 'gate_8', name: 'Gate 8 (Athletics & Track Entrance)', type: 'Track', turnstiles: 4, status: 'OPEN' }
    ];

    const gatesWithStats = gatesList.map(g => {
        const gateScans = logs.filter(l => l.gate && l.gate.toLowerCase().includes(g.id.replace('_', ' ')));
        return {
            ...g,
            passengersEntered: gateScans.filter(l => l.scanResult === 'GRANTED').length
        };
    });

    return res.json({ success: true, gates: gatesWithStats });
});

// ==========================================
// 6. STADIUM ANNOUNCEMENTS & ADVISORIES
// ==========================================

// Get active stadium announcements
app.get('/api/announcements', (req, res) => {
    const db = readDb();
    const activeAnnouncements = (db.announcements || []).filter(a => a.active);
    return res.json({ success: true, announcements: activeAnnouncements });
});

// Create announcement (Admin only)
app.post('/api/admin/announcements', authMiddleware, adminMiddleware, (req, res) => {
    const { title, content, type = 'INFO' } = req.body;
    if (!title || !content) {
        return res.status(400).json({ success: false, message: 'Title and content are required.' });
    }

    const db = readDb();
    const newAnn = {
        id: 'ANN-' + Date.now().toString().slice(-5),
        title: title.trim(),
        content: content.trim(),
        type: type.toUpperCase(),
        date: new Date().toISOString(),
        active: true
    };

    db.announcements.unshift(newAnn);
    writeDb(db);

    return res.status(201).json({ success: true, announcement: newAnn });
});

// ==========================================
// 7. ADMIN / STADIUM MANAGEMENT ROUTES
// ==========================================

// Stadium Operations Overview
app.get('/api/admin/overview', authMiddleware, adminMiddleware, (req, res) => {
    const db = readDb();
    const totalUsers = db.users.length;
    const totalEvents = db.events.length;
    const totalTickets = db.tickets.length;
    const activeTickets = db.tickets.filter(t => t.status === 'ACTIVE').length;
    const usedTickets = db.tickets.filter(t => t.status === 'USED').length;
    const cancelledTickets = db.tickets.filter(t => t.status === 'CANCELLED').length;

    // Total ticket sales revenue
    const totalRevenue = db.tickets
        .filter(t => t.status !== 'CANCELLED')
        .reduce((sum, t) => sum + (t.price || 0), 0);

    return res.json({
        success: true,
        stats: {
            totalUsers,
            totalEvents,
            totalTicketsIssued: totalTickets,
            activeTickets,
            usedTickets,
            cancelledTickets,
            totalRevenue,
            attendanceRate: totalTickets > 0 ? Math.round((usedTickets / (totalTickets - cancelledTickets || 1)) * 100) : 0
        },
        recentLogs: (db.turnstileLogs || []).slice(0, 10),
        eventsSummary: db.events.map(e => ({
            id: e.id,
            title: e.title,
            date: e.date,
            capacity: e.capacity,
            availableSeats: e.availableSeats,
            ticketsSold: db.tickets.filter(t => t.eventId === e.id && t.status !== 'CANCELLED').length
        }))
    });
});

// Get all tickets (Admin)
app.get('/api/admin/tickets', authMiddleware, adminMiddleware, (req, res) => {
    const db = readDb();
    const { status, eventId, search } = req.query;

    let tickets = db.tickets || [];
    if (status) tickets = tickets.filter(t => t.status === status.toUpperCase());
    if (eventId) tickets = tickets.filter(t => t.eventId === eventId);
    if (search) {
        const q = search.toLowerCase();
        tickets = tickets.filter(t => 
            t.id.toLowerCase().includes(q) || 
            t.holderName.toLowerCase().includes(q) ||
            t.eventTitle.toLowerCase().includes(q)
        );
    }

    return res.json({ success: true, count: tickets.length, tickets });
});

// Get all users (Admin)
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
    const db = readDb();
    const users = db.users.map(u => {
        const { passwordHash, ...safe } = u;
        const userTickets = db.tickets.filter(t => t.userId === u.id);
        return {
            ...safe,
            ticketsCount: userTickets.length,
            activePasses: userTickets.filter(t => t.status === 'ACTIVE').length
        };
    });
    return res.json({ success: true, count: users.length, users });
});

// Create new stadium fixture / event (Admin)
app.post('/api/admin/events', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { title, category, date, time, venue, gates, image, prices, capacity } = req.body;

        if (!title || !date || !time) {
            return res.status(400).json({ success: false, message: 'Event title, date, and time are required.' });
        }

        const db = readDb();
        const cap = parseInt(capacity, 10) || 60491;

        const newEvent = {
            id: 'ev_' + Date.now().toString().slice(-6),
            title: title.trim(),
            category: category ? category.trim() : 'Sports Fixture',
            date: date.trim(),
            time: time.trim(),
            venue: venue ? venue.trim() : 'Moshood Abiola National Stadium, Abuja',
            gates: gates ? gates.trim() : 'Gate 1, 2, 3 & 4',
            status: 'UPCOMING',
            image: image ? image.trim() : 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1200&q=80',
            prices: {
                regular: prices && prices.regular ? parseInt(prices.regular, 10) : 3000,
                covered: prices && prices.covered ? parseInt(prices.covered, 10) : 7500,
                vip: prices && prices.vip ? parseInt(prices.vip, 10) : 20000
            },
            capacity: cap,
            availableSeats: cap
        };

        db.events.unshift(newEvent);
        writeDb(db);

        return res.status(201).json({
            success: true,
            message: `Event "${newEvent.title}" published successfully!`,
            event: newEvent
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Could not create event.' });
    }
});

// Update event (Admin)
app.put('/api/admin/events/:id', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const db = readDb();
        const index = db.events.findIndex(e => e.id === req.params.id);
        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Event not found.' });
        }

        const { title, category, date, time, venue, gates, image, prices, status } = req.body;
        if (title) db.events[index].title = title.trim();
        if (category) db.events[index].category = category.trim();
        if (date) db.events[index].date = date.trim();
        if (time) db.events[index].time = time.trim();
        if (venue) db.events[index].venue = venue.trim();
        if (gates) db.events[index].gates = gates.trim();
        if (image) db.events[index].image = image.trim();
        if (status) db.events[index].status = status.trim();
        if (prices) {
            if (prices.regular) db.events[index].prices.regular = parseInt(prices.regular, 10);
            if (prices.covered) db.events[index].prices.covered = parseInt(prices.covered, 10);
            if (prices.vip) db.events[index].prices.vip = parseInt(prices.vip, 10);
        }

        writeDb(db);
        return res.json({ success: true, message: 'Event updated successfully.', event: db.events[index] });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Error updating event.' });
    }
});

// Delete / Cancel Event (Admin)
app.delete('/api/admin/events/:id', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const db = readDb();
        const eventId = req.params.id;
        const event = db.events.find(e => e.id === eventId);
        if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

        // Auto refund active tickets for this event
        const activeTicketsForEvent = db.tickets.filter(t => t.eventId === eventId && t.status === 'ACTIVE');
        for (const tkt of activeTicketsForEvent) {
            tkt.status = 'CANCELLED';
            tkt.cancelledAt = new Date().toISOString();
            const userIndex = db.users.findIndex(u => u.id === tkt.userId);
            if (userIndex !== -1) {
                db.users[userIndex].walletBalance = (db.users[userIndex].walletBalance || 0) + tkt.price;
            }
            db.transactions.unshift({
                id: 'TXN-REF-' + Math.floor(100000 + Math.random() * 900000),
                userId: tkt.userId,
                type: 'REFUND',
                amount: tkt.price,
                description: `Event Cancelled Refund (${event.title})`,
                reference: tkt.id,
                date: new Date().toISOString(),
                status: 'SUCCESS'
            });
        }

        db.events = db.events.filter(e => e.id !== eventId);
        writeDb(db);

        return res.json({
            success: true,
            message: `Event "${event.title}" cancelled. ${activeTicketsForEvent.length} active ticket(s) automatically refunded.`
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Could not delete event.' });
    }
});

// ==========================================
// 8. STATIC FILES & FALLBACKS
// ==========================================

// Serve static frontend files
app.use(express.static(__dirname));

// Load pre-bundled HTML templates for ultra-fast, 100% reliable serving in serverless environments
let htmlPages = {};
try {
    htmlPages = require('./html_pages');
} catch (e) {
    console.warn('html_pages not loaded, using fallback');
}

// Resilient file server helper for local and Vercel serverless environments
function sendHtmlFile(res, pageKey, filename) {
    if (htmlPages && htmlPages[pageKey]) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(htmlPages[pageKey]);
    }
    const primaryPath = path.join(__dirname, filename);
    if (fs.existsSync(primaryPath)) {
        return res.sendFile(primaryPath);
    }
    const altPath = path.join(process.cwd(), filename);
    if (fs.existsSync(altPath)) {
        return res.sendFile(altPath);
    }
    const apiParentPath = path.join(__dirname, '..', filename);
    if (fs.existsSync(apiParentPath)) {
        return res.sendFile(apiParentPath);
    }
    return res.status(404).send(`File ${filename} not found`);
}

// HTML Page Routes (supports both clean URLs and .html extensions)
app.get(['/', '/index', '/index.html'], (req, res) => {
    sendHtmlFile(res, 'index', 'index.html');
});

app.get(['/login', '/login.html'], (req, res) => {
    sendHtmlFile(res, 'login', 'login.html');
});

app.get(['/signup', '/signup.html'], (req, res) => {
    sendHtmlFile(res, 'signup', 'signup.html');
});

app.get(['/dashboard', '/dashboard.html'], (req, res) => {
    sendHtmlFile(res, 'dashboard', 'dashboard.html');
});

// Catch-all route: returns index.html for unknown frontend routes, 404 JSON for unknown API routes
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, message: `Endpoint ${req.method} ${req.path} not found` });
    }
    sendHtmlFile(res, 'index', 'index.html');
});

// Start Server (only when run directly in Node.js)
if (require.main === module) {
    app.listen(PORT, async () => {
        console.log(`=======================================================`);
        console.log(`🏟️  MAN Stadium Ticketing & Management System (TMS)`);
        console.log(`🌐 Server running at: http://localhost:${PORT}`);
        console.log(`⚡ API Routes ready: Auth, Tickets, Turnstiles, Admin`);
        
        // Connect and initialize PostgreSQL
        const pgSuccess = await initPostgres();
        if (pgSuccess) {
            console.log(`🐘 Database: PostgreSQL ACTIVE & SYNCHRONIZED`);
        } else {
            console.log(`📁 Database: Local Storage Ready (PostgreSQL configured via .env)`);
        }
        console.log(`=======================================================`);
    });
}

module.exports = app;
