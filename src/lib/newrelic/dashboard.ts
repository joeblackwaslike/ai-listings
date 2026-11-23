export interface Layout {
  column: number
  row: number
  width: number
  height: number
}

export interface WidgetFile {
  title: string
  visualization: string
  layout: Layout
  nrql: string
}

export interface DashboardFile {
  name: string
  pages: { name: string; widgets: WidgetFile[] }[]
}

interface ApiWidget {
  title: string
  layout: Layout
  visualization: { id: string }
  rawConfiguration: { nrqlQueries?: { accountIds?: number[]; query: string }[] }
}

interface ApiDashboard {
  name: string
  permissions?: string
  pages: { name: string; widgets: ApiWidget[] }[]
}

export function dashboardInput(file: DashboardFile, accountId: number) {
  return {
    name: file.name,
    permissions: 'PRIVATE',
    pages: file.pages.map((page) => ({
      name: page.name,
      widgets: page.widgets.map((widget) => ({
        title: widget.title,
        layout: widget.layout,
        visualization: { id: widget.visualization },
        rawConfiguration: { nrqlQueries: [{ accountIds: [accountId], query: widget.nrql }] },
      })),
    })),
  }
}

function widgetSpec(widget: ApiWidget) {
  const { column, row, width, height } = widget.layout
  return {
    title: widget.title,
    visualization: widget.visualization.id,
    layout: { column, row, width, height },
    queries: (widget.rawConfiguration.nrqlQueries ?? []).map((q) => ({ accountIds: q.accountIds ?? [], query: q.query })),
  }
}

export function dashboardSpec(dashboard: ApiDashboard) {
  return {
    name: dashboard.name,
    permissions: dashboard.permissions,
    pages: dashboard.pages.map((page) => ({
      name: page.name,
      widgets: page.widgets
        .map(widgetSpec)
        .sort((a, b) => a.layout.row - b.layout.row || a.layout.column - b.layout.column || a.title.localeCompare(b.title)),
    })),
  }
}
