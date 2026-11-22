import crypto from 'node:crypto';
import type { TenantDataStore } from './firestoreRest.ts';

const DEFAULT_BOOTSTRAP_ADMIN_EMAIL = 'priyanshgolwalkar@gmail.com';

export function getBootstrapAdminEmail(): string {
  const configured = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  return configured || DEFAULT_BOOTSTRAP_ADMIN_EMAIL;
}

function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export class SuperAdminProvisionError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = 'SuperAdminProvisionError';
    this.statusCode = statusCode;
  }
}

export async function provisionInitialSuperAdmin(params: {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  idToken: string;
  bootstrapSecret?: string;
  store: TenantDataStore;
}): Promise<{ role: 'SUPER_ADMIN'; alreadyProvisioned: boolean }> {
  if (!params.emailVerified) {
    throw new SuperAdminProvisionError(
      'Verified email is required for Super Admin provisioning.',
      403
    );
  }

  const alreadyAdmin = await params.store.isAdmin(params.uid, params.idToken);
  if (alreadyAdmin) {
    return { role: 'SUPER_ADMIN', alreadyProvisioned: true };
  }

  const expectedEmail = getBootstrapAdminEmail();
  if (params.email.trim().toLowerCase() !== expectedEmail) {
    throw new SuperAdminProvisionError(
      'Forbidden: Super Admin privileges cannot be self-assigned and are restricted to server-provisioned platform administrators.',
      403
    );
  }

  const configuredSecret = process.env.SUPER_ADMIN_BOOTSTRAP_SECRET?.trim() || '';
  if (configuredSecret) {
    const provided = (params.bootstrapSecret ?? '').trim();
    if (!provided || !timingSafeMatch(provided, configuredSecret)) {
      throw new SuperAdminProvisionError(
        'Forbidden: Invalid Super Admin bootstrap secret.',
        403
      );
    }
  }

  await params.store.createAdminAndPromoteUser(
    params.uid,
    params.email,
    params.displayName || 'Platform Admin',
    params.idToken
  );

  return { role: 'SUPER_ADMIN', alreadyProvisioned: false };
}
