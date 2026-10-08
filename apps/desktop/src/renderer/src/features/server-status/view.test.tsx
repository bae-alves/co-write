// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const checkServer = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./intent', () => ({ serverStatusIntents: { checkServer } }))

import { useServerStatus } from './model'
import { ServerStatusView } from './view'

beforeEach(() => {
  useServerStatus.setState(useServerStatus.getInitialState(), true)
  checkServer.mockClear()
})
afterEach(cleanup)

describe('ServerStatusView', () => {
  it('asks for a check when it appears', () => {
    render(<ServerStatusView />)
    expect(checkServer).toHaveBeenCalledTimes(1)
  })

  it('renders whatever state the model holds', () => {
    useServerStatus.getState().go({ tag: 'checking' })
    useServerStatus.getState().go({ tag: 'online', version: '1.0.0', checkedAt: 1 })
    render(<ServerStatusView />)
    expect(screen.getByRole('status').textContent).toBe('Server online (v1.0.0)')
  })

  it('turns a click into an intent', () => {
    render(<ServerStatusView />)
    checkServer.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Check server' }))
    expect(checkServer).toHaveBeenCalledTimes(1)
  })

  it('disables the button while checking', () => {
    useServerStatus.getState().go({ tag: 'checking' })
    render(<ServerStatusView />)
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
