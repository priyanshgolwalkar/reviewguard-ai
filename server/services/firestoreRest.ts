import fs from 'node:fs';
import path from 'node:path';
import type {
  AccountStatus,
  BusinessMemberRecord,
  BusinessRecord,
  PlatformSettingsRecord,
  UserProfileRecord,
  UserRole,
} from '../../src/shared/validation.ts';

export interface TenantDataStore {
  isAdmin(uid: string, idToken: string): Promise<boolean>;
  getUserProfile(uid: string, idToken: string): Promise<UserProfileRecord | null>;
  createAdminAndPromoteUser(
    uid: string,
    email: string,
    displayName: string,
    idToken: string
  ): Promise<void>;
  getBusiness(businessId: string, idToken: string): Promise<BusinessRecord | null>;
  getBusinessMembership(
    businessId: string,
    uid: string,
    idToken: string
  ): Promise<BusinessMemberRecord | null>;
  getPlatformSettings(idToken: string): Promise<PlatformSettingsRecord | null>;
}

interface FirestoreConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

function loadConfig(): FirestoreConfig {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as FirestoreConfig;
}

interface FirestoreFieldValue {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
}

interface FirestoreDocResponse {
  name?: string;
  fields?: Record<string, FirestoreFieldValue>;
}

function strVal(fields: Record<string, FirestoreFieldValue> | undefined, key: string, fallback = ''): string {
  return fields?.[key]?.stringValue ?? fallback;
}

function boolVal(fields: Record<string, FirestoreFieldValue> | undefined, key: string, fallback = false): boolean {
  return typeof fields?.[key]?.booleanValue === 'boolean' ? Boolean(fields[key].booleanValue) : fallback;
}

function intVal(fields: Record<string, FirestoreFieldValue> | undefined, key: string, fallback = 0): number {
  const raw = fields?.[key]?.integerValue;
  return raw !== undefined ? Number(raw) : fallback;
}

function tsVal(fields: Record<string, FirestoreFieldValue> | undefined, key: string): number {
  const raw = fields?.[key]?.timestampValue;
  if (!raw) return Date.now();
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export class FirestoreRestStore implements TenantDataStore {
  private getBaseUrl(): string {
    const cfg = loadConfig();
    const dbId = cfg.firestoreDatabaseId || '(default)';
    return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${dbId}/documents`;
  }

  private async fetchDoc(docPath: string, idToken: string): Promise<FirestoreDocResponse | null> {
    const res = await fetch(`${this.getBaseUrl()}/${docPath}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (res.status === 404) return null;
    if (res.status === 403) return null;
    if (!res.ok) {
      throw new Error(`Firestore REST read failed (${res.status}) for ${docPath}`);
    }
    return (await res.json()) as FirestoreDocResponse;
  }

  async isAdmin(uid: string, idToken: string): Promise<boolean> {
    const doc = await this.fetchDoc(`admins/${uid}`, idToken);
    return Boolean(doc?.fields?.uid?.stringValue === uid);
  }

  async getUserProfile(uid: string, idToken: string): Promise<UserProfileRecord | null> {
    const doc = await this.fetchDoc(`users/${uid}`, idToken);
    if (!doc?.fields) return null;
    const role = (strVal(doc.fields, 'role', 'BUSINESS_OWNER') as UserRole) || 'BUSINESS_OWNER';
    const status = (strVal(doc.fields, 'status', 'active') as AccountStatus) || 'active';
    return {
      uid: strVal(doc.fields, 'uid', uid),
      email: strVal(doc.fields, 'email'),
      displayName: strVal(doc.fields, 'displayName', 'User'),
      role,
      status,
      createdAtMs: tsVal(doc.fields, 'createdAt'),
      updatedAtMs: tsVal(doc.fields, 'updatedAt'),
    };
  }

  async createAdminAndPromoteUser(
    uid: string,
    email: string,
    displayName: string,
    idToken: string
  ): Promise<void> {
    const cfg = loadConfig();
    const dbId = cfg.firestoreDatabaseId || '(default)';
    const docRoot = `projects/${cfg.projectId}/databases/${dbId}/documents`;
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${dbId}/documents:commit`;

    const existingRawDoc = await this.fetchDoc(`users/${uid}`, idToken);
    const existingUser = await this.getUserProfile(uid, idToken);
    const rawCreatedAt = existingRawDoc?.fields?.createdAt?.timestampValue;

    const writes: unknown[] = [
      {
        update: {
          name: `${docRoot}/admins/${uid}`,
          fields: {
            uid: { stringValue: uid },
            email: { stringValue: email },
            provisionedBy: { stringValue: 'system_bootstrap' },
          },
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        ],
      },
    ];

    if (!existingUser) {
      writes.push({
        update: {
          name: `${docRoot}/users/${uid}`,
          fields: {
            uid: { stringValue: uid },
            email: { stringValue: email },
            displayName: { stringValue: displayName || 'Platform Admin' },
            role: { stringValue: 'SUPER_ADMIN' },
            status: { stringValue: 'active' },
          },
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      });
    } else {
      writes.push({
        update: {
          name: `${docRoot}/users/${uid}`,
          fields: {
            uid: { stringValue: uid },
            email: { stringValue: existingUser.email || email },
            displayName: { stringValue: existingUser.displayName || displayName || 'Platform Admin' },
            role: { stringValue: 'SUPER_ADMIN' },
            status: { stringValue: 'active' },
            createdAt: {
              timestampValue: rawCreatedAt || new Date(existingUser.createdAtMs).toISOString(),
            },
          },
        },
        updateTransforms: [
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      });
    }

    const res = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ writes }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Super Admin provisioning commit failed (${res.status}): ${errText}`);
    }
  }

  async getBusiness(businessId: string, idToken: string): Promise<BusinessRecord | null> {
    const doc = await this.fetchDoc(`businesses/${businessId}`, idToken);
    if (!doc?.fields) return null;
    return {
      id: businessId,
      ownerId: strVal(doc.fields, 'ownerId'),
      name: strVal(doc.fields, 'name'),
      category: strVal(doc.fields, 'category'),
      city: strVal(doc.fields, 'city'),
      address: strVal(doc.fields, 'address'),
      description: strVal(doc.fields, 'description'),
      status: (strVal(doc.fields, 'status', 'active') as AccountStatus) || 'active',
      createdAtMs: tsVal(doc.fields, 'createdAt'),
      updatedAtMs: tsVal(doc.fields, 'updatedAt'),
    };
  }

  async getBusinessMembership(
    businessId: string,
    uid: string,
    idToken: string
  ): Promise<BusinessMemberRecord | null> {
    const membershipId = `${businessId}__${uid}`;
    const doc = await this.fetchDoc(`business_members/${membershipId}`, idToken);
    if (!doc?.fields) return null;
    return {
      id: membershipId,
      businessId: strVal(doc.fields, 'businessId', businessId),
      businessName: strVal(doc.fields, 'businessName'),
      ownerId: strVal(doc.fields, 'ownerId'),
      userId: strVal(doc.fields, 'userId', uid),
      email: strVal(doc.fields, 'email'),
      displayName: strVal(doc.fields, 'displayName'),
      role: (strVal(doc.fields, 'role', 'BUSINESS_MANAGER') as 'BUSINESS_OWNER' | 'BUSINESS_MANAGER'),
      canApproveReplies: boolVal(doc.fields, 'canApproveReplies', false),
      status: (strVal(doc.fields, 'status', 'active') as 'active' | 'revoked'),
      invitedBy: strVal(doc.fields, 'invitedBy'),
      inviteId: strVal(doc.fields, 'inviteId', 'owner'),
      createdAtMs: tsVal(doc.fields, 'createdAt'),
      updatedAtMs: tsVal(doc.fields, 'updatedAt'),
    };
  }

  async getPlatformSettings(idToken: string): Promise<PlatformSettingsRecord | null> {
    const doc = await this.fetchDoc('platform_settings/global', idToken);
    if (!doc?.fields) return null;
    return {
      id: 'global',
      platformName: strVal(doc.fields, 'platformName', 'ReviewGuard AI'),
      allowNewBusinessRegistration: boolVal(doc.fields, 'allowNewBusinessRegistration', true),
      maxBusinessesPerOwner: intVal(doc.fields, 'maxBusinessesPerOwner', 10),
      aiAnalysisEnabled: boolVal(doc.fields, 'aiAnalysisEnabled', true),
      maintenanceMode: boolVal(doc.fields, 'maintenanceMode', false),
      updatedBy: strVal(doc.fields, 'updatedBy'),
      updatedAtMs: tsVal(doc.fields, 'updatedAt'),
    };
  }
}

export const defaultTenantDataStore = new FirestoreRestStore();
