export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-2">Listing {id}</h1>
      <p className="text-gray-400 text-sm">
        Workspace — implemented in sub-plan 4
      </p>
    </main>
  )
}
