const API_URL = 'https://apis.data.go.kr/1051000/recruitment/list';
const PAGE_SIZE = 100;
const MAX_JOBS = 300;
const YOUTH_INTERN_CODES = ['R1050', 'R1060', 'R1070'];
const JOB_COLUMNS = [
  ['recrutpblntsn', 'bigint'], ['pblntinstcd', 'text'], ['pbadmsstdinstcd', 'text'], ['instnm', 'text'],
  ['ncscdlst', 'text'], ['ncscdnmlst', 'text'], ['hiretypelst', 'text'], ['hiretypenmlst', 'text'],
  ['workrgnlst', 'text'], ['workrgnnmlst', 'text'], ['recrutse', 'text'], ['recrutsenm', 'text'],
  ['prefcondcn', 'text'], ['recrutnope', 'integer'], ['pbancbgngymd', 'text'], ['pbancendymd', 'text'],
  ['recrutpbancttl', 'text'], ['srcurl', 'text'], ['replmpryn', 'text'], ['aplyqlfccn', 'text'],
  ['disqlfcrsn', 'text'], ['scrnprcdrmthdexpln', 'text'], ['prefcn', 'text'], ['acbgcondlst', 'text'],
  ['acbgcondnmlst', 'text'], ['nonatchrsn', 'text'], ['ongoingyn', 'text'], ['decimalday', 'numeric'],
  ['files', 'jsonb'], ['steps', 'jsonb']
];

function removeContactFields(value) {
  if (Array.isArray(value)) return value.map(removeContactFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(담당|연락|mngr|manager|charger|tel|phone|email|mail|contact)/i.test(key))
    .map(([key, item]) => [key, removeContactFields(item)]));
}

async function fetchPage(apiKey, pageNo, filters) {
  const params = new URLSearchParams({ serviceKey: decodeURIComponent(apiKey), resultType: 'json', ongoingYn: 'Y', numOfRows: String(PAGE_SIZE), pageNo: String(pageNo), ...filters });
  const result = await fetch(`${API_URL}?${params}`);
  if (!result.ok) throw new Error(`Recruitment API returned ${result.status}`);
  const body = await result.json();
  if (Number(body.resultCode) !== 200) throw new Error(body.resultMsg || 'Recruitment API error');
  return { rows: Array.isArray(body.result) ? body.result : [], total: Number(body.totalCount || 0) };
}

async function fetchAll(apiKey, filters) {
  const rows = [];
  let pageNo = 1;
  let total = Infinity;
  while (rows.length < MAX_JOBS && rows.length < total) {
    const page = await fetchPage(apiKey, pageNo, filters);
    rows.push(...page.rows);
    total = page.total;
    if (page.rows.length === 0) break;
    pageNo += 1;
  }
  return rows.slice(0, MAX_JOBS);
}

function toDatabaseRow(raw) {
  const lower = Object.fromEntries(Object.entries(removeContactFields(raw)).map(([key, value]) => [key.toLowerCase(), value]));
  return Object.fromEntries(JOB_COLUMNS.map(([name]) => [name, lower[name] ?? null]));
}

async function supabaseRequest(url, key, options = {}) {
  const result = await fetch(url, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(options.headers || {}) }
  });
  if (!result.ok) throw new Error(`Supabase returned ${result.status}: ${await result.text()}`);
  return result.status === 204 ? null : result.json();
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  if (request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return response.status(401).json({ error: 'Unauthorized' });
  const apiKey = process.env.RECRUITMENT_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !supabaseUrl || !supabaseServiceKey) return response.status(500).json({ error: 'Sync environment variables are not configured' });

  try {
    const [newJobs, youthInternJobs] = await Promise.all([
      fetchAll(apiKey, { recrutSe: 'R2010' }),
      fetchAll(apiKey, { hireTypeLst: YOUTH_INTERN_CODES.join(',') })
    ]);
    const unique = new Map();
    [...newJobs, ...youthInternJobs].forEach(job => unique.set(String(job.recrutPblntSn), job));
    const rows = Array.from(unique.values()).slice(0, MAX_JOBS).map(toDatabaseRow);
    const baseUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/jobs`;
    await supabaseRequest(`${baseUrl}?on_conflict=recrutpblntsn`, supabaseServiceKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });

    const existing = await supabaseRequest(`${baseUrl}?select=recrutpblntsn&ongoingyn=eq.Y&limit=1000`, supabaseServiceKey);
    const freshIds = new Set(rows.map(row => String(row.recrutpblntsn)));
    const staleIds = existing.map(row => String(row.recrutpblntsn)).filter(id => !freshIds.has(id));
    if (staleIds.length) {
      const staleFilter = `(${staleIds.join(',')})`;
      await supabaseRequest(`${baseUrl}?recrutpblntsn=in.${staleFilter}`, supabaseServiceKey, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ ongoingyn: 'N' })
      });
    }
    return response.status(200).json({ syncedAt: new Date().toISOString(), count: rows.length, markedExpired: staleIds.length });
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: '채용공고 동기화에 실패했습니다.' });
  }
};
