import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(URL, KEY, {
  realtime: { params: { eventsPerSecond: 20 } }
})

/* 재시도 래퍼 — 일시적 오류 시 최대 3번 재시도 */
export async function dbRetry(fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await fn()
    if (!error) return { data, error: null }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)))
    else return { data: null, error }
  }
}
