import { leagueConfigs } from '../config/leagueConfigs.js';

export function useLeagueConfig(selectedLeague) {
  console.log('useLeagueConfig called with:', selectedLeague);
  
  if (selectedLeague?.id === 'sculpin') {
    console.log('Returning sculpin config');
    return leagueConfigs.sculpin;
  }
  
  console.log('Returning blitzzz config (default)');
  return leagueConfigs.blitzzz; // Default to Blitzzz
}