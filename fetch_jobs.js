const fs = require('node:fs');
const path = require('node:path');

const API_URL = 'https://apis.data.go.kr/1051000/recruitment/list';
const PAGE_SIZE = 100;
const MAX_JOBS = 300;

function readApiKey() {
  const envPath = path.join(__dirname, '.env');
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => /^\s*RECRUITMENT_API_KEY\s*=/.test(item));
  const rawKey = line ? line.split('=').slice(1).join('=').trim() : '';
  if (!rawKey) throw new Error('.env에 RECRUITMENT_API_KEY가 없습니다.');
  return decodeURIComponent(rawKey);
}

async function fetchPage(apiKey, pageNo, filters) {
  const params = new URLSearchParams({ serviceKey: apiKey, resultType: 'json', ongoingYn: 'Y', numOfRows: String(PAGE_SIZE), pageNo: String(pageNo), ...filters });
  const response = await fetch(`${API_URL}?${params}`);
  if (!response.ok) throw new Error(`API 요청 실패: HTTP ${response.status}`);
  const body = await response.json();
  if (Number(body.resultCode) !== 200) throw new Error(`API 오류: ${body.resultMsg || '알 수 없는 오류'}`);
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

function removeContactFields(value) {
  if (Array.isArray(value)) return value.map(removeContactFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(담당|연락|mngr|manager|charger|tel|phone|email|mail|contact)/i.test(key)).map(([key, item]) => [key, removeContactFields(item)]));
}

async function main() {
  const apiKey = readApiKey();
  const [newJobs, youthInternJobs] = await Promise.all([
    fetchAll(apiKey, { recrutSe: 'R2010' }),
    fetchAll(apiKey, { hireTypeLst: 'R1050,R1060,R1070' })
  ]);
  const unique = new Map();
  [...newJobs, ...youthInternJobs].forEach((job) => unique.set(String(job.recrutPblntSn), job));
  const jobs = Array.from(unique.values()).slice(0, MAX_JOBS).map(removeContactFields);
  fs.writeFileSync(path.join(__dirname, 'jobs.json'), `${JSON.stringify(jobs, null, 2)}\n`, 'utf8');
  console.log(`저장 완료: ${jobs.length}건`);
  console.log(`신입 조회: ${newJobs.length}건, 청년인턴 조회: ${youthInternJobs.length}건, 중복 제거 후: ${jobs.length}건`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
