const API_URL = 'https://apis.data.go.kr/1051000/recruitment/list';
const PAGE_SIZE = 100;
const MAX_JOBS = 300;
const YOUTH_INTERN_CODES = ['R1050', 'R1060', 'R1070'];

function splitList(value) { return value == null ? [] : String(value).split(',').map(item => item.trim()).filter(Boolean); }
function removeContactFields(value) {
  if (Array.isArray(value)) return value.map(removeContactFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(담당|연락|mngr|manager|charger|tel|phone|email|mail|contact)/i.test(key)).map(([key, item]) => [key, removeContactFields(item)]));
}
async function fetchPage(apiKey, pageNo, filters) {
  const params = new URLSearchParams({ serviceKey: decodeURIComponent(apiKey), resultType: 'json', ongoingYn: 'Y', numOfRows: String(PAGE_SIZE), pageNo: String(pageNo), ...filters });
  const response = await fetch(`${API_URL}?${params}`);
  if (!response.ok) throw new Error(`Recruitment API returned ${response.status}`);
  const body = await response.json();
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

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.RECRUITMENT_API_KEY;
  if (!apiKey) return response.status(500).json({ error: 'RECRUITMENT_API_KEY is not configured' });
  try {
    const [newJobs, youthInternJobs] = await Promise.all([
      fetchAll(apiKey, { recrutSe: 'R2010' }),
      fetchAll(apiKey, { hireTypeLst: YOUTH_INTERN_CODES.join(',') })
    ]);
    const unique = new Map();
    [...newJobs, ...youthInternJobs].forEach(job => unique.set(String(job.recrutPblntSn), job));
    const jobs = Array.from(unique.values()).slice(0, MAX_JOBS).map(removeContactFields);
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    return response.status(200).json({ fetchedAt: new Date().toISOString(), count: jobs.length, jobs });
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: '채용공고 API를 불러오지 못했습니다.' });
  }
};
