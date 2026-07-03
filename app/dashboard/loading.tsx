export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <div className="h-7 w-40 animate-pulse rounded-lg bg-hairline/60" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-hairline/40" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <div className="h-72 animate-pulse rounded-xl bg-hairline/40 xl:col-span-2" />
        <div className="h-72 animate-pulse rounded-xl bg-hairline/40" />
      </div>
    </div>
  );
}
