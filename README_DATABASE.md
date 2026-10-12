# 🐘 PostgreSQL Database Setup for MAN Stadium TMS

This project supports storing all stadium ticketing, access control, and user data in **PostgreSQL**.

---

## 🚀 Quick Setup Instructions

### 1. Configure Connection Details
Open [`.env`](file:///c:/Users/HomePC/Desktop/Busay]o2/muse%20TMS/.env) in the project root and enter your PostgreSQL credentials:

```env
# Full connection string (Recommended for Neon, Supabase, Render, Railway, etc.)
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/man_stadium_tms

# Or individual parameters:
PGHOST=localhost
PGPORT=5432
PGDATABASE=man_stadium_tms
PGUSER=postgres
PGPASSWORD=your_password
```

---

### 2. Automatic Table Creation & Migration
The server will automatically:
1. Connect to PostgreSQL upon startup.
2. Execute the schema tables from [`schema.sql`](file:///c:/Users/HomePC/Desktop/Busay]o2/muse%20TMS/schema.sql) (`users`, `events`, `tickets`, `transactions`, `turnstile_logs`, `announcements`, `sessions`).
3. Auto-seed your existing demo accounts, events, and tickets from `data/db.json` if the tables are empty.

---

### 3. Manual SQL Execution (Optional)
If you prefer to create tables manually in **pgAdmin**, **DBeaver**, or the `psql` command line:

```bash
# Create database
createdb -U postgres man_stadium_tms

# Run schema
psql -U postgres -d man_stadium_tms -f schema.sql
```

---

### 🗄️ Database Tables Overview
| Table Name | Description |
| :--- | :--- |
| `users` | Fans, Stewards, and Admin accounts with hashed passwords and roles |
| `events` | Match fixtures, concerts, categories, seating capacities, and tier pricing |
| `tickets` | Digital barcode passes, assigned gates, sections, and seats |
| `transactions` | Wallet debits, credits, deposits, ticket purchases, and refund logs |
| `turnstile_logs` | Real-time gate scanner verification logs, granted entries, and denied attempts |
| `announcements` | Stadium match day broadcasts and security alerts |
| `sessions` | Active user authentication session tokens |
