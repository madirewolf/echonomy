const serverless = require('serverless-http');

process.env.ECHONOMY_SERVERLESS = 'true';
const app = require('../../server');

exports.handler = serverless(app);
