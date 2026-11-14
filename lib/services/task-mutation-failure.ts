/** Domain failure; the HTTP adapter preserves the existing response contract. */
export class TaskMutationFailure extends Error {
  constructor(
    readonly reason: "invalid" | "missing" | "denied" | "conflict",
    message: string,
    readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TaskMutationFailure";
  }
}
