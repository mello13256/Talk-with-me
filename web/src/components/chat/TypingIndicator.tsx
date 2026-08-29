export function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="flex animate-rise items-center gap-2 px-4 pb-2 pt-1">
      <span className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-line bg-bubble-in px-3 py-2.5 shadow-card">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-subtle"
            style={{ animationDelay: `${index * 140}ms`, animationDuration: '1s' }}
          />
        ))}
      </span>
      <span className="text-[12px] text-ink-subtle">{name} está digitando…</span>
    </div>
  );
}
