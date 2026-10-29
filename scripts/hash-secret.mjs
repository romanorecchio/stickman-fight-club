import { randomBytes, scryptSync } from 'node:crypto';

const secret = process.argv[2];
if (!secret) {
  console.error('Usage: node scripts/hash-secret.mjs "your secret"');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(secret, salt, 32).toString('hex');
process.stdout.write(`scrypt$${salt}$${hash}\n`);
