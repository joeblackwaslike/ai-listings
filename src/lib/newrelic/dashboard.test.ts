// @ts-expect-error bun:test has no type declarations installed (@types/bun absent)
import { describe, expect, test } from 'bun:test'
import { dashboardInput, dashboardSpec, type DashboardFile } from './dashboard'

const file: DashboardFile = {
  name: 'd',
  pages: [
    {
      name: 'p',
      widgets: [
        { title: 'b', visualization: 'viz.line', layout: { column: 5, row: 1, width: 4, height: 3 }, nrql: 'SELECT 2' },
        { title: 'a', visualization: 'viz.billboard', layout: { column: 1, row: 1, width: 4, height: 3 }, nrql: 'SELECT 1' },
      ],
    },
  ],
}

const entity = {
  name: 'd',
  guid: 'g',
  permissions: 'PRIVATE',
  pages: [
    {
      guid: 'pg',
      name: 'p',
      widgets: [
        {
          id: '1',
          title: 'a',
          layout: { column: 1, row: 1, width: 4, height: 3 },
          visualization: { id: 'viz.billboard' },
          rawConfiguration: { nrqlQueries: [{ accountIds: [42], query: 'SELECT 1' }], legend: { enabled: true } },
        },
        {
          id: '2',
          title: 'b',
          layout: { column: 5, row: 1, width: 4, height: 3 },
          visualization: { id: 'viz.line' },
          rawConfiguration: { nrqlQueries: [{ accountIds: [42], query: 'SELECT 2' }] },
        },
      ],
    },
  ],
}

describe('dashboardInput', () => {
  test('builds a private dashboard with the account id on every query', () => {
    const input = dashboardInput(file, 42)
    expect(input.permissions).toBe('PRIVATE')
    expect(input.pages[0].widgets[0]).toEqual({
      title: 'b',
      layout: { column: 5, row: 1, width: 4, height: 3 },
      visualization: { id: 'viz.line' },
      rawConfiguration: { nrqlQueries: [{ accountIds: [42], query: 'SELECT 2' }] },
    })
  })
})

describe('dashboardSpec', () => {
  test('reads the same spec from a built input and from an API entity with extra fields', () => {
    expect(dashboardSpec(entity)).toEqual(dashboardSpec(dashboardInput(file, 42)))
  })

  test('orders widgets by row then column', () => {
    const titles = dashboardSpec(dashboardInput(file, 42)).pages[0].widgets.map((w) => w.title)
    expect(titles).toEqual(['a', 'b'])
  })

  test('differs when a widget points at another account', () => {
    const moved = structuredClone(entity)
    moved.pages[0].widgets[0].rawConfiguration.nrqlQueries[0].accountIds = [7]
    expect(dashboardSpec(moved)).not.toEqual(dashboardSpec(dashboardInput(file, 42)))
  })

  test('differs when a query changes', () => {
    const changed = structuredClone(entity)
    changed.pages[0].widgets[0].rawConfiguration.nrqlQueries[0].query = 'SELECT 9'
    expect(dashboardSpec(changed)).not.toEqual(dashboardSpec(dashboardInput(file, 42)))
  })
})
