// backend/src/config/prisma.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
console.log("DATABASE_URL EM USO:", process.env.DATABASE_URL);


module.exports = prisma;