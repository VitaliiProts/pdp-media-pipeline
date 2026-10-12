import { createHash } from 'node:crypto';

/**
 * Same steps as `decide()` in gcra.ts. KEYS are the limit keys, ARGV holds an
 * (interval, tolerance) pair per key, in microseconds.
 *
 * Returns {allowed, retry_after, remaining_1, reset_1, remaining_2, reset_2, ...}.
 * The clock is Redis TIME, so gateway replicas with skewed clocks agree.
 * TATs are written with %.0f: tostring() would round 16-digit numbers.
 */
export const GCRA_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000000 + tonumber(t[2])
local allowed = 1
local retry = 0
local new_tats = {}
local out = {}

for i = 1, #KEYS do
  local interval = tonumber(ARGV[2 * i - 1])
  local tolerance = tonumber(ARGV[2 * i])
  local stored = redis.call('GET', KEYS[i])
  local tat = now
  if stored then tat = math.max(tonumber(stored), now) end
  local new_tat = tat + interval
  local allow_at = new_tat - tolerance
  if now < allow_at then
    allowed = 0
    retry = math.max(retry, allow_at - now)
    out[2 * i - 1] = 0
    out[2 * i] = tat - now
  else
    new_tats[i] = new_tat
    out[2 * i - 1] = math.floor((now - allow_at) / interval)
    out[2 * i] = new_tat - now
  end
end

if allowed == 1 then
  for i = 1, #KEYS do
    local ttl_ms = math.ceil((new_tats[i] - now) / 1000)
    redis.call('SET', KEYS[i], string.format('%.0f', new_tats[i]), 'PX', ttl_ms)
  end
end

local result = { allowed, retry }
for i = 1, #out do result[#result + 1] = out[i] end
return result
`;

export const GCRA_LUA_SHA = createHash('sha1').update(GCRA_LUA).digest('hex');
