/** Asana-style dashed placeholder used by empty assignee/due cells. */
export default function EmptyCellIcon({ kind }: { kind: "assignee" | "due" }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="11"
        fill="none"
        stroke="var(--atlas-text-muted)"
        strokeWidth="2"
        strokeDasharray="4 2"
      />
      <g transform="translate(6 6) scale(0.5)" fill="var(--atlas-text-muted)">
        {kind === "assignee" ? (
          <path d="M12,14c-3.859,0-7-3.14-7-7S8.141,0,12,0s7,3.14,7,7-3.141,7-7,7Zm0-12c-2.757,0-5,2.243-5,5s2.243,5,5,5,5-2.243,5-5-2.243-5-5-5Zm10,21v-2c0-2.757-2.243-5-5-5H7c-2.757,0-5,2.243-5,5v2c0,.552,.447,1,1,1s1-.448,1-1v-2c0-1.654,1.346-3,3-3h10c1.654,0,3,1.346,3,3v2c0,.552,.447,1,1,1s1-.448,1-1Z" />
        ) : (
          <path d="M19.1,2H18V1c0-0.6-0.4-1-1-1s-1,0.4-1,1v1H8V1c0-0.6-0.4-1-1-1S6,0.4,6,1v1H4.9C2.2,2,0,4.2,0,6.9v12.1C0,21.8,2.2,24,4.9,24h14.1c2.7,0,4.9-2.2,4.9-4.9V6.9C24,4.2,21.8,2,19.1,2z M4.9,4H6v1c0,0.6,0.4,1,1,1s1-0.4,1-1V4h8v1c0,0.6,0.4,1,1,1s1-0.4,1-1V4h1.1C20.7,4,22,5.3,22,6.9V8H2V6.9C2,5.3,3.3,4,4.9,4z M19.1,22H4.9C3.3,22,2,20.7,2,19.1V10h20v9.1C22,20.7,20.7,22,19.1,22z" />
        )}
      </g>
    </svg>
  );
}
