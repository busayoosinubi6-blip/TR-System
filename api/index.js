const app = require('../server');
const { initPostgres } = require('../db');

// Lazy-initialize PostgreSQL on serverless cold starts
let initStarted = false;

module.exports = async (req, res) => {
    if (!initStarted) {
        initStarted = true;
        initPostgres().catch(err => {
            console.warn('Vercel cold-start PostgreSQL notice:', err.message);
        });
    }
    return app(req, res);
};
