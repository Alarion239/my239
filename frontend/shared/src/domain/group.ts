// Shared group semantics for web and native interfaces.

export const UNALLOCATED_GROUP_NAME = 'Не распределены'

export function isUnallocatedGroup(name: string | null | undefined): boolean {
  return name?.trim() === UNALLOCATED_GROUP_NAME
}
