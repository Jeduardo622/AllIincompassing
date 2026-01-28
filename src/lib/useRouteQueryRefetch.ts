import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

export const useRouteQueryRefetch = () => {
  const location = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.invalidateQueries({ refetchType: 'active' });
  }, [location.pathname, queryClient]);
};
