export default function StepCard({ step, title, desc }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-semibold">
          {step}
        </div>
        <div className="space-y-1 w-full">
          <div className="font-semibold">{title}</div>
          <div className="text-sm text-zinc-300">{desc}</div>
        </div>
      </div>
    </div>
  );
}
