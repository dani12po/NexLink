const map = {
  idle: "bg-zinc-900 border-zinc-800 text-zinc-300",
  pending: "bg-blue-950/40 border-blue-900/40 text-blue-200",
  confirmed: "bg-purple-950/40 border-purple-900/40 text-purple-200",
  verified: "bg-emerald-950/40 border-emerald-900/40 text-emerald-200",
  connected: "bg-emerald-950/40 border-emerald-900/40 text-emerald-200",
  done: "bg-emerald-950/40 border-emerald-900/40 text-emerald-200",
  error: "bg-red-950/40 border-red-900/40 text-red-200",
};

const label = {
  idle: "Idle",
  pending: "Pending",
  confirmed: "Confirmed",
  verified: "Verified",
  connected: "Connected",
  done: "Done",
  error: "Error",
};

export default function StatusPill({ status = "idle" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${map[status] || map.idle}`}>
      {label[status] || status}
    </span>
  );
}
