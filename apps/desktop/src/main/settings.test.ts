import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadServerSetting } from './settings'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'co-write-settings-'))
  file = join(dir, 'settings.json')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('server setting', () => {
  it('starts with no server, or the fallback', async () => {
    expect((await loadServerSetting(file)).origin()).toBeNull()
    expect((await loadServerSetting(file, 'http://localhost:8080/')).origin()).toBe(
      'http://localhost:8080',
    )
    expect((await loadServerSetting(file, 'garbage')).origin()).toBeNull()
  })

  it('keeps the origin of what was chosen, across restarts, ahead of the fallback', async () => {
    const setting = await loadServerSetting(file, 'http://localhost:8080')
    await setting.set('HTTPS://Write.Example.com/some/path')
    expect(setting.origin()).toBe('https://write.example.com')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      serverUrl: 'https://write.example.com',
    })
    expect((await loadServerSetting(file, 'http://localhost:8080')).origin()).toBe(
      'https://write.example.com',
    )
  })

  it('can forget the server, even when a fallback exists', async () => {
    const setting = await loadServerSetting(file)
    await setting.set('http://10.0.0.5:8080')
    await setting.set(null)
    expect(setting.origin()).toBeNull()
    expect((await loadServerSetting(file)).origin()).toBeNull()
  })

  it('refuses addresses that are not http(s)', async () => {
    const setting = await loadServerSetting(file)
    await expect(setting.set('ftp://example.com')).rejects.toThrow('http')
    await expect(setting.set('write.example.com')).rejects.toThrow('http')
    expect(setting.origin()).toBeNull()
  })

  it('survives a damaged settings file', async () => {
    await writeFile(file, '{not json')
    expect((await loadServerSetting(file)).origin()).toBeNull()
    await writeFile(file, JSON.stringify({ serverUrl: 42 }))
    expect((await loadServerSetting(file)).origin()).toBeNull()
  })
})
