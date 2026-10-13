const app = require('../server');
const { initPostgres } = require('../db');

// Lazy-initialize PostgreSQL on serverless cold starts
let initPromise = null;

module.exports = async (req, res) => {
    if (!initPromise) {
        initPromise = initPostgres().catch(err => {
            console.warn('Vercel cold-start PostgreSQL notice:', err.message);
            return false;
        });
    }
    await initPromise;
    return app(req, res);
};
