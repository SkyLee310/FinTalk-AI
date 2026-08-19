import type { NotificationType, Prisma } from '@prisma/client';
import { type Capability, rolesWithCapability } from '../auth/rbac.js';

/**
 * Self-scoped alerts, created inside the caller's own transaction so a
 * notification exists if and only if the event that triggered it actually
 * committed. See Notification's own schema comment for the three event
 * types and prisma/schema.prisma for why relatedMeetingId is a loose
 * reference rather than a foreign key.
 */

export interface NotifyInput {
  readonly type: NotificationType;
  readonly message: string;
  readonly relatedMeetingId?: string;
}

/**
 * Notifies every active user whose role statically grants `capability` —
 * see rolesWithCapability's own comment for why OVERSIGHT can never be
 * reached this way. A deactivated account is skipped: login already refuses
 * it, so it could never read the notification either.
 */
export async function notifyCapabilityHolders(
  tx: Prisma.TransactionClient,
  capability: Capability,
  input: NotifyInput,
): Promise<void> {
  const roles = rolesWithCapability(capability);
  if (roles.length === 0) return;

  const recipients = await tx.user.findMany({
    where: { role: { in: [...roles] }, deactivatedAt: null },
    select: { id: true },
  });
  if (recipients.length === 0) return;

  await tx.notification.createMany({
    data: recipients.map((recipient) => ({
      userId: recipient.id,
      type: input.type,
      message: input.message,
      relatedMeetingId: input.relatedMeetingId ?? null,
    })),
  });
}

/** Notifies exactly one user — the maker being told their own term sheet was decided. */
export async function notifyUser(
  tx: Prisma.TransactionClient,
  userId: string,
  input: NotifyInput,
): Promise<void> {
  await tx.notification.create({
    data: {
      userId,
      type: input.type,
      message: input.message,
      relatedMeetingId: input.relatedMeetingId ?? null,
    },
  });
}
