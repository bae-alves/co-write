import { describe, expect, it } from 'vitest'
import fixtureFile from '../../../apps/server/src/test/resources/ed25519-fixtures.json'
import { normalizeOrigin, signedMessage } from './signing'

const fixtures = fixtureFile as {
  origin: string
  nonce: string
  messages: { purpose: 'login' | 'register'; message: string }[]
}

describe('signedMessage', () => {
  it('builds the texts the server verifies', () => {
    const { origin, nonce } = fixtures
    const byPurpose = Object.fromEntries(fixtures.messages.map((m) => [m.purpose, m.message]))
    expect(signedMessage({ purpose: 'login', origin, nonce })).toBe(byPurpose['login'])
    expect(signedMessage({ purpose: 'register', origin, nonce, username: 'ana' })).toBe(
      byPurpose['register'],
    )
  })
})

describe('normalizeOrigin', () => {
  it('matches the server: lower-case, no path, default port dropped', () => {
    expect(normalizeOrigin('HTTPS://Write.Example.com/')).toBe('https://write.example.com')
    expect(normalizeOrigin('https://write.example.com:443/x?y=1')).toBe('https://write.example.com')
    expect(normalizeOrigin(' http://localhost:8080 ')).toBe('http://localhost:8080')
    expect(normalizeOrigin('http://localhost:80')).toBe('http://localhost')
  })

  it('refuses what is not an http(s) address', () => {
    expect(normalizeOrigin('ftp://example.com')).toBeNull()
    expect(normalizeOrigin('write.example.com')).toBeNull()
    expect(normalizeOrigin('')).toBeNull()
  })
})
