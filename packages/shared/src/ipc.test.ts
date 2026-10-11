import { describe, expect, it } from 'vitest'
import {
  CredentialsSchema,
  DocRefSchema,
  DocStateSchema,
  MenuCommandSchema,
  RelativePathSchema,
} from './ipc'

describe('IPC payload schemas', () => {
  it('accepts ordinary relative paths and rejects empty or NUL-bearing ones', () => {
    expect(RelativePathSchema.safeParse('notes/today.md').success).toBe(true)
    expect(RelativePathSchema.safeParse('').success).toBe(false)
    expect(RelativePathSchema.safeParse('a\0b.md').success).toBe(false)
    expect(RelativePathSchema.safeParse(42).success).toBe(false)
  })

  it('accepts exactly the two doc ref shapes', () => {
    expect(DocRefSchema.safeParse({ kind: 'local', path: 'a.md' }).success).toBe(true)
    expect(DocRefSchema.safeParse({ kind: 'remote', docId: 'abc_123-X' }).success).toBe(true)
    expect(DocRefSchema.safeParse({ kind: 'remote', docId: '../etc/passwd' }).success).toBe(false)
    expect(DocRefSchema.safeParse({ kind: 'local', path: 'a.md', extra: 1 }).success).toBe(false)
    expect(DocRefSchema.safeParse({ kind: 'other' }).success).toBe(false)
  })

  it('only takes binary doc state', () => {
    expect(DocStateSchema.safeParse(new Uint8Array([1, 2])).success).toBe(true)
    expect(DocStateSchema.safeParse([1, 2]).success).toBe(false)
    expect(DocStateSchema.safeParse('AQI=').success).toBe(false)
  })

  it('validates credentials strictly', () => {
    expect(CredentialsSchema.safeParse({ username: 'ana', token: 't' }).success).toBe(true)
    expect(CredentialsSchema.safeParse({ username: '', token: 't' }).success).toBe(false)
    expect(CredentialsSchema.safeParse({ username: 'ana', token: 't', admin: true }).success).toBe(
      false,
    )
  })

  it('knows the menu commands', () => {
    expect(MenuCommandSchema.safeParse('toggle-files').success).toBe(true)
    expect(MenuCommandSchema.safeParse('rm -rf').success).toBe(false)
  })
})
