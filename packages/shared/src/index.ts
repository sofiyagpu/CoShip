import { z } from 'zod';

export const operations = ['list', 'get', 'insert', 'update', 'delete'] as const;
export const collectionSchema = z
  .object({
    schema: z.record(z.unknown()).default({ type: 'object' }),
    operations: z
      .array(z.enum(operations))
      .min(1)
      .default(['list', 'get', 'insert', 'update', 'delete']),
  })
  .strict();
export const manifestSchema = z
  .object({
    manifestVersion: z.literal('1'),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(300).default(''),
    icon: z
      .enum(['layers', 'chart', 'check', 'calendar', 'box', 'sparkles', 'users', 'file'])
      .default('layers'),
    color: z.enum(['violet', 'blue', 'green', 'orange', 'pink', 'slate']).default('violet'),
    runtime: z.literal('coship-js-v1'),
    entry: z.string().default('index.html'),
    functions: z.record(z.string()).default({}),
    data: z
      .object({
        profile: z.literal('app-shared'),
        collections: z.record(collectionSchema).default({}),
      })
      .strict()
      .default({ profile: 'app-shared', collections: {} }),
    connectors: z.array(z.never()).max(0).default([]),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;
export const packetSchema = z
  .object({
    manifest: manifestSchema,
    files: z.record(z.string()).refine((v) => Object.keys(v).length <= 100, 'Не более 100 файлов'),
  })
  .strict();
export type ProjectPacket = z.infer<typeof packetSchema>;
export type DataRole = 'viewer' | 'user';
export type ManagementRole = 'builder' | 'owner' | null;
export interface Actor {
  id: string;
  org_id: string;
  name: string;
  email: string;
  avatar: string;
  admin: boolean;
  active: boolean;
}
export interface AppView {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  owner_id: string;
  owner_name: string;
  status: 'active' | 'archive_pending' | 'archived';
  active_release_id: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  pinned: boolean;
  favorite: boolean;
  data_role: DataRole | null;
  management_role: ManagementRole;
  people_count: number;
  release_count: number;
  record_count: number;
  collections: string[];
}
export interface AppRecord {
  id: string;
  payload: Record<string, unknown>;
  revision: number;
  created_at: string;
  updated_at: string;
}
export const dataRequestSchema = z
  .object({
    operation: z.enum(operations),
    collection: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
    id: z.string().uuid().optional(),
    payload: z.record(z.unknown()).optional(),
    revision: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().uuid().optional(),
    idempotency_key: z.string().uuid().optional(),
  })
  .strict();
export type DataRequest = z.infer<typeof dataRequestSchema>;
export const grantSchema = z
  .object({
    subject_type: z.enum(['user', 'group']),
    subject_id: z.string(),
    data_role: z.enum(['viewer', 'user']).nullable(),
    management_role: z.literal('builder').nullable().default(null),
  })
  .strict();
