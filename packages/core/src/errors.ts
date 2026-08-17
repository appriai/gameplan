/**
 * Lives in its own module so both `spec.ts` and `diagram.ts` can throw it
 * without importing each other. A plan can embed diagrams, so `spec.ts` needs
 * `diagram.ts`'s schemas at runtime — if `diagram.ts` reached back into
 * `spec.ts` for this class, that would be a genuine ESM value cycle rather
 * than a type-only one.
 */
export class SpecError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "SpecError";
  }
}
