import { supabase } from '../config/supabase.js';
import { unwrap } from '../utils/supabaseHelpers.js';

export async function fetchMetadata() {
  return unwrap(await supabase.from('cv_meta').select('clave,valor'), 'stats.meta').data;
}
