// src/utils/leagueStorage.js

// Helper function to create league-specific API endpoints
export function createLeagueAPI(leagueId) {
  const API = (path) => {
    const baseUrl = import.meta.env.DEV ? `http://localhost:8787` : '';
    return `${baseUrl}/api/leagues/${leagueId}${path}`;
  };
  
  return { API };
}

// Helper function to create league-specific localStorage keys
export function createLeagueStorageKey(leagueId, key) {
  return `ffl_${leagueId}_${key}`;
}

// Hook for league-specific localStorage
export function useLeagueStorage(leagueId, key, defaultValue = '') {
  const [value, setValue] = React.useState(() => {
    if (!leagueId) return defaultValue;
    const storageKey = createLeagueStorageKey(leagueId, key);
    return localStorage.getItem(storageKey) ?? defaultValue;
  });

  React.useEffect(() => {
    if (!leagueId) return;
    const storageKey = createLeagueStorageKey(leagueId, key);
    localStorage.setItem(storageKey, value ?? '');
  }, [leagueId, key, value]);

  return [value, setValue];
}