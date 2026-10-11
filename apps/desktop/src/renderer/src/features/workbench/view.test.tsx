// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toggle = vi.hoisted(() => vi.fn())
vi.mock('./intent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  workbenchIntents: { toggle },
}))

import { useWorkbench } from './model'
import { ColumnToggles } from './view'

const show = (files: boolean, source: boolean, preview: boolean) => {
  useWorkbench.setState(useWorkbench.getInitialState(), true)
  useWorkbench.getState().go({ tag: 'ready', columns: { files, source, preview }, dialog: null })
}

beforeEach(() => toggle.mockClear())
afterEach(cleanup)

describe('ColumnToggles', () => {
  it('shows which columns are visible', () => {
    show(true, false, true)
    render(<ColumnToggles />)
    expect(screen.getByRole('button', { name: 'Toggle Files' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: 'Toggle Source' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(
      screen.getByRole('button', { name: 'Toggle Preview' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('turns clicks into toggle intents', () => {
    show(true, true, true)
    render(<ColumnToggles />)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Preview' }))
    expect(toggle).toHaveBeenCalledWith('preview')
  })

  it('marks the last content column as locked', () => {
    show(true, true, false)
    render(<ColumnToggles />)
    expect(
      screen.getByRole('button', { name: 'Toggle Source' }).getAttribute('aria-disabled'),
    ).toBe('true')
    expect(screen.getByRole('button', { name: 'Toggle Files' }).getAttribute('aria-disabled')).toBe(
      'false',
    )
  })
})
