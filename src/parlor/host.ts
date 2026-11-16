import { OwApiError } from '@onlyworlds/sdk';

/**
 * The web host in front of OnlyWorlds refuses some writes before the API sees them: a 403 whose
 * body is the host's own page, not the API's JSON error (text holding a shell command right after
 * a code mark, a semicolon or a pipe). The API answers every error with a code, so a 403 with none
 * is the host's: never the seat, the PIN or the sign-in, and only that one write is refused.
 *
 * Two tiers: `isHostRefusal` decides what the parlor does and says; `isHostBlocked`, the host's page
 * titled "Blocked" as the SDK reads it, decides only whether the words may name the usual cause.
 */
export function isHostRefusal(err: unknown): boolean {
  return err instanceof OwApiError && err.status === 403 && (err.code === null || err.code === undefined);
}

export function isHostBlocked(err: unknown): boolean {
  return isHostRefusal(err) && (err as OwApiError).isHostBlocked === true;
}

/** The usual cause of the host's "Blocked" page and what to do, said only for that page. */
export const HOST_CAUSE = 'A command written between code marks, such as `python -m`, is the usual cause: write it without the marks, or in a code block that names its language.';

/** The host's refusal in a sentence: `what` it refused (and `doing`, as the parlor's other lines say it), the cause when known, then `after`. */
export function hostLine(err: unknown, what: string, after: string, doing?: string): string {
  return `The web host in front of OnlyWorlds refused ${what} before it reached OnlyWorlds${doing ? ` (${doing})` : ''}.${isHostBlocked(err) ? ` ${HOST_CAUSE}` : ''} ${after}`;
}
