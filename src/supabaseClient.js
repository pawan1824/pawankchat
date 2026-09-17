import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wnenpuclqnbvzstptpnv.supabase.co';
const supabaseAnonKey = 'sb_publishable_9SMD6mFutAZ4B4pqMOErwg_kZsckrzn';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);