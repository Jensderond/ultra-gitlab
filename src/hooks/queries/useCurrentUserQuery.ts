import { useMemo } from 'react';
import { useInstancesQuery } from './useInstancesQuery';

export function useCurrentUserQuery(instanceId: number) {
  const instancesQuery = useInstancesQuery();

  const authenticatedUsername = useMemo(() => {
    if (!instancesQuery.data) return null;
    const instance = instancesQuery.data.find((i) => i.id === instanceId);
    return instance?.authenticatedUsername ?? null;
  }, [instancesQuery.data, instanceId]);

  return {
    ...instancesQuery,
    data: authenticatedUsername,
  };
}
