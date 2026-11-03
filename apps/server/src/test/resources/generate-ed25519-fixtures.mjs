// Regenerates ed25519-fixtures.json: a key made by Node's `node:crypto` (what the desktop's main
// process uses) and its signatures over the texts the desktop signs, so the server's verification
// is tested against the other implementation.
//
//   node apps/server/src/test/resources/generate-ed25519-fixtures.mjs
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const origin = 'https://write.example.com'
const nonce = 'dGVzdC1ub25jZS0wMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA'
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const der = publicKey.export({ type: 'spki', format: 'der' })
const signature = (message) => sign(null, Buffer.from(message), privateKey).toString('base64url')
const texts = {
  login: `co-write-login\n${origin}\n${nonce}`,
  register: `co-write-register\n${origin}\n${nonce}\nana`,
}

const fixtures = {
  origin,
  nonce,
  publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  fingerprint: `SHA256:${createHash('sha256').update(der).digest('base64').replace(/=+$/, '')}`,
  messages: Object.entries(texts).map(([purpose, message]) => ({
    purpose,
    message,
    signature: signature(message),
  })),
}

writeFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ed25519-fixtures.json'),
  `${JSON.stringify(fixtures, null, 2)}\n`,
)
