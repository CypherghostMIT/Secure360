/**
 * Atomic sliding-window counter: read, decide, increment and set the TTL in one script, so concurrent requests on
 * both replicas cannot race between the read and the write. Mirrors applyWindow() in sliding-window.ts line for
 * line (same operations in the same order, so the same IEEE doubles); keep the two in step.
 *
 * `now` comes from Node rather than Redis TIME: both API replicas run on one host and share its clock, and the
 * in-process fallback then uses exactly the same inputs.
 *
 * KEYS[1] rl:{policy}:{id}
 * ARGV    nowMs, limit, windowMs, blockMs, consume (1|0)
 * Returns {allowed (1|0), remaining, retryAfterMs} — integers only, identical under RESP2 and RESP3.
 */
export const RATE_LIMIT_SCRIPT = `
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local block = tonumber(ARGV[4])
local consume = ARGV[5] == '1'
local f = redis.call('HMGET', KEYS[1], 'ws', 'cur', 'prev', 'bu')
local bucket = now - (now % window)
local ws = tonumber(f[1])
local cur = tonumber(f[2]) or 0
local prev = tonumber(f[3]) or 0
local bu = tonumber(f[4]) or 0
if ws == bucket then
elseif ws == bucket - window then
  prev = cur
  cur = 0
else
  prev = 0
  cur = 0
end
local estimate = (prev * (window - (now - bucket))) / window + cur
local allowed = bu <= now and estimate < limit
local retry = 0
if not allowed then
  if bu > now then
    retry = bu - now
  elseif cur < limit then
    retry = math.max(1, math.ceil(bucket + window * (1 - (limit - cur) / prev) - now + 1))
  else
    retry = math.max(1, math.ceil(bucket + window + window * (1 - limit / cur) - now + 1))
  end
end
if allowed and consume then
  estimate = estimate + 1
  if block > 0 and estimate >= limit then
    bu = now + block
  end
  cur = cur + 1
  redis.call('HSET', KEYS[1], 'ws', bucket, 'cur', cur, 'prev', prev, 'bu', bu)
  redis.call('PEXPIRE', KEYS[1], math.ceil(math.max(bucket + 2 * window - now, bu - now)))
end
return {allowed and 1 or 0, math.max(0, math.floor(limit - estimate)), retry}
`;
