import { describe, expect, it } from 'vitest'
import { createDfaModel, IllegalTransitionError } from './dfa'

type Light =
  | { readonly tag: 'red' }
  | { readonly tag: 'green'; readonly since: number }
  | { readonly tag: 'yellow' }

const makeLight = () =>
  createDfaModel<Light>({ tag: 'red' }, { red: ['green'], green: ['yellow'], yellow: ['red'] })

describe('createDfaModel', () => {
  it('starts in the initial state', () => {
    expect(makeLight().getState().state).toEqual({ tag: 'red' })
  })

  it('follows legal edges and replaces the state object', () => {
    const light = makeLight()
    const before = light.getState().state
    light.getState().go({ tag: 'green', since: 1 })
    const after = light.getState().state
    expect(after).toEqual({ tag: 'green', since: 1 })
    expect(after).not.toBe(before)
    expect(before).toEqual({ tag: 'red' })
  })

  it('rejects illegal edges and keeps the current state', () => {
    const light = makeLight()
    expect(() => light.getState().go({ tag: 'yellow' })).toThrow(IllegalTransitionError)
    expect(light.getState().state).toEqual({ tag: 'red' })
  })

  it('reports which transitions are available', () => {
    const light = makeLight()
    expect(light.getState().can('green')).toBe(true)
    expect(light.getState().can('yellow')).toBe(false)
  })

  it('freezes states so views cannot mutate them', () => {
    const light = makeLight()
    light.getState().go({ tag: 'green', since: 1 })
    expect(Object.isFrozen(light.getState().state)).toBe(true)
  })
})
