export const SPHERE_PROTOCOL_VERSION = '0.1.0' as const;
export const SPHERE_SCHEMA_VERSION = SPHERE_PROTOCOL_VERSION;
export const SPHERE_SUPPORTED_SCHEMA_VERSIONS = [SPHERE_PROTOCOL_VERSION] as const;

export type SchemaVersion = (typeof SPHERE_SUPPORTED_SCHEMA_VERSIONS)[number];

export function isSupportedSchemaVersion(value: unknown): value is SchemaVersion {
  return typeof value === 'string' && (SPHERE_SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(value);
}

export const ENTITY_KINDS = [
  'person',
  'agent',
  'group',
  'app',
  'node',
  'resource',
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export const EDGE_TYPES = [
  'trusts',
  'vouches_for',
  'endorses',
  'blocks',
  'member_of',
  'admin_of',
  'moderates',
  'owns',
  'founded',
  'contains',
  'parent_of',
  'represents',
  'delegates_to',
  'hosted_by',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export const RESOURCE_TYPES = [
  'entity',
  'identity_link',
  'edge',
  'command',
  'event',
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const HASH_ALGORITHMS = ['sha256'] as const;

export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = Record<string, unknown>;

export type Metadata = JsonObject;

export interface VersionedRecord {
  schemaVersion: SchemaVersion;
}

export interface TimestampedRecord {
  createdAt: string;
  updatedAt: string;
}

export interface Entity extends VersionedRecord, TimestampedRecord {
  id: string;
  kind: EntityKind;
  name: string;
  metadata: Metadata;
}

export interface IdentityLink extends VersionedRecord, TimestampedRecord {
  id: string;
  entityId: string;
  platform: string;
  platformId: string;
  handle: string | null;
  verified: boolean;
  metadata: Metadata;
}

export interface Edge extends VersionedRecord {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType | `custom:${string}`;
  metadata: Metadata;
  createdAt: string;
  createdBy: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
}

export type ActorKind = 'entity' | 'system' | 'anonymous';

export interface Actor extends VersionedRecord {
  id: string;
  kind: ActorKind;
  entityId: string | null;
  metadata: Metadata;
}

export type EventAction =
  | 'entity.create'
  | 'entity.update'
  | 'entity.delete'
  | 'identity.link'
  | 'identity.unlink'
  | 'edge.create'
  | 'edge.delete'
  | 'command.accept'
  | 'command.reject'
  | `custom:${string}`;

export interface EventWithoutHash extends VersionedRecord {
  id: string;
  chainId: string;
  sequence: number;
  actorId: string;
  subjectId: string | null;
  action: EventAction;
  resourceType: ResourceType | `custom:${string}`;
  resourceId: string | null;
  timestamp: string;
  payload: JsonObject;
  reason: string | null;
  hashAlgorithm: HashAlgorithm;
  previousHash: string | null;
}

export interface Event extends EventWithoutHash {
  hash: string;
}

export type CommandAction =
  | 'entity.create'
  | 'entity.update'
  | 'entity.delete'
  | 'identity.link'
  | 'identity.unlink'
  | 'edge.create'
  | 'edge.delete'
  | `custom:${string}`;

export interface Command extends VersionedRecord {
  id: string;
  actorId: string;
  action: CommandAction;
  resourceType: ResourceType | `custom:${string}`;
  resourceId: string | null;
  payload: JsonObject;
  reason: string | null;
  createdAt: string;
}
